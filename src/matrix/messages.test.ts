import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockWidgetApi, type MockedWidgetApi } from '@matrix-widget-toolkit/testing';
import { getMessagesSince } from './messages';

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

describe('getMessagesSince', () => {
  let widgetApi: MockedWidgetApi;

  // Pinned so "today" is deterministic: 2024-06-15 12:00:00 local time,
  // i.e. local midnight for that day is a known, fixed timestamp.
  const NOW = new Date(2024, 5, 15, 12, 0, 0).getTime();
  const START_OF_TODAY = new Date(2024, 5, 15, 0, 0, 0).getTime();
  const START_OF_YESTERDAY = new Date(2024, 5, 14, 0, 0, 0).getTime();
  const START_OF_3_DAYS_AGO = new Date(2024, 5, 12, 0, 0, 0).getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    widgetApi?.stop();
  });

  it('with daysBack: 0, excludes messages from before local midnight and includes ones from today', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', START_OF_TODAY - 1000, 'yesterday'));
    widgetApi.mockSendRoomEvent(messageEvent('$2', START_OF_TODAY, 'right at midnight'));
    widgetApi.mockSendRoomEvent(messageEvent('$3', NOW, 'this afternoon'));

    const result = await getMessagesSince(widgetApi, ROOM_ID, 0);

    expect(result.messages.map((m) => m.body)).toEqual(['right at midnight', 'this afternoon']);
  });

  it('returns nothing when there are no messages yet today', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', START_OF_TODAY - 1000, 'yesterday'));

    const result = await getMessagesSince(widgetApi, ROOM_ID, 0);

    expect(result.messages).toEqual([]);
  });

  it('skips events with no text body', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', NOW, 'first'));
    widgetApi.mockSendRoomEvent({
      type: 'm.room.message',
      event_id: '$2',
      room_id: ROOM_ID,
      sender: '@alice:example.com',
      origin_server_ts: NOW,
      content: { msgtype: 'm.image' },
    });

    const result = await getMessagesSince(widgetApi, ROOM_ID, 0);

    expect(result.messages.map((m) => m.body)).toEqual(['first']);
  });

  it('with daysBack: 1, extends the window back to include yesterday too (2 calendar days total)', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', START_OF_YESTERDAY - 1000, '2 days ago'));
    widgetApi.mockSendRoomEvent(messageEvent('$2', START_OF_YESTERDAY, 'right at yesterday midnight'));
    widgetApi.mockSendRoomEvent(messageEvent('$3', NOW, 'this afternoon'));

    const result = await getMessagesSince(widgetApi, ROOM_ID, 1);

    expect(result.messages.map((m) => m.body)).toEqual(['right at yesterday midnight', 'this afternoon']);
  });

  it('with daysBack: 3, covers 4 calendar days total', async () => {
    widgetApi = mockWidgetApi();
    widgetApi.mockSendRoomEvent(messageEvent('$1', START_OF_3_DAYS_AGO - 1000, 'too old'));
    widgetApi.mockSendRoomEvent(messageEvent('$2', START_OF_3_DAYS_AGO, 'right at the cutoff'));
    widgetApi.mockSendRoomEvent(messageEvent('$3', NOW, 'this afternoon'));

    const result = await getMessagesSince(widgetApi, ROOM_ID, 3);

    expect(result.messages.map((m) => m.body)).toEqual(['right at the cutoff', 'this afternoon']);
  });

  describe('complete / availableDaysBack', () => {
    it('is complete, with availableDaysBack 0, when there are no messages loaded at all', async () => {
      widgetApi = mockWidgetApi();

      const result = await getMessagesSince(widgetApi, ROOM_ID, 3);

      expect(result).toMatchObject({ complete: true, availableDaysBack: 0 });
    });

    it('is complete when the earliest loaded message reaches back at least as far as the cutoff', async () => {
      widgetApi = mockWidgetApi();
      // Loaded history reaches back 3 days — exactly as far as requested.
      widgetApi.mockSendRoomEvent(messageEvent('$1', START_OF_3_DAYS_AGO, 'right at the cutoff'));
      widgetApi.mockSendRoomEvent(messageEvent('$2', NOW, 'this afternoon'));

      const result = await getMessagesSince(widgetApi, ROOM_ID, 3);

      expect(result).toMatchObject({ complete: true, availableDaysBack: 3 });
    });

    it('is NOT complete when the earliest loaded message is newer than the cutoff — Element just hasn’t loaded that far back', async () => {
      widgetApi = mockWidgetApi();
      // Only 1 day of history is actually loaded, but 3 were requested.
      widgetApi.mockSendRoomEvent(messageEvent('$1', START_OF_YESTERDAY, 'oldest loaded message'));
      widgetApi.mockSendRoomEvent(messageEvent('$2', NOW, 'this afternoon'));

      const result = await getMessagesSince(widgetApi, ROOM_ID, 3);

      expect(result).toMatchObject({ complete: false, availableDaysBack: 1 });
      // The messages themselves are still whatever falls inside the
      // (possibly under-covered) window — incompleteness is reported
      // alongside them, not hidden by returning fewer/no messages.
      expect(result.messages.map((m) => m.body)).toEqual(['oldest loaded message', 'this afternoon']);
    });

    it('availableDaysBack can exceed daysBack when more history happens to be loaded than requested', async () => {
      widgetApi = mockWidgetApi();
      widgetApi.mockSendRoomEvent(messageEvent('$1', START_OF_3_DAYS_AGO, 'well before the requested window'));
      widgetApi.mockSendRoomEvent(messageEvent('$2', NOW, 'this afternoon'));

      const result = await getMessagesSince(widgetApi, ROOM_ID, 1);

      expect(result).toMatchObject({ complete: true, availableDaysBack: 3 });
    });
  });
});
