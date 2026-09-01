import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import { loadSettings } from '../matrix/settingsSync';
import { getRoomName } from '../matrix/rooms';
import { useResolveRoomNames } from '../matrix/useResolveRoomNames';
import { getUnreadMessages } from '../matrix/unread';
import { summarizeRoom, prepareModel } from '../agent/summarize';
import { useSettingsStore } from '../state/settingsStore';
import { useSummaryStore, type RoomSummary } from '../state/summaryStore';
import { useModelStore } from '../state/modelStore';
import { useApiKeyStore } from '../state/apiKeyStore';
import { sanitizeSummaryHtml } from '../utils/sanitizeSummaryHtml';

export function Home() {
  const widgetApi = useWidgetApi();
  const userId = widgetApi.widgetParameters.userId ?? '';
  const { settings, loaded, setSettings, setLoaded } = useSettingsStore();
  const { summaries, setSummary } = useSummaryStore();
  const setModelStatus = useModelStore((s) => s.setStatus);
  const geminiApiKey = useApiKeyStore((s) => s.apiKey);

  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<string | undefined>();
  const [syncError, setSyncError] = useState<string | undefined>();

  useEffect(() => {
    if (loaded || !userId) return;
    loadSettings(widgetApi, userId).then((loadedSettings) => {
      setSettings(loadedSettings);
      setLoaded(true);
    });
  }, [widgetApi, userId, loaded, setSettings, setLoaded]);

  const roomNames = useResolveRoomNames(widgetApi, settings.roomIds);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(undefined);

    if (settings.mode === 'gemini' && !geminiApiKey) {
      setSyncError('Gemini mode is selected but no API key is set — add one in Settings.');
      setSyncing(false);
      return;
    }

    try {
      if (settings.mode === 'local') {
        setProgress('Preparing model…');
        setModelStatus(settings.localModel, 'preparing');
        await prepareModel(settings.localModel);
        setModelStatus(settings.localModel, 'ready');
      }

      // Sequential, not parallel — for local mode WebGPU inference shares
      // one GPU, so fanning out concurrent generateResponse() calls would
      // just queue up behind each other anyway; for Gemini mode it's kept
      // sequential too, mainly so per-room progress stays readable.
      for (let i = 0; i < settings.roomIds.length; i++) {
        const roomId = settings.roomIds[i];
        setProgress(`Summarizing room ${i + 1} of ${settings.roomIds.length}…`);
        setSummary(roomId, { status: 'summarizing' });

        try {
          const roomName = await getRoomName(widgetApi, roomId);
          const previousSync = summaries[roomId]?.syncedAt;
          const unread = await getUnreadMessages(widgetApi, roomId, previousSync);

          if (unread.length === 0) {
            setSummary(roomId, {
              roomName,
              status: 'no-unread',
              syncedAt: Date.now(),
            });
            continue;
          }

          const summary = await summarizeRoom(roomName, unread, settings, geminiApiKey);
          setSummary(roomId, {
            roomName,
            summary,
            unreadCount: unread.length,
            status: 'done',
            syncedAt: Date.now(),
          });
        } catch (err) {
          setSummary(roomId, {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
      setProgress(undefined);
    }
  };

  if (!loaded) {
    return <Typography color="text.secondary">Loading settings…</Typography>;
  }

  if (settings.roomIds.length === 0) {
    return (
      <Alert severity="info">
        No rooms selected yet. Add rooms to summarize in the Settings tab.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button variant="contained" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync'}
        </Button>
        {progress && (
          <Typography variant="body2" color="text.secondary">
            {progress}
          </Typography>
        )}
      </Stack>

      {syncError && <Alert severity="error">{syncError}</Alert>}

      {settings.roomIds.map((roomId) => (
        <SummaryCard key={roomId} roomId={roomId} roomName={roomNames[roomId]} summary={summaries[roomId]} />
      ))}
    </Stack>
  );
}

function SummaryCard({
  roomId,
  roomName,
  summary,
}: {
  roomId: string;
  roomName?: string;
  summary?: RoomSummary;
}) {
  const title = summary?.roomName ?? roomName ?? roomId;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Typography variant="subtitle1">{title}</Typography>
          <StatusChip status={summary?.status ?? 'idle'} />
        </Stack>

        {summary?.status === 'done' && (
          <>
            {/* summary.summary is model output sanitized to a tight tag
                allowlist by sanitizeSummaryHtml — see that file's comment
                for why this can't just be dangerouslySetInnerHTML'd as-is. */}
            <Box
              sx={{ mt: 1, '& p': { m: 0, mb: 0.5 }, '& ul': { mt: 0, mb: 0.5, pl: 3 } }}
              dangerouslySetInnerHTML={{ __html: sanitizeSummaryHtml(summary.summary) }}
            />
            <Typography variant="caption" color="text.secondary">
              {summary.unreadCount} unread message{summary.unreadCount === 1 ? '' : 's'} · synced{' '}
              {summary.syncedAt && new Date(summary.syncedAt).toLocaleTimeString()}
            </Typography>
          </>
        )}

        {summary?.status === 'no-unread' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No unread messages.
          </Typography>
        )}

        {summary?.status === 'error' && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {summary.error}
          </Alert>
        )}

        {(!summary || summary.status === 'idle') && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Not synced yet.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function StatusChip({ status }: { status: RoomSummary['status'] }) {
  switch (status) {
    case 'summarizing':
      return <Chip size="small" color="warning" label="Summarizing…" />;
    case 'done':
      return <Chip size="small" color="success" label="Done" />;
    case 'no-unread':
      return <Chip size="small" label="Up to date" />;
    case 'error':
      return <Chip size="small" color="error" label="Error" />;
    default:
      return <Chip size="small" label="Idle" />;
  }
}
