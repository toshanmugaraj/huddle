import { useEffect, useState, type SyntheticEvent } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { loadSettings, saveSettings } from '../matrix/settingsSync';
import { useResolveRoomNames } from '../matrix/useResolveRoomNames';
import { useResolveSenderInfo } from '../matrix/useResolveSenderInfo';
import { navigateElementTo } from '../matrix/rooms';
import { syncRoom as syncOneRoom, syncAllRooms, type SyncContext } from '../agent/sync';
import { prepareModel, dateRangeLabel } from '../agent/summarize';
import { useSettingsStore } from '../state/settingsStore';
import { useSummaryStore, type RoomSummary } from '../state/summaryStore';
import { useModelStore } from '../state/modelStore';
import { useApiKeyStore } from '../state/apiKeyStore';
import { useSenderInfoStore } from '../state/senderInfoStore';
import type { RoomMessage } from '../matrix/messages';
import { TopicMessagesDialog } from './TopicMessagesDialog';

const MAX_HISTORY_DAYS_BACK = 7;

/**
 * "Today" / "2 days" / ... — same "0 = today, N = N extra days back"
 * framing as settingsSync.ts's historyDaysBack doc comment, just the
 * compact form for the slider's own tick marks (see daysSentence below for
 * the prose form used in captions/the prompt sent to the model). Exported
 * for the companion window (companion/CompanionApp.tsx), which reuses
 * SummaryCard as-is rather than re-deriving its own copy of this label.
 */
export function daysTickLabel(daysBack: number): string {
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
  const [navigateError, setNavigateError] = useState<string | undefined>();
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

  const getCachedSenderInfo = useSenderInfoStore((s) => s.info);
  const setSenderInfo = useSenderInfoStore((s) => s.setInfo);

  // Built fresh each render (cheap — just references) rather than memoized:
  // syncRoom/syncAllRooms (agent/sync.ts) take this instead of closing over
  // component state directly, so the exact same functions also work from
  // the companion-window relay host (companion/hostBootstrap.ts), which has
  // no hooks/component of its own to close over.
  const syncCtx: SyncContext = {
    widgetApi,
    settings,
    geminiApiKey,
    setSummary,
    setModelStatus,
    getCachedSenderInfo: (key) => getCachedSenderInfo[key],
    setSenderInfo,
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(undefined);
    try {
      await syncAllRooms(syncCtx, settings.roomIds, setProgress);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
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
      // syncAllRooms checks it upfront — summarizeRoom already throws
      // MissingApiKeyError for that, and syncRoom's own catch turns it into
      // this one card's error status, which is exactly the right scope for
      // a single-room refresh (no need for a widget-wide banner over it).
      await syncOneRoom(syncCtx, roomId);
    } finally {
      setRefreshingRoomId(undefined);
    }
  };

  // Jumps the user's real Element client to a room — the manual-scrollback
  // workaround CoverageScale's own tooltip already describes, now one
  // click instead of finding the room by hand. Errors surfaced in a small
  // banner rather than per-card: this is a widget-wide capability (same
  // navigateElementTo every Chat-tab tool already uses), not something
  // that fails differently per room.
  const handleOpenInElement = (roomId: string) => {
    setNavigateError(undefined);
    navigateElementTo(widgetApi, roomId).catch((err: unknown) => {
      setNavigateError(err instanceof Error ? err.message : String(err));
    });
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
      {navigateError && <Alert severity="error">{navigateError}</Alert>}

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
          onOpenInElement={handleOpenInElement}
          // Enables SummaryCard's internal useResolveSenderInfo top-up —
          // the companion window (CompanionApp.tsx) omits this entirely,
          // since it has no WidgetApi of its own (see that hook's doc
          // comment) and relies solely on the host's pushed sender-info
          // cache instead.
          widgetApi={widgetApi}
        />
      ))}
    </Stack>
  );
}

