import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { ElementAvatar } from '@matrix-widget-toolkit/mui';
import { translateMessages } from '../agent/translate';
import { useSettingsStore } from '../state/settingsStore';
import { useApiKeyStore } from '../state/apiKeyStore';
import type { RoomMessage } from '../matrix/messages';
import type { SenderInfo } from '../matrix/rooms';
import { senderInfoKey } from '../state/senderInfoStore';

/**
 * The original Matrix messages behind one summary topic, shown as a chat
 * timeline — sender avatar/name + timestamp header per bubble, then the
 * body. Reuses Chat.tsx's ChatBubble visual idiom (outlined Card,
 * maxWidth: '85%') but always left-aligns (there's no "my own message" side
 * here — this is showing other people's room history, not a conversation
 * the current viewer is having) and adds the avatar/name/timestamp header
 * ChatBubble doesn't need for its 3-role AI chat.
 *
 * `message.body` is rendered as plain, literal text (whiteSpace: 'pre-wrap'),
 * NOT run through sanitizeSummaryHtml/marked — a real Matrix message body is
 * plain text a room member typed, not Markdown a model wrote, so there's
 * nothing to render as HTML here; treating it as literal text is both
 * correct and marginally safer (one less dangerouslySetInnerHTML over
 * attacker-influenceable content).
 *
 * Translation (see agent/translate.ts) is opt-in via a "Translate" button,
 * only shown at all when Settings' language isn't "Auto" — manual, not
 * automatic on open, and confirmed with the user: it's a genuinely new
 * model call over messages the summary itself never touched, and for
 * local mode that's real, unprompted latency to impose on every chip
 * click if it fired automatically. Shows the translation ALONGSIDE the
 * original (not replacing it) — simplest, no hidden state, nothing lost
 * if the translation is imperfect.
 */
export function TopicMessagesDialog({
  open,
  onClose,
  roomId,
  messages,
  senderInfo,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  /** Already resolved from a topic's messageIds against RoomSummary.sourceMessages, in citation order. */
  messages: RoomMessage[];
  senderInfo: Record<string, SenderInfo>;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const geminiApiKey = useApiKeyStore((s) => s.apiKey);

  const [translations, setTranslations] = useState<string[]>();
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string>();

  const handleTranslate = async () => {
    setTranslating(true);
    setTranslateError(undefined);
    try {
      setTranslations(await translateMessages(messages, settings.language, settings, geminiApiKey));
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranslating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Source messages</DialogTitle>
      <DialogContent>
        {translateError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {translateError}
          </Alert>
        )}
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {messages.map((message, i) => (
            <MessageBubble
              key={message.eventId}
              message={message}
              sender={senderInfo[senderInfoKey(roomId, message.sender)]}
              translation={translations?.[i]}
            />
          ))}
        </Stack>
      </DialogContent>
      {settings.language && (
        <DialogActions>
          <Button size="small" onClick={handleTranslate} disabled={translating}>
            {translating ? 'Translating…' : `Translate to ${settings.language}`}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

function MessageBubble({
  message,
  sender,
  translation,
}: {
  message: RoomMessage;
  sender?: SenderInfo;
  /** Empty string means translateMessages couldn't find/produce one for this message specifically — not shown, same as undefined (no translation requested/finished yet). */
  translation?: string;
}) {
  const displayName = sender?.displayName ?? message.sender;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
      <Card variant="outlined" sx={{ maxWidth: '85%' }}>
        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <ElementAvatar userId={message.sender} displayName={displayName} avatarUrl={sender?.avatarUrl} sx={{ width: 24, height: 24 }} />
            <Typography variant="subtitle2">{displayName}</Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(message.originServerTs).toLocaleString()}
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {message.body}
          </Typography>
          {translation && (
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mt: 0.5, fontStyle: 'italic' }}>
              {translation}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
