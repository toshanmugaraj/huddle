import { useEffect } from 'react';
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { getSenderInfo, type SenderInfo } from './rooms';
import { useSenderInfoStore, senderInfoKey } from '../state/senderInfoStore';

/**
 * Live top-up on top of agent/sync.ts's eager per-sync resolution — same
 * "resolve as soon as known, backed by a shared cache" pattern as
 * useResolveRoomNames, but only does anything when a real WidgetApi is
 * given: the companion window structurally doesn't have one (see
 * senderInfoStore.ts's own comment) and relies solely on the host's pushed
 * snapshot instead. `widgetApi` is typed optional (rather than requiring
 * callers to skip calling this hook entirely) specifically so a shared
 * component like SummaryCard can call it unconditionally regardless of
 * which parent renders it — React's rules of hooks don't allow skipping a
 * hook call itself based on a prop.
 */
export function useResolveSenderInfo(
  widgetApi: WidgetApi | undefined,
  roomId: string,
  userIds: string[],
): Record<string, SenderInfo> {
  const info = useSenderInfoStore((s) => s.info);
  const setInfo = useSenderInfoStore((s) => s.setInfo);

  useEffect(() => {
    if (!widgetApi) return;
    userIds.forEach((userId) => {
      const key = senderInfoKey(roomId, userId);
      if (info[key]) return;
      getSenderInfo(widgetApi, roomId, userId).then((result) => setInfo(key, result));
    });
  }, [roomId, userIds, widgetApi, info, setInfo]);

  return info;
}
