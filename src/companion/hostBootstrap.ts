import { widgetApiPromise } from '../widget';
import { useSettingsStore } from '../state/settingsStore';
import { useApiKeyStore } from '../state/apiKeyStore';
import { useSummaryStore } from '../state/summaryStore';
import { useRoomNameStore } from '../state/roomNameStore';
import { useSenderInfoStore } from '../state/senderInfoStore';
import { useModelStore } from '../state/modelStore';
import { syncRoom, syncAllRooms, type SyncContext } from '../agent/sync';
import { navigateElementTo } from '../matrix/rooms';
import { startRelayHost, broadcastPush, isCompanion } from './relay';

/** Shape handed to the companion window by the 'getSnapshot' RPC (see relay.ts) and mirrored by the four store pushes below — CompanionApp.tsx's initial-load type. */
export interface CompanionSnapshot {
  settings: ReturnType<typeof useSettingsStore.getState>['settings'];
  roomNames: ReturnType<typeof useRoomNameStore.getState>['names'];
  summaries: ReturnType<typeof useSummaryStore.getState>['summaries'];
  senderInfo: ReturnType<typeof useSenderInfoStore.getState>['info'];
}

/**
 * Starts the companion-window relay host once the real Widget API is ready.
 * Call once from main.tsx's non-companion path. No-op in a companion window
 * itself (isCompanion) — a companion never hosts, only connects to one.
 *
 * Wiring is deliberately generic over the zustand stores rather than
 * anything React-specific: settings/roomNames/summaries are forwarded to any
 * open companions on every change regardless of what triggered it — the
 * host's own Home tab syncing, or a companion's syncRoom/syncAll request
 * (which goes through the exact same setSummary calls, via agent/sync.ts,
 * as the host's own UI) — so there's no special-casing needed for "who
 * caused this update."
 */
export function startCompanionHost(): void {
  if (isCompanion) return;

  widgetApiPromise.then((widgetApi) => {
    const buildSyncCtx = (): SyncContext => ({
      widgetApi,
      settings: useSettingsStore.getState().settings,
      geminiApiKey: useApiKeyStore.getState().apiKey,
      setSummary: useSummaryStore.getState().setSummary,
      setModelStatus: useModelStore.getState().setStatus,
      getCachedSenderInfo: (key) => useSenderInfoStore.getState().info[key],
      setSenderInfo: useSenderInfoStore.getState().setInfo,
    });

    startRelayHost({
      syncRoom: (roomId) => syncRoom(buildSyncCtx(), roomId),
      syncAll: () => {
        const roomIds = useSettingsStore.getState().settings.roomIds;
        return syncAllRooms(buildSyncCtx(), roomIds);
      },
      getSnapshot: (): CompanionSnapshot => ({
        settings: useSettingsStore.getState().settings,
        roomNames: useRoomNameStore.getState().names,
        summaries: useSummaryStore.getState().summaries,
        senderInfo: useSenderInfoStore.getState().info,
      }),
      navigateTo: (roomId) => navigateElementTo(widgetApi, roomId),
    });

    // Live-forward every change from here on — a companion that's already
    // open picks these up directly; one that opens later gets caught up via
    // its own getSnapshot pull on connect (see CompanionApp.tsx), not by
    // anything broadcast here (postMessage has no replay/history, so a push
    // made before a companion existed is simply never seen by it).
    useSettingsStore.subscribe((state) => broadcastPush('settings', state.settings));
    useRoomNameStore.subscribe((state) => broadcastPush('roomNames', state.names));
    useSummaryStore.subscribe((state) => broadcastPush('summaries', state.summaries));
    useSenderInfoStore.subscribe((state) => broadcastPush('senderInfo', state.info));
  });
}
