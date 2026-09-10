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

/** Calendar days between `ts`'s local day and today's local day — 0 for today, 1 for yesterday, etc. Same "0 = today" convention as `daysBack` throughout this module. */
function daysBackOf(ts: number): number {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000));
}

export interface MessagesSinceResult {
  messages: RoomMessage[];
  /**
   * Whether the requested `daysBack` window is actually backed by data —
   * i.e. whether Element's *already-loaded* timeline for this room (see
   * this function's main doc comment on why that's the ceiling) reaches
   * back at least as far as the cutoff. `false` does NOT mean older
   * messages don't exist — it means this sync has no way to tell, because
   * nothing loaded locally reaches far enough back to confirm either way.
   * A quiet room with genuinely nothing before the cutoff looks identical
   * to a busy room Element just hasn't paginated back through yet; there's
   * no way to distinguish the two from inside the widget sandbox. Treated
   * as `true` when there are no messages loaded at all (vacuously — an
   * empty room isn't "missing" anything relative to the window).
   */
  complete: boolean;
  /**
   * How many calendar days back Element's *already-loaded* timeline for
   * this room actually reaches, independent of what was requested — i.e.
   * the real amount of local history available to summarize right now.
   * Can come in above `daysBack` (nothing to worry about — plenty of
   * headroom) or below it (see `complete`). 0 when there are no messages
   * loaded at all.
   */
  availableDaysBack: number;
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
 *
 * IMPORTANT caveat this function cannot work around: `receiveRoomEvents`
 * (via `fetchSortedTextMessages`) only ever returns events already sitting
 * in Element's local, in-memory timeline for this room — the widget API has
 * no capability to request further homeserver backfill/pagination by date
 * (verified against element-web's `ElementWidgetDriver.readRoomTimeline`,
 * which just walks `room.getLiveTimeline().getEvents()`; `since` there is
 * an event-ID cursor into that same in-memory set, not a timestamp). So a
 * large `daysBack` can silently return less than the real history if
 * Element hasn't happened to load/paginate that far back for this room —
 * see `complete`/`availableDaysBack` on the result, which callers should
 * surface rather than presenting a possibly-partial window as complete.
 */
export async function getMessagesSince(
  widgetApi: WidgetApi,
  roomId: string,
  daysBack: number,
): Promise<MessagesSinceResult> {
  const sorted = await fetchSortedTextMessages(widgetApi, roomId);
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);

  const messages = sorted.filter((m) => m.origin_server_ts >= cutoff.getTime()).map(toRoomMessage);

  // Coverage is judged against the *whole* locally-loaded set (sorted[0],
  // before the cutoff filter), not just what fell inside the window — the
  // earliest event Element has loaded at all is what tells us whether the
  // window is actually backed by data or just happens to be beyond
  // whatever's cached.
  const earliestLoadedTs = sorted[0]?.origin_server_ts;
  const availableDaysBack = earliestLoadedTs === undefined ? 0 : daysBackOf(earliestLoadedTs);
  const complete = earliestLoadedTs === undefined || earliestLoadedTs <= cutoff.getTime();

  return { messages, complete, availableDaysBack };
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
