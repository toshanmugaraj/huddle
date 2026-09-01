import { useState } from 'react';
import { Alert, Autocomplete, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import type { InvokeArgs } from '@strands-agents/sdk';
import { InterruptResponseContent } from '../agent/tools';
import { getChatAgent } from '../agent/chatAgent';
import { GEMMA_MODEL_OPTIONS } from '../model/GemmaEdgeModel';
import { useSettingsStore } from '../state/settingsStore';
import { useApiKeyStore } from '../state/apiKeyStore';
import { useModelStore } from '../state/modelStore';
import { useChatStore, type ChatMessage } from '../state/chatStore';
import { useResolveRoomNames } from '../matrix/useResolveRoomNames';

let nextId = 0;
const newId = () => String(nextId++);

export function Chat({ compact = false }: { compact?: boolean }) {
  const widgetApi = useWidgetApi();
  const { settings } = useSettingsStore();
  const geminiApiKey = useApiKeyStore((s) => s.apiKey);
  const localModelStatus = useModelStore((s) => s.status[settings.localModel]);
  const { messages, pendingApproval, addMessage, setPendingApproval } = useChatStore();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  // Suggests your configured Settings rooms for convenience, but isn't
  // limited to them — the Autocomplete below is freeSolo, so pasting any
  // other room ID (like you just did in chat) works too.
  const roomNames = useResolveRoomNames(widgetApi, settings.roomIds);

  if (settings.mode === 'gemini' && !geminiApiKey) {
    return <Alert severity="warning">Set a Gemini API key in Settings to use Chat.</Alert>;
  }

  if (settings.mode === 'local' && localModelStatus !== 'ready') {
    const label = GEMMA_MODEL_OPTIONS.find((o) => o.id === settings.localModel)?.label ?? settings.localModel;
    return (
      <Alert severity="info">
        Chat needs the on-device model prepared first — go to Settings and hit "Prepare model" for{' '}
        {label}, then come back. (Preparing it here automatically would mean silently kicking off a
        multi-GB load the moment you open this tab.)
      </Alert>
    );
  }

  const runTurn = async (invokeArg: InvokeArgs) => {
    setBusy(true);
    setError(undefined);
    try {
      const agent = getChatAgent(
        widgetApi,
        settings.mode === 'gemini'
          ? { mode: 'gemini', apiKey: geminiApiKey, modelId: settings.geminiModel }
          : { mode: 'local', modelId: settings.localModel },
      );
      const result = await agent.invoke(invokeArg);

      if (result.stopReason === 'interrupt') {
        const interrupt = result.interrupts?.[0];
        const reason = interrupt?.reason as { roomId?: string; text?: string } | undefined;
        if (interrupt && reason?.roomId && reason?.text) {
          setPendingApproval({ interruptId: interrupt.id, roomId: reason.roomId, text: reason.text });
        } else {
          setError('Agent paused for approval, but the request details were missing — cannot show a confirmation.');
        }
        return;
      }

      addMessage({ id: newId(), role: 'assistant', text: result.toString().trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    // The visible bubble shows exactly what was typed; the room context (if
    // any) is only added to what the agent actually receives, so it doesn't
    // clutter the conversation display but still gives the model (and its
    // tool calls) an unambiguous room ID instead of having to parse one out
    // of free text.
    addMessage({ id: newId(), role: 'user', text });
    const roomContext = selectedRoomId
      ? `[Selected room: ${roomNames[selectedRoomId] ?? selectedRoomId} (${selectedRoomId})]\n`
      : '';
    void runTurn(`${roomContext}${text}`);
  };

  const handleApproval = (approved: boolean) => {
    if (!pendingApproval) return;
    const { interruptId, roomId, text } = pendingApproval;
    setPendingApproval(undefined);
    addMessage({
      id: newId(),
      role: 'system',
      text: approved ? `Sending to ${roomId}: "${text}"` : `Declined sending to ${roomId}.`,
    });
    void runTurn([new InterruptResponseContent({ interruptId, response: approved })]);
  };

  return (
    <Stack spacing={compact ? 1 : 2} sx={{ height: '100%' }}>
      {/* minHeight: 0 — same fix as AppRoutes.tsx's content box: without it
          this list grows to fit its content instead of scrolling, pushing
          the input row (and the latest response) out of view. */}
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {compact
              ? selectedRoomId
                ? `Asking about ${roomNames[selectedRoomId] ?? selectedRoomId}. Expand the widget to change rooms.`
                : "No room selected — expand the widget to pick one, or just mention which room you mean."
              : 'Pick a room below (or paste an ID), then ask — e.g. "what\'s been happening lately?" or ' +
                '"tell them I\'ll be late". Without a room selected, the agent has to guess which one you ' +
                'mean from what you type.'}
          </Typography>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
        {pendingApproval && (
          <Card variant="outlined" sx={{ borderColor: 'warning.main' }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Approve sending this message?
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                To <code>{pendingApproval.roomId}</code>:
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontStyle: 'italic', mb: 2 }}>
                "{pendingApproval.text}"
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" onClick={() => handleApproval(true)} disabled={busy}>
                  Send
                </Button>
                <Button size="small" variant="outlined" onClick={() => handleApproval(false)} disabled={busy}>
                  Don't send
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Hidden in compact/PiP mode by request — there's no room for it in
          a 330px-wide floating window anyway. Whatever room was selected
          before going compact stays selected (this component doesn't
          unmount, just re-renders without the picker); there's just no way
          to change it until the widget is expanded again. */}
      {!compact && (
        <Autocomplete
          size="small"
          freeSolo
          options={settings.roomIds}
          getOptionLabel={(option) => roomNames[option] ?? option}
          value={selectedRoomId}
          onChange={(_, value) => setSelectedRoomId(value)}
          onInputChange={(_, value, reason) => {
            // freeSolo: typing/pasting a raw room ID that isn't in the
            // suggestion list should still count as a selection, not just
            // text the user is idly typing.
            if (reason === 'input') setSelectedRoomId(value || null);
          }}
          renderInput={(params) => (
            <TextField {...params} label="Room (optional)" placeholder="Pick or paste a room ID — helps the agent know which room you mean" />
          )}
        />
      )}

      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          fullWidth
          placeholder="Ask the assistant…"
          value={input}
          disabled={busy || !!pendingApproval}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <Button variant="contained" onClick={handleSend} disabled={busy || !!pendingApproval || !input.trim()}>
          {busy ? 'Thinking…' : 'Send'}
        </Button>
      </Stack>
    </Stack>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const align = message.role === 'user' ? 'flex-end' : 'flex-start';
  const color = message.role === 'system' ? 'text.secondary' : 'text.primary';
  return (
    <Box sx={{ display: 'flex', justifyContent: align }}>
      <Card variant="outlined" sx={{ maxWidth: '85%', bgcolor: message.role === 'user' ? 'action.hover' : undefined }}>
        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color, fontStyle: message.role === 'system' ? 'italic' : 'normal' }}>
            {message.text}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
