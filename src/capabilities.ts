import {
  EventDirection,
  MatrixCapabilities,
  Symbols,
  WidgetEventCapability,
  type Capability,
} from 'matrix-widget-api';

/** Custom state event type this widget uses to persist its own settings (per-user, in its own room). */
export const SETTINGS_EVENT_TYPE = 'io.github.chatsummary.settings';

/**
 * Full capability list requested at widget add-time. Element only prompts
 * once at add-time (per the nordeck-widget skill), so everything the widget
 * will ever need is requested up front here rather than ad-hoc later.
 */
export function buildCapabilities(): Array<WidgetEventCapability | Capability> {
  return [
    // Message content across every room the user has joined — not just
    // this widget's own room — for today's-messages detection (see
    // matrix/messages.ts) and the chat tab's get_room_messages tool.
    `org.matrix.msc2762.timeline:${Symbols.AnyRoom}`,
    WidgetEventCapability.forRoomEvent(EventDirection.Receive, 'm.room.message'),

    // Room metadata for the room picker and summary cards.
    WidgetEventCapability.forStateEvent(EventDirection.Receive, 'm.room.name'),
    WidgetEventCapability.forStateEvent(EventDirection.Receive, 'm.room.member'),

    // This widget's own settings — state events in its own room only, so no
    // AnyRoom scope is requested for these two.
    WidgetEventCapability.forStateEvent(EventDirection.Receive, SETTINGS_EVENT_TYPE),
    WidgetEventCapability.forStateEvent(EventDirection.Send, SETTINGS_EVENT_TYPE),

    // Chat tab tools (both modes — see agent/tools.ts). Send is
    // real-world-consequential, which is exactly why the send_message tool
    // pauses on a Strands `Interrupt` for the user to approve before this
    // capability actually gets used to post anything.
    WidgetEventCapability.forRoomEvent(EventDirection.Send, 'm.room.message'),
    MatrixCapabilities.MSC2931Navigate,

    // Pin/unpin (AppRoutes.tsx's header toggle) — lets the widget ask to
    // stay mounted and visible when the user navigates to a different
    // room, instead of unmounting with the room it was added to.
    MatrixCapabilities.AlwaysOnScreen,
  ];
}
