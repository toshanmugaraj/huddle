import { create } from 'zustand';

export type SummaryStatus = 'idle' | 'summarizing' | 'done' | 'no-messages' | 'error';

export interface RoomSummary {
  roomId: string;
  roomName: string;
  summary: string;
  messageCount: number;
  /**
   * Same meaning as HuddleSettings.historyDaysBack, snapshotted at sync
   * time — so a card's "N messages over the last N+1 days" caption stays
   * accurate even if the user moves the history slider again afterward,
   * before running Sync again.
   */
  daysBack: number;
  /**
   * Same meaning as messages.ts's MessagesSinceResult — whether this room's
   * summary actually covers the full `daysBack` window, or whether Element
   * simply hadn't loaded that much local history for this room at sync
   * time (see getMessagesSince's doc comment on why the widget API can't
   * tell "quiet room" apart from "not loaded yet"). Surfaced on the card so
   * an incomplete window isn't presented as if it were a complete one.
   */
  complete: boolean;
  /** Same meaning as MessagesSinceResult.availableDaysBack, snapshotted at sync time alongside `complete`. */
  availableDaysBack: number;
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
