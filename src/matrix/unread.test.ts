import { describe, expect, it, vi } from 'vitest';
import { mockWidgetApi, type MockedWidgetApi } from '@matrix-widget-toolkit/testing';
import { getUnreadMessages } from './unread';

const ROOM_ID = '!room-id:example.com';

function messageEvent(eventId: string, ts: number, body: string) {
  return {
    type: 'm.room.message',
    event_id: eventId,
    room_id: ROOM_ID,
    sender: '@alice:example.com',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body },
  };
}

describe('getUnreadMessages', () => {
  let widgetApi: MockedWidgetApi;

  function withAccountData(markerEventId?: string) {
    // The wrapped WidgetApi type doesn't declare `matrixWidgetApi` (see
    // rawApi.ts) — the mock doesn't know about it either, so it's added
    // manually here, same pattern the nordeck-widget skill documents for
    // testing raw-escape-hatch calls.
    (widgetApi as unknown as { matrixWidgetApi: unknown }).matrixWidgetApi = {
      readRoomAccountData: vi.fn().mockResolvedValue(
        markerEventId
          ? [{ type: 'm.fully_read', room_id: ROOM_ID, content: { event_id: markerEventId } }]
          : [],
      ),
    };
  }

  it('returns messages after the fully_read marker', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', 100, 'first'));
    widgetApi.mockSendRoomEvent(messageEvent('$2', 200, 'second'));
    widgetApi.mockSendRoomEvent(messageEvent('$3', 300, 'third'));
    withAccountData('$1');

    const unread = await getUnreadMessages(widgetApi, ROOM_ID);

    expect(unread.map((m) => m.body)).toEqual(['second', 'third']);
    widgetApi.stop();
  });

  it('falls back to the sinceTs bookmark when there is no marker', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', 100, 'first'));
    widgetApi.mockSendRoomEvent(messageEvent('$2', 200, 'second'));
    withAccountData(undefined);

    const unread = await getUnreadMessages(widgetApi, ROOM_ID, 100);

    expect(unread.map((m) => m.body)).toEqual(['second']);
    widgetApi.stop();
  });

  it('skips events with no text body', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', 100, 'first'));
    widgetApi.mockSendRoomEvent({
      type: 'm.room.message',
      event_id: '$2',
      room_id: ROOM_ID,
      sender: '@alice:example.com',
      origin_server_ts: 200,
      content: { msgtype: 'm.image' },
    });
    withAccountData(undefined);

    const unread = await getUnreadMessages(widgetApi, ROOM_ID, 0);

    expect(unread.map((m) => m.body)).toEqual(['first']);
    widgetApi.stop();
  });
});
