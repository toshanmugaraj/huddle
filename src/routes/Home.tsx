import { useEffect, useState, type SyntheticEvent } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import { loadSettings, saveSettings } from '../matrix/settingsSync';
import { getRoomName } from '../matrix/rooms';
import { useResolveRoomNames } from '../matrix/useResolveRoomNames';
import { getMessagesSince } from '../matrix/messages';
import { summarizeRoom, prepareModel } from '../agent/summarize';
import { useSettingsStore } from '../state/settingsStore';
import { useSummaryStore, type RoomSummary } from '../state/summaryStore';
import { useModelStore } from '../state/modelStore';
import { useApiKeyStore } from '../state/apiKeyStore';
import { sanitizeSummaryHtml } from '../utils/sanitizeSummaryHtml';

const MAX_HISTORY_DAYS_BACK = 7;

/**
 * "Today" / "2 days" / ... — same "0 = today, N = N extra days back"
 * framing as settingsSync.ts's historyDaysBack doc comment, just the
 * compact form for the slider's own tick marks (see daysSentence below for
 * the prose form used in captions/the prompt sent to the model).
 */
function daysTickLabel(daysBack: number): string {
  const totalDays = daysBack + 1;
  return totalDays === 1 ? 'Today' : `${totalDays} days`;
}

/** "today" / "the last 2 days" / ... — the prose form, for a summary card's message-count caption. */
function daysSentence(daysBack: number): string {
  const totalDays = daysBack + 1;
  return totalDays === 1 ? 'today' : `the last ${totalDays} days`;
}

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
  // Which single room a per-card refresh (as opposed to the top-level Sync
  // across every room) is currently running for — at most one at a time,
  // same reasoning as handleSync's own comment on why it summarizes rooms
  // sequentially rather than in parallel: local mode's WebGPU inference
  // shares one GPU, so concurrent refreshes would just queue up behind each
  // other anyway, and letting a card's refresh race a full Sync (or another
  // card's refresh) would make "which run wrote this card's summary" murky.
  const [refreshingRoomId, setRefreshingRoomId] = useState<string | undefined>();

  useEffect(() => {
    if (loaded || !userId) return;
    loadSettings(widgetApi, userId).then((loadedSettings) => {
      setSettings(loadedSettings);
      setLoaded(true);
    });
  }, [widgetApi, userId, loaded, setSettings, setLoaded]);

  const roomNames = useResolveRoomNames(widgetApi, settings.roomIds);

  // One room's worth of the Sync flow: fetch its messages for the current
  // history range and summarize them. Shared by handleSync (looped across
  // every selected room) and handleRefreshRoom (a single card's refresh
  // button) so the two can't drift on what "syncing a room" means. Catches
  // its own errors rather than letting them propagate, same as handleSync's
  // per-room try/catch did before this was extracted — one room failing
  // (a room-specific fetch error, say) shouldn't abort a run that covers
  // other rooms too.
  const syncRoom = async (roomId: string): Promise<void> => {
    setSummary(roomId, { status: 'summarizing' });
    try {
      const roomName = await getRoomName(widgetApi, roomId);
      const messages = await getMessagesSince(widgetApi, roomId, settings.historyDaysBack);

      if (messages.length === 0) {
        setSummary(roomId, {
          roomName,
          status: 'no-messages',
          daysBack: settings.historyDaysBack,
          syncedAt: Date.now(),
        });
        return;
      }

      const summary = await summarizeRoom(roomName, messages, settings, geminiApiKey, settings.historyDaysBack);
      setSummary(roomId, {
        roomName,
        summary,
        messageCount: messages.length,
        daysBack: settings.historyDaysBack,
        status: 'done',
        syncedAt: Date.now(),
      });
    } catch (err) {
      setSummary(roomId, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

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
        setProgress(`Summarizing room ${i + 1} of ${settings.roomIds.length}…`);
        await syncRoom(settings.roomIds[i]);
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
      setProgress(undefined);
    }
  };

  // A single card's refresh button — re-syncs just that room, without
  // touching the others or requiring a full Sync pass. Guarded against a
  // full Sync (or another card's refresh) already being in flight for the
  // GPU-sharing reason on refreshingRoomId's declaration, not just to avoid
  // a double-click; the button itself is also disabled in that state (see
  // SummaryCard), this is the belt-and-suspenders check against the async
  // gap between a click and the disabled prop actually re-rendering.
  const handleRefreshRoom = async (roomId: string) => {
    if (syncing || refreshingRoomId) return;
    setRefreshingRoomId(roomId);
    try {
      if (settings.mode === 'local') {
        setModelStatus(settings.localModel, 'preparing');
        await prepareModel(settings.localModel);
        setModelStatus(settings.localModel, 'ready');
      }
      // Gemini mode's missing-API-key case isn't pre-checked here the way
      // handleSync checks it upfront — summarizeRoom already throws
      // MissingApiKeyError for that, and syncRoom's own catch turns it into
      // this one card's error status, which is exactly the right scope for
      // a single-room refresh (no need for a widget-wide banner over it).
      await syncRoom(roomId);
    } finally {
      setRefreshingRoomId(undefined);
    }
  };

  // Live while dragging (cheap, local-only) — persisting to the Matrix
  // state event on every pixel of drag would be both wasteful and, on a
  // slow connection, visibly laggy. Actual persistence happens once, in
  // handleHistoryCommit below, when the drag/keyboard interaction ends.
  const handleHistoryChange = (_event: Event, value: number | number[]) => {
    setSettings({ ...settings, historyDaysBack: Array.isArray(value) ? value[0] : value });
  };

  const handleHistoryCommit = (_event: Event | SyntheticEvent, value: number | number[]) => {
    const historyDaysBack = Array.isArray(value) ? value[0] : value;
    // Fire-and-forget: the slider (and the next Sync) already reflect the
    // new value locally via handleHistoryChange/setSettings regardless of
    // whether this write reaches the room — same "best effort, not
    // surfaced as a sync error" tradeoff as AppRoutes.tsx's pin toggle.
    void saveSettings(widgetApi, userId, { ...settings, historyDaysBack });
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
        {/* How far back Sync looks — 0 (the left end, and the default) is
            "today" only; see settingsSync.ts's historyDaysBack doc comment
            for why each step is framed as "one more day back" rather than
            "N total days" (the latter makes the first two positions
            indistinguishable). Persisted, so it survives a reload same as
            the rest of Settings — see handleHistoryCommit. */}
        <Slider
          size="small"
          value={settings.historyDaysBack}
          onChange={handleHistoryChange}
          onChangeCommitted={handleHistoryCommit}
          min={0}
          max={MAX_HISTORY_DAYS_BACK}
          step={1}
          marks
          valueLabelDisplay="auto"
          valueLabelFormat={daysTickLabel}
          disabled={syncing}
          sx={{ width: 120 }}
        />
        <Typography variant="body2" color="text.secondary">
          {daysTickLabel(settings.historyDaysBack)}
        </Typography>
        {progress && (
          <Typography variant="body2" color="text.secondary">
            {progress}
          </Typography>
        )}
      </Stack>

      {syncError && <Alert severity="error">{syncError}</Alert>}

      {settings.roomIds.map((roomId) => (
        <SummaryCard
          key={roomId}
          roomId={roomId}
          roomName={roomNames[roomId]}
          summary={summaries[roomId]}
          onRefresh={handleRefreshRoom}
          // Disabled during a full Sync (which is already about to
          // overwrite this card anyway) and while any single card's
          // refresh is in flight — including a different card's, per
          // refreshingRoomId's own comment on why only one runs at a time.
          refreshDisabled={syncing || !!refreshingRoomId}
          refreshing={refreshingRoomId === roomId}
        />
      ))}
    </Stack>
  );
}

