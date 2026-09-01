import type { WidgetApi } from '@matrix-widget-toolkit/api';

/** Best-effort display name for a room the widget isn't necessarily "in" (AnyRoom-scoped read). */
export async function getRoomName(widgetApi: WidgetApi, roomId: string): Promise<string> {
  const events = await widgetApi.receiveStateEvents<{ name?: string }>('m.room.name', {
    roomIds: [roomId],
  });
  const event = events.find((e) => e.room_id === roomId && e.state_key === '');
  return event?.content.name?.trim() || roomId;
}
