import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { getRoomName, getSenderInfo, type SenderInfo } from '../matrix/rooms';
import { getMessagesSince, type RoomMessage } from '../matrix/messages';
import { summarizeRoom, prepareModel, type SummaryTopic } from './summarize';
import { senderInfoKey } from '../state/senderInfoStore';
import type { HuddleSettings } from '../matrix/settingsSync';
import type { RoomSummary, RoomSummaryTopic } from '../state/summaryStore';
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
  settings: Pick<HuddleSettings, 'mode' | 'localModel' | 'geminiModel' | 'instruction' | 'historyDaysBack' | 'language'>;
  geminiApiKey: string;
  setSummary: (roomId: string, patch: Partial<RoomSummary>) => void;
  setModelStatus: (modelId: GemmaModelId, status: ModelStatus) => void;
  /**
   * senderInfoStore's getState().info/setInfo, passed through the same way
   * setSummary/setModelStatus already are — this is the one place
   * guaranteed to have a real widgetApi (the companion window doesn't), so
   * it's where every distinct message sender gets resolved+cached, letting
   * the companion pick the result up "for free" via hostBootstrap.ts's
   * existing store-push plumbing instead of needing a widgetApi of its own.
   */
  getCachedSenderInfo: (key: string) => SenderInfo | undefined;
  setSenderInfo: (key: string, info: SenderInfo) => void;
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
  const { widgetApi, settings, geminiApiKey, setSummary, getCachedSenderInfo, setSenderInfo } = ctx;
  setSummary(roomId, { status: 'summarizing' });
  try {
    const roomName = await getRoomName(widgetApi, roomId);
    const { messages, complete, availableDaysBack } = await getMessagesSince(
      widgetApi,
      roomId,
      settings.historyDaysBack,
    );

    // Eager, not on-demand: this is the one place guaranteed to have a real
    // widgetApi (see SyncContext's own doc comment on getCachedSenderInfo/
    // setSenderInfo) — resolving here means the companion window's "view
    // messages" dialog already has display names/avatars by the time it
    // needs them, with no widgetApi of its own to fetch them with. Deduped
    // against the cache so re-syncing a room doesn't re-fetch every sender
    // every time.
    const distinctSenders = [...new Set(messages.map((m) => m.sender))];
    await Promise.all(
      distinctSenders.map(async (sender) => {
        const key = senderInfoKey(roomId, sender);
        if (getCachedSenderInfo(key)) return;
        setSenderInfo(key, await getSenderInfo(widgetApi, roomId, sender));
      }),
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

    const topics = await summarizeRoom(roomName, messages, settings, geminiApiKey, settings.historyDaysBack);
    setSummary(roomId, {
      roomName,
      topics: resolveTopics(topics, messages),
      sourceMessages: messages,
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
 * summarizeRoom's SummaryTopic.messageIndices are 1-based positions into the
 * `messages` transcript it was given (see summarize.ts's buildTranscript) —
 * meaningless outside that one call. This resolves them into the real
 * eventIds the rest of the app (TopicMessagesDialog, in particular) actually
 * needs, dropping anything out of range defensively: the Zod schema only
 * validates that each entry is an integer, not that it's actually a valid
 * index, and message bodies (which the model sees as part of the same
 * prompt) are attacker-influenceable text — an out-of-range or hallucinated
 * index should never throw, just silently not resolve to a message.
 */
function resolveTopics(topics: SummaryTopic[], sourceMessages: RoomMessage[]): RoomSummaryTopic[] {
  return topics.map((topic) => ({
    title: topic.title,
    points: topic.points,
    messageIds: topic.messageIndices
      .map((n) => n - 1)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < sourceMessages.length)
      .map((i) => sourceMessages[i].eventId),
  }));
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
