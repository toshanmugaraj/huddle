import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { rawWidgetApi } from './rawApi';

export interface UnreadMessage {
  eventId: string;
  sender: string;
  body: string;
  originServerTs: number;
}

interface MessageContent {
  msgtype?: string;
  body?: string;
}

/** First-run cap when there's neither a fully_read marker nor our own bookmark to anchor "unread" to. */
const MAX_FIRST_RUN_MESSAGES = 50;

async function fetchSortedTextMessages(widgetApi: WidgetApi, roomId: string) {
  const messages = await widgetApi.receiveRoomEvents<MessageContent>('m.room.message', {
    roomIds: [roomId],
  });
  return [...messages]
    .sort((a, b) => a.origin_server_ts - b.origin_server_ts)
    .filter((m) => typeof m.content.body === 'string' && m.content.body.length > 0);
}

function toUnreadMessage(m: Awaited<ReturnType<typeof fetchSortedTextMessages>>[number]): UnreadMessage {
  return {
    eventId: m.event_id,
    sender: m.sender,
    body: m.content.body as string,
    originServerTs: m.origin_server_ts,
  };
}

/**
 * "Unread" = `m.room.message` events in `roomId` newer than the user's
 * `m.fully_read` marker for that room, falling back to `sinceTs` (the
 * widget's own last-sync bookmark) when no marker exists yet.
 *
 * Reading the fully_read marker needs a raw escape hatch
 * (`matrixWidgetApi.readRoomAccountData`) because the wrapped
 * `@matrix-widget-toolkit/api` surface (confirmed against its actual
 * .d.ts) only covers state events and timeline room events — not room
 * account data, which is where read markers actually live.
 *
 * That escape hatch is NOT vendor-neutral, confirmed against this
 * matrix-widget-api version's own source: `readRoomAccountData()` is
 * hard-wired to the `com.beeper.read_room_account_data` action —
 * `WidgetApiFromWidgetAction.BeeperReadRoomAccountData`, a Beeper-only
 * extension, not a generic MSC. Mainline Element Web has no handler for
 * it, so on a real Element client this rejects every time. Caught and
 * treated the same as "no marker" (falls through to sinceTs/the
 * first-run cap below) rather than letting the whole Promise.all — and
 * therefore every Sync — fail.
 */
export async function getUnreadMessages(
  widgetApi: WidgetApi,
  roomId: string,
  sinceTs?: number,
): Promise<UnreadMessage[]> {
  const [sorted, markers] = await Promise.all([
    fetchSortedTextMessages(widgetApi, roomId),
    rawWidgetApi(widgetApi)
      .readRoomAccountData('m.fully_read', [roomId])
      .catch(() => []),
  ]);

  const marker = markers.find((m) => m.room_id === roomId);
  const readEventId = (marker?.content as { event_id?: string } | undefined)?.event_id;
  const readIndex = readEventId ? sorted.findIndex((m) => m.event_id === readEventId) : -1;

  const unread =
    readIndex !== -1
      ? sorted.slice(readIndex + 1)
      : sinceTs !== undefined
        ? sorted.filter((m) => m.origin_server_ts > sinceTs)
        : sorted.slice(-MAX_FIRST_RUN_MESSAGES);

  return unread.map(toUnreadMessage);
}

/**
 * Last `limit` text messages in `roomId`, regardless of read state — used
 * by the chat tab's get_room_messages tool so the agent can pull more
 * context than "unread" for a follow-up question. Same underlying
 * timeline read as getUnreadMessages; the wrapped WidgetApi surface has no
 * server-side limit/pagination for it, so this fetches everything
 * available and slices client-side.
 */
export async function getRecentMessages(
  widgetApi: WidgetApi,
  roomId: string,
  limit: number,
): Promise<UnreadMessage[]> {
  const sorted = await fetchSortedTextMessages(widgetApi, roomId);
  return sorted.slice(-limit).map(toUnreadMessage);
}
