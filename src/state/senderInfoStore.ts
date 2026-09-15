import { create } from 'zustand';
import type { SenderInfo } from '../matrix/rooms';

/** `${roomId}:${userId}` — a sender's display info can differ per room (room-specific displayname/avatar overrides are a real Matrix feature), so this can't be keyed by userId alone the way a single global profile cache could be. */
export function senderInfoKey(roomId: string, userId: string): string {
  return `${roomId}:${userId}`;
}

interface SenderInfoState {
  info: Record<string, SenderInfo>;
  setInfo: (key: string, info: SenderInfo) => void;
}

/**
 * Shared cache, same role as roomNameStore.ts but for message senders —
 * resolved once (in agent/sync.ts, eagerly, for every distinct sender in a
 * synced room, since that's the one place guaranteed to have a real
 * widgetApi) and read from here by both Home.tsx's live top-up
 * (useResolveSenderInfo) and the companion window, which has no widgetApi
 * of its own and only ever sees this store's contents via
 * hostBootstrap.ts's broadcastPush + CompanionApp.tsx's matching
 * subscribeCompanionPush — see those files' own comments.
 */
export const useSenderInfoStore = create<SenderInfoState>((set) => ({
  info: {},
  setInfo: (key, info) => set((state) => ({ info: { ...state.info, [key]: info } })),
}));