/** Exported for the companion window (companion/CompanionApp.tsx), which renders the same cards driven by its own relay-backed refresh handler instead of Home's local one. */
export function SummaryCard({
  roomId,
  roomName,
  summary,
  onRefresh,
  refreshDisabled,
  refreshing,
  onOpenInElement,
  widgetApi,
}: {
  roomId: string;
  roomName?: string;
  summary?: RoomSummary;
  onRefresh: (roomId: string) => void;
  refreshDisabled: boolean;
  refreshing: boolean;
  onOpenInElement: (roomId: string) => void;
  /** Only Home.tsx passes this — see useResolveSenderInfo's own doc comment on why it's optional and what happens when it's omitted (the companion window's case). */
  widgetApi?: WidgetApi;
}) {
  const title = summary?.roomName ?? roomName ?? roomId;

  const distinctSenders = [...new Set((summary?.sourceMessages ?? []).map((m) => m.sender))];
  const senderInfo = useResolveSenderInfo(widgetApi, roomId, distinctSenders);

  // Which topic's messages (if any) the dialog is currently open for — a
  // resolved RoomMessage[], not just an index, since that's what
  // TopicMessagesDialog actually needs and resolving it here (once, on
  // click) is simpler than re-deriving it on every render the dialog stays
  // open for.
  const [openTopicMessages, setOpenTopicMessages] = useState<RoomMessage[]>();

  return (
    <>
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Typography variant="subtitle1">{title}</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <StatusChip status={summary?.status ?? 'idle'} />
              <Tooltip title="Open this room in Element — scrolling back further there loads more history for the next sync (see the coverage bar below).">
                <Button size="small" variant="text" onClick={() => onOpenInElement(roomId)}>
                  Open
                </Button>
              </Tooltip>
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
              {/* Each topic is real JSX (title + points as plain text) driven
                  directly by the model's schema-validated structured output
                  (agent/summarize.ts's RoomSummarySchema) — no HTML/Markdown
                  parsing or dangerouslySetInnerHTML involved at all any more.
                  A topic only gets the "💬 N" chip (opening
                  TopicMessagesDialog) when it actually cited messages —
                  there's no heuristic fallback when it didn't. */}
              <Box component="ul" sx={{ mt: 1, mb: 0, pl: 3 }}>
                {summary.topics.map((topic, i) => (
                  <Box component="li" key={i} sx={{ mb: 1, '&:last-child': { mb: 0 } }}>
                    <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                      {topic.title}
                    </Typography>
                    {topic.messageIds.length > 0 && (
                      <Chip
                        size="small"
                        label={`💬 ${topic.messageIds.length}`}
                        sx={{ ml: 1, verticalAlign: 'middle' }}
                        onClick={() =>
                          setOpenTopicMessages(
                            topic.messageIds
                              .map((id) => summary.sourceMessages.find((m) => m.eventId === id))
                              .filter((m): m is RoomMessage => !!m),
                          )
                        }
                      />
                    )}
                    <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
                      {topic.points.map((point, j) => (
                        <Typography component="li" variant="body2" key={j}>
                          {point}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Box>
              <CoverageScale summary={summary} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}>
                {dateRangeLabel(summary.daysBack)} · {summary.messageCount} message{summary.messageCount === 1 ? '' : 's'}
                {' '}· synced {summary.syncedAt && new Date(summary.syncedAt).toLocaleTimeString()}
              </Typography>
            </>
          )}

          {summary?.status === 'no-messages' && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No messages from {daysSentence(summary.daysBack)}.
              </Typography>
              <CoverageScale summary={summary} />
            </>
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
      {openTopicMessages && (
        <TopicMessagesDialog
          open
          onClose={() => setOpenTopicMessages(undefined)}
          roomId={roomId}
          messages={openTopicMessages}
          senderInfo={senderInfo}
        />
      )}
    </>
  );
}

/**
 * Visualizes how much of a card's requested history window is actually
 * backed by locally-loaded data — see messages.ts's MessagesSinceResult
 * doc comment for why that can fall short: the widget API can only read
 * whatever room history Element already has loaded locally, with no way
 * to request further homeserver backfill, so "no messages" or a short
 * summary can just as easily mean "Element hadn't loaded that far back"
 * as "the room was quiet." Shown on every synced card, not just
 * incomplete ones — a full bar is itself useful confirmation, and showing
 * it unconditionally means every room's status is visible at a glance
 * side by side, not just whichever one happens to be short.
 *
 * A single bar, oldest requested day on the left to today on the right
 * (natural reading order), filled green from the right for however much
 * is actually available locally. No literal dates on the bar itself — the
 * card's own date-range/message-count/synced-time caption sits right
 * below this (rendered by the caller, at the bottom of the card, right-
 * aligned), so repeating those same dates here would be redundant; this
 * bar's own caption instead gives the count ("2 of 3 days"), which that
 * one doesn't.
 */
function CoverageScale({ summary }: { summary: RoomSummary }) {
  const totalDays = summary.daysBack + 1;
  // Clamped: availableDaysBack can exceed daysBack (more local history than
  // was actually asked for — see MessagesSinceResult's own doc comment),
  // but this bar only ever represents the REQUESTED window, so covered
  // never visually exceeds 100% of it.
  const coveredDays = Math.min(summary.availableDaysBack + 1, totalDays);
  const coveredPct = Math.round((coveredDays / totalDays) * 100);

  const tooltip = summary.complete
    ? `Full local history available for the requested ${daysTickLabel(summary.daysBack)}.`
    : "Element only lets a widget read room history it's already loaded locally — it can't ask the " +
      "server for more. Use this card's Open button to jump to the room in Element, scroll back " +
      'further there so it loads, then refresh this card.';

  return (
    <Tooltip title={tooltip}>
      {/* mt: 3 — deliberately generous: this sits right after the topics
          list/summary text, and the two need to read as visually distinct
          blocks (the actual content vs. this card's sync metadata), not
          run together. */}
      <Box sx={{ mt: 3 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            height: 6,
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: 'action.disabledBackground',
          }}
        >
          <Box sx={{ width: `${coveredPct}%`, bgcolor: 'success.main' }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {coveredDays} of {totalDays} day{totalDays === 1 ? '' : 's'} synced locally
        </Typography>
      </Box>
    </Tooltip>
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
