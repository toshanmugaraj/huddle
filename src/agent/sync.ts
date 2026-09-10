import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { getRoomName } from '../matrix/rooms';
import { getMessagesSince } from '../matrix/messages';
import { summarizeRoom, prepareModel } from './summarize';
import type { HuddleSettings } from '../matrix/settingsSync';
import type { RoomSummary } from '../state/summaryStore';
import type { GemmaModelId } from '../model/GemmaEdgeModel';
import type { ModelStatus } from '../state/modelStore';

/**
 * Everything syncRoom/syncAllRooms need, pulled out of Home.tsx's own hooks
 * so both the Home tab and the companion-window relay host (hostBootstrap.ts
 * — neither a React component nor able to call hooks) can drive the same
 * Sync logic without duplicating it. Callers build this from wherever their
 * own state actually lives: Home.tsx from its hooks, the relay host from the
 * zustand stores' getState() directly.
 */
export interface SyncContext {
  widgetApi: WidgetApi;
  settings: Pick<HuddleSettings, 'mode' | 'localModel' | 'geminiModel' | 'instruction' | 'historyDaysBack'>;
  geminiApiKey: string;
  setSummary: (roomId: string, patch: Partial<RoomSummary>) => void;
  setModelStatus: (modelId: GemmaModelId, status: ModelStatus) => void;
}

/**
 * One room's worth of the Sync flow: fetch its messages for the current
 * history range and summarize them. Shared by syncAllRooms (looped across
 * every selected room) and a single card's refresh button — in both Home.tsx
 * and the companion window — so none of the three can drift on what
 * "syncing a room" means. Catches its own errors rather than letting them
 * propagate — one room failing (a room-specific fetch error, say) shouldn't
 * abort a run that covers other rooms too.
 */
export async function syncRoom(ctx: SyncContext, roomId: string): Promise<void> {
  const { widgetApi, settings, geminiApiKey, setSummary } = ctx;
  setSummary(roomId, { status: 'summarizing' });
  try {
    const roomName = await getRoomName(widgetApi, roomId);
    const { messages, complete, availableDaysBack } = await getMessagesSince(
      widgetApi,
      roomId,
      settings.historyDaysBack,
    );

    if (messages.length === 0) {
      setSummary(roomId, {
        roomName,
        status: 'no-messages',
        daysBack: settings.historyDaysBack,
        complete,
        availableDaysBack,
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
      complete,
      availableDaysBack,
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

/**
 * Full Sync across `roomIds` — model prep (local mode only) followed by
 * syncRoom for each room in turn. Sequential, not parallel: local mode's
 * WebGPU inference shares one GPU, so fanning out concurrent calls would
 * just queue up behind each other anyway; Gemini mode is kept sequential
 * too, mainly so per-room progress stays readable.
 *
 * Throws (rather than catching, unlike syncRoom) on a missing Gemini key or
 * a model-prep failure — those abort the whole run, not just one room — so
 * callers decide how to surface that: Home.tsx as a `syncError` banner, the
 * relay host as an RPC rejection the companion's own action error shows.
 */
export async function syncAllRooms(
  ctx: SyncContext,
  roomIds: string[],
  onProgress?: (message: string | undefined) => void,
): Promise<void> {
  if (ctx.settings.mode === 'gemini' && !ctx.geminiApiKey) {
    throw new Error('Gemini mode is selected but no API key is set — add one in Settings.');
  }

  try {
    if (ctx.settings.mode === 'local') {
      onProgress?.('Preparing model…');
      ctx.setModelStatus(ctx.settings.localModel, 'preparing');
      await prepareModel(ctx.settings.localModel);
      ctx.setModelStatus(ctx.settings.localModel, 'ready');
    }

    for (let i = 0; i < roomIds.length; i++) {
      onProgress?.(`Summarizing room ${i + 1} of ${roomIds.length}…`);
      await syncRoom(ctx, roomIds[i]);
    }
  } finally {
    onProgress?.(undefined);
  }
}
