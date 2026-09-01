import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import type { InvokeArgs } from '@strands-agents/sdk';
import { InterruptResponseContent } from '../agent/tools';
import { getChatAgent } from '../agent/chatAgent';
import { GEMMA_MODEL_OPTIONS } from '../model/GemmaEdgeModel';
import { useSettingsStore } from '../state/settingsStore';
import { useApiKeyStore } from '../state/apiKeyStore';
import { useModelStore } from '../state/modelStore';
import { useChatStore, type ChatMessage } from '../state/chatStore';
import { sanitizeSummaryHtml } from '../utils/sanitizeSummaryHtml';

let nextId = 0;
const newId = () => String(nextId++);

export function Chat({ compact = false }: { compact?: boolean }) {
  const widgetApi = useWidgetApi();
  const userId = widgetApi.widgetParameters.userId ?? '';
  const { settings } = useSettingsStore();
  const geminiApiKey = useApiKeyStore((s) => s.apiKey);
  const localModelStatus = useModelStore((s) => s.status[settings.localModel]);
  const { messages, pendingApproval, selectedRoom, addMessage, setPendingApproval, setSelectedRoom } =
    useChatStore();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Bottom sentinel, not a scrollTop calc against the Stack ref — scrolls
  // correctly regardless of exactly when layout/reflow settles after a new
  // bubble (or the approval Card) is added, which a scrollTop=scrollHeight
  // snapshot can race. Fires on every new message and on the approval Card
  // appearing/disappearing (both change what's visible at the bottom).
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingApproval]);

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
        userId,
        setSelectedRoom,
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
    const roomContext = selectedRoom ? `[Selected room: ${selectedRoom.roomName} (${selectedRoom.roomId})]\n` : '';
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
            {selectedRoom
              ? `Asking about ${selectedRoom.roomName}. Just mention another room by name to switch.`
              : 'Ask something, and mention a room by name if you have one in mind — e.g. "what\'s ' +
                'been happening in the design room?" or "tell them I\'ll be late". No room selected ' +
                "yet, so the agent will ask which one you mean if it can't tell from what you type."}
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
        <div ref={bottomRef} />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {/* No manual room picker any more — the agent sets this itself (see
          set_selected_room in agent/tools.ts) whenever it resolves a room
          the user named, and it's read-only display from here on. Shown in
          compact/PiP too (unlike the old picker, which had no room for a
          full Autocomplete in a 330px-wide floating window) — this is just
          a text line, and it's the only way to see the current room at all
          once compact hides the message-list empty-state hint above. */}
      {selectedRoom && (
        <Typography variant="caption" color="text.secondary">
          Discussing: {selectedRoom.roomName}
        </Typography>
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
          {message.role === 'assistant' ? (
            // Same reasoning as SummaryCard on the Home tab (see
            // sanitizeSummaryHtml.ts's doc comment): both providers write
            // Markdown in their replies regardless of what's asked, so this
            // renders it as such instead of showing literal asterisks —
            // DOMPurify is still doing the real XSS hardening on whatever
            // `marked` turns it into, same as the summary cards.
            <Box
              sx={{
                typography: 'body2',
                color,
                '& p': { m: 0, mb: 0.5, '&:last-child': { mb: 0 } },
                '& ul, & ol': { mt: 0, mb: 0.5, pl: 3, '&:last-child': { mb: 0 } },
                '& li': { mb: 1, '&:last-child': { mb: 0 } },
              }}
              dangerouslySetInnerHTML={{ __html: sanitizeSummaryHtml(message.text) }}
            />
          ) : (
            <Typography
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap', color, fontStyle: message.role === 'system' ? 'italic' : 'normal' }}
            >
              {message.text}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
