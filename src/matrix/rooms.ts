import type { WidgetApi } from '@matrix-widget-toolkit/api';

/**
 * A matrix.to permalink send — jumps the user's actual Element client to
 * `roomId`. Shared by agent/tools.ts's navigate_to_room/set_selected_room
 * tools and Home.tsx's per-card "open in Element" button (see that file
 * for why: it's the same manual-scrollback workaround CoverageNote's own
 * tooltip already points people to, just one click instead of finding the
 * room themselves).
 */
export async function navigateElementTo(widgetApi: WidgetApi, roomId: string): Promise<void> {
  // NOT encodeURIComponent(roomId): a matrix.to permalink's fragment takes
  // the room ID literally ("!abc123:example.com"), unencoded.
  // matrix-widget-api only checks the URI starts with "https://matrix.to/#"
  // (it does either way, so this never errors), then hands the string
  // straight to Element's own permalink parser — which expects the raw ":"
  // and doesn't decode "%3A" back out of it, so an encoded roomId silently
  // resolves to nothing instead of throwing. Room IDs only ever contain
  // fragment-safe characters anyway (opaque ID + a hostname), so there's
  // nothing to escape.
  await widgetApi.navigateTo(`https://matrix.to/#/${roomId}`);
}

/** Best-effort display name for a room the widget isn't necessarily "in" (AnyRoom-scoped read). */
export async function getRoomName(widgetApi: WidgetApi, roomId: string): Promise<string> {
  const events = await widgetApi.receiveStateEvents<{ name?: string }>('m.room.name', {
    roomIds: [roomId],
  });
  const event = events.find((e) => e.room_id === roomId && e.state_key === '');
  return event?.content.name?.trim() || roomId;
}

export interface SenderInfo {
  displayName: string;
  /** Raw `avatar_url` from the member event (an `mxc://` URI, or undefined) — pass straight through to `ElementAvatar`'s `avatarUrl` prop, which resolves `mxc://` itself; don't pre-convert it here. */
  avatarUrl?: string;
}

/**
 * Best-effort display name + avatar for one room member — same "AnyRoom,
 * fall back to the raw ID" shape as getRoomName above, but can filter
 * server-side by `stateKey` directly (unlike getRoomName, which has to
 * fetch-then-filter since `m.room.name` only ever has one state key, `''`)
 * since `m.room.member` is keyed per user.
 */
export async function getSenderInfo(widgetApi: WidgetApi, roomId: string, userId: string): Promise<SenderInfo> {
  const events = await widgetApi.receiveStateEvents<{ displayname?: string; avatar_url?: string }>('m.room.member', {
    roomIds: [roomId],
    stateKey: userId,
  });
  const event = events.find((e) => e.room_id === roomId && e.state_key === userId);
  return {
    displayName: event?.content.displayname?.trim() || userId,
    avatarUrl: event?.content.avatar_url,
  };
}