function SummaryCard({
  roomId,
  roomName,
  summary,
  onRefresh,
  refreshDisabled,
  refreshing,
}: {
  roomId: string;
  roomName?: string;
  summary?: RoomSummary;
  onRefresh: (roomId: string) => void;
  refreshDisabled: boolean;
  refreshing: boolean;
}) {
  const title = summary?.roomName ?? roomName ?? roomId;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Typography variant="subtitle1">{title}</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <StatusChip status={summary?.status ?? 'idle'} />
            <Tooltip title={refreshing ? 'Refreshing…' : `Refresh just this room (${daysSentence(summary?.daysBack ?? 0)})`}>
              {/* span wrapper: IconButton's own disabled prop swallows the Tooltip's hover/focus listeners */}
              <span>
                <IconButton size="small" onClick={() => onRefresh(roomId)} disabled={refreshDisabled}>
                  {refreshing ? '⏳' : '🔄'}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {summary?.status === 'done' && (
          <>
            {/* summary.summary is model output sanitized to a tight tag
                allowlist by sanitizeSummaryHtml — see that file's comment
                for why this can't just be dangerouslySetInnerHTML'd as-is.
                '& li' margin is the reliable half of the instruction's
                "blank line between bullets" ask — models don't consistently
                emit the blank line that would make marked produce a loose
                list (same unreliability sanitizeSummaryHtml.ts's own doc
                comment already found with HTML-vs-Markdown compliance), so
                this doesn't depend on that to actually show up. */}
            <Box
              sx={{
                mt: 1,
                '& p': { m: 0, mb: 0.5 },
                '& ul': { mt: 0, mb: 0.5, pl: 3 },
                '& li': { mb: 1, '&:last-child': { mb: 0 } },
              }}
              dangerouslySetInnerHTML={{ __html: sanitizeSummaryHtml(summary.summary) }}
            />
            <Typography variant="caption" color="text.secondary">
              {summary.messageCount} message{summary.messageCount === 1 ? '' : 's'} from {daysSentence(summary.daysBack)}{' '}
              · synced {summary.syncedAt && new Date(summary.syncedAt).toLocaleTimeString()}
            </Typography>
          </>
        )}

        {summary?.status === 'no-messages' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No messages from {daysSentence(summary.daysBack)}.
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
    case 'no-messages':
      return <Chip size="small" label="No messages" />;
    case 'error':
      return <Chip size="small" color="error" label="Error" />;
    default:
      return <Chip size="small" label="Idle" />;
  }
}
