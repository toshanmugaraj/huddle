import type { WidgetApi } from '@matrix-widget-toolkit/api';

export interface RoomMessage {
  eventId: string;
  sender: string;
  body: string;
  originServerTs: number;
}

interface MessageContent {
  msgtype?: string;
  body?: string;
}

async function fetchSortedTextMessages(widgetApi: WidgetApi, roomId: string) {
  const messages = await widgetApi.receiveRoomEvents<MessageContent>('m.room.message', {
    roomIds: [roomId],
  });
  return [...messages]
    .sort((a, b) => a.origin_server_ts - b.origin_server_ts)
    .filter((m) => typeof m.content.body === 'string' && m.content.body.length > 0);
}

function toRoomMessage(m: Awaited<ReturnType<typeof fetchSortedTextMessages>>[number]): RoomMessage {
  return {
    eventId: m.event_id,
    sender: m.sender,
    body: m.content.body as string,
    originServerTs: m.origin_server_ts,
  };
}

/**
 * `m.room.message` events in `roomId` sent since local midnight `daysBack`
 * days ago — `daysBack: 0` is "today" (this app's original, and still the
 * default, behavior), in whatever timezone the browser is in; `daysBack: N`
 * extends that window back to include the N previous calendar days too, so
 * the total span covered is N+1 calendar days. Backs the Home tab's
 * history slider (see Home.tsx and settingsSync.ts's `historyDaysBack` for
 * why it's framed as "extra days back," not "total days"). Regardless of
 * read state, and independent of any previous sync: unlike an unread/
 * bookmark approach, re-running Sync with nothing new since the last click
 * still returns (and re-summarizes) the same messages instead of finding
 * "nothing new" and clearing what was already shown.
 *
 * This app previously tracked "unread" via the Matrix `m.fully_read`
 * marker, falling back to a per-room last-sync timestamp. Dropped
 * entirely, not just because of the re-sync-clears-itself bug above: the
 * marker read needed `matrixWidgetApi.readRoomAccountData` (see
 * rawApi.ts), which is hard-wired to a Beeper-only action with no
 * mainline-Element handler, so it silently never worked on a real Element
 * client anyway — every sync fell through to the bookmark regardless.
 */
export async function getMessagesSince(
  widgetApi: WidgetApi,
  roomId: string,
  daysBack: number,
): Promise<RoomMessage[]> {
  const sorted = await fetchSortedTextMessages(widgetApi, roomId);
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);
  return sorted.filter((m) => m.origin_server_ts >= cutoff.getTime()).map(toRoomMessage);
}

/**
 * Last `limit` text messages in `roomId`, regardless of date or read
 * state — used by the chat tab's get_room_messages tool so the agent can
 * pull more context than "today" for a follow-up question. Same
 * underlying timeline read as getMessagesSince; the wrapped WidgetApi
 * surface has no server-side limit/pagination for it, so this fetches
 * everything available and slices client-side.
 */
export async function getRecentMessages(widgetApi: WidgetApi, roomId: string, limit: number): Promise<RoomMessage[]> {
  const sorted = await fetchSortedTextMessages(widgetApi, roomId);
  return sorted.slice(-limit).map(toRoomMessage);
}
