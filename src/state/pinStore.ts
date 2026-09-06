import { create } from 'zustand';

interface PinState {
  /**
   * This widget's own best guess at whether it's pinned (see
   * AppRoutes.tsx's togglePin/compact-self-heal comment for why it's a
   * guess, not a ground truth read from the Widget API). Lifted out of
   * AppRoutes' local state — rather than a prop — so agent/tools.ts can
   * read the current value synchronously via `usePinStore.getState()` from
   * inside a tool callback, with no render-tree path from here to there.
   */
  pinned: boolean;
  setPinned: (pinned: boolean) => void;
}

export const usePinStore = create<PinState>((set) => ({
  pinned: false,
  setPinned: (pinned) => set({ pinned }),
}));
