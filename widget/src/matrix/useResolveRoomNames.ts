import { useEffect } from 'react';
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { getRoomName } from './rooms';
import { useRoomNameStore } from '../state/roomNameStore';

/**
 * Resolves display names for `roomIds` as soon as they're known — a room
 * just added in Settings gets its name fetched immediately, rather than
 * only showing a resolved name after the first Sync completes. Backed by
 * the shared roomNameStore, so Home and Settings never resolve the same
 * room twice.
 */
export function useResolveRoomNames(widgetApi: WidgetApi, roomIds: string[]): Record<string, string> {
  const names = useRoomNameStore((s) => s.names);
  const setName = useRoomNameStore((s) => s.setName);

  useEffect(() => {
    roomIds.forEach((roomId) => {
      if (names[roomId]) return;
      getRoomName(widgetApi, roomId).then((name) => setName(roomId, name));
    });
  }, [roomIds, widgetApi, names, setName]);

  return names;
}
