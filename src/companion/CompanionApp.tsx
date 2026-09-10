import { useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { daysTickLabel, SummaryCard } from '../routes/Home';
import { connectCompanion, companionGetSnapshot, companionSyncAll, companionSyncRoom, subscribeCompanionPush } from './relay';
import type { CompanionSnapshot } from './hostBootstrap';
import type { HuddleSettings } from '../matrix/settingsSync';
import type { RoomSummary } from '../state/summaryStore';

type ConnectionState = 'connecting' | 'connected' | 'error';

/**
 * The popped-out companion window's whole UI (see popout.ts/relay.ts's file
 * comments for why this exists and what it can/can't do). Rendered by
 * main.tsx instead of the normal widget tree when `?companion=1` is in the
 * URL — NOT a Matrix Widget itself (no widgetId/parentUrl, no
 * WidgetApiImpl.create() call), just a plain page that talks to the real
 * widget (still open somewhere in Element) over relay.ts's BroadcastChannel
 * bridge.
 *
 * Deliberately thin: this never reads room data or runs a summarization
 * itself — every action (syncRoom/syncAll) is a request the HOST executes
 * (reusing agent/sync.ts, the exact same code path Home.tsx's own buttons
 * use), and this window just displays whatever the host's stores currently
 * hold, live, via subscribeCompanionPush. Two reasons: the host already has
 * a warmed-up local model (in local mode) — spinning up a second, multi-GB
 * WebGPU runtime in this tab just to duplicate that would be wasteful and
 * pointless — and Element's own history-loading ceiling (see
 * matrix/messages.ts's MessagesSinceResult doc comment) applies to the host
 * exactly the same either way, so there's nothing extra this window could
 * see by reading room data itself even if it could.
 */
export function CompanionApp() {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [connectError, setConnectError] = useState<string>();
  const [settings, setSettings] = useState<HuddleSettings>();
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [summaries, setSummaries] = useState<Record<string, RoomSummary>>({});

  const [syncingAll, setSyncingAll] = useState(false);
  const [refreshingRoomId, setRefreshingRoomId] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    connectCompanion()
      .then(() => companionGetSnapshot<CompanionSnapshot>())
      .then((snapshot) => {
        if (cancelled) return;
        setSettings(snapshot.settings);
        setRoomNames(snapshot.roomNames);
        setSummaries(snapshot.summaries);
        setConnection('connected');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setConnectError(err instanceof Error ? err.message : String(err));
        setConnection('error');
      });

    // Live updates from here on, regardless of what triggered them on the
    // host side (its own Sync, or this window's own syncRoom/syncAll calls
    // below) — see hostBootstrap.ts's store subscriptions.
    const unsubscribers = [
      subscribeCompanionPush<HuddleSettings>('settings', (data) => !cancelled && setSettings(data)),
      subscribeCompanionPush<Record<string, string>>('roomNames', (data) => !cancelled && setRoomNames(data)),
      subscribeCompanionPush<Record<string, RoomSummary>>('summaries', (data) => !cancelled && setSummaries(data)),
    ];

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsub) => unsub());
    };
  }, []);

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setActionError(undefined);
    try {
      await companionSyncAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingAll(false);
    }
  };

  // Same one-at-a-time guard as Home.tsx's handleRefreshRoom, for the same
  // reason (local mode's WebGPU inference shares one GPU on the host) —
  // this window and the main widget's own buttons both ultimately drive the
  // same host, so this guard only prevents this window's own double-clicks;
  // the host has no cross-window lock, but syncRoom/syncAllRooms already
  // run strictly sequentially wherever they're called from.
  const handleRefreshRoom = async (roomId: string) => {
    if (syncingAll || refreshingRoomId) return;
    setRefreshingRoomId(roomId);
    setActionError(undefined);
    try {
      await companionSyncRoom(roomId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingRoomId(undefined);
    }
  };

  if (connection === 'connecting') {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="text.secondary">Connecting to Huddle…</Typography>
      </Box>
    );
  }

  if (connection === 'error') {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{connectError}</Alert>
      </Box>
    );
  }

  if (!settings) return null;

  if (settings.roomIds.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">No rooms selected yet. Add rooms to summarize in the Settings tab.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Button variant="contained" onClick={handleSyncAll} disabled={syncingAll || !!refreshingRoomId}>
          {syncingAll ? 'Syncing…' : 'Sync all'}
        </Button>
        {/* Read-only here on purpose — the history-range slider stays on
            the main Home tab only; this window mirrors whatever it's
            currently set to rather than offering its own control for it,
            keeping the companion's RPC surface (and what it can trigger on
            the host) to just "run a sync," not "change settings." */}
        <Typography variant="body2" color="text.secondary">
          Syncing {daysTickLabel(settings.historyDaysBack)}
        </Typography>
      </Stack>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      <Stack spacing={2}>
        {settings.roomIds.map((roomId) => (
          <SummaryCard
            key={roomId}
            roomId={roomId}
            roomName={roomNames[roomId]}
            summary={summaries[roomId]}
            onRefresh={handleRefreshRoom}
            refreshDisabled={syncingAll || !!refreshingRoomId}
            refreshing={refreshingRoomId === roomId}
          />
        ))}
      </Stack>
    </Box>
  );
}
