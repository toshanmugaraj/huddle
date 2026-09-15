import { create } from 'zustand';
import type { RoomMessage } from '../matrix/messages';

/**
 * One topic from a room's summary, as actually stored/displayed — resolved
 * from agent/summarize.ts's schema-validated SummaryTopic (whose
 * messageIndices are 1-based positions into that one sync's transcript,
 * meaningless outside it) into real Matrix eventIds by agent/sync.ts's
 * resolveTopics, against `sourceMessages` below.
 */
export interface RoomSummaryTopic {
  title: string;
  points: string[];
  /** Matrix event IDs this topic cites, in the order the model listed them. Empty when the model couldn't attribute this topic to specific messages — SummaryCard renders it without the "view messages" affordance in that case; there's no heuristic fallback. */
  messageIds: string[];
}

export type SummaryStatus = 'idle' | 'summarizing' | 'done' | 'no-messages' | 'error';

export interface RoomSummary {
  roomId: string;
  roomName: string;
  topics: RoomSummaryTopic[];
  /**
   * The exact messages `topics` were generated from — kept (in-memory only,
   * same as everything else in this store) so a topic's `messageIds` can be
   * resolved into real sender/body/timestamp for the "view source messages"
   * dialog, without a second, possibly-drifted fetch at view time.
   */
  sourceMessages: RoomMessage[];
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
