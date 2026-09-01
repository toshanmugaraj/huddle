import { create } from 'zustand';

export type SummaryStatus = 'idle' | 'summarizing' | 'done' | 'no-unread' | 'error';

export interface RoomSummary {
  roomId: string;
  roomName: string;
  summary: string;
  unreadCount: number;
  syncedAt?: number;
  status: SummaryStatus;
  error?: string;
}

interface SummaryState {
  summaries: Record<string, RoomSummary>;
  setSummary: (roomId: string, patch: Partial<RoomSummary>) => void;
  reset: () => void;
}

/**
 * In-memory only, by design — this store is not persisted, so a reload
 * clears every summary. That matches the spec as given; if that ever needs
 * to survive a reload, the natural next step is localStorage or a room
 * state event, not a change to this store's shape.
 */
export const useSummaryStore = create<SummaryState>((set) => ({
  summaries: {},
  setSummary: (roomId, patch) =>
    set((state) => ({
      summaries: {
        ...state.summaries,
        [roomId]: { ...state.summaries[roomId], roomId, ...patch } as RoomSummary,
      },
    })),
  reset: () => set({ summaries: {} }),
}));
