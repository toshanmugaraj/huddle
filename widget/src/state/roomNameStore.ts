import { create } from 'zustand';

interface RoomNameState {
  names: Record<string, string>;
  setName: (roomId: string, name: string) => void;
}

/** Shared cache so a room name resolved from either screen (Settings' room list, Home's summary cards) shows up in both, not just wherever it was fetched. */
export const useRoomNameStore = create<RoomNameState>((set) => ({
  names: {},
  setName: (roomId, name) => set((state) => ({ names: { ...state.names, [roomId]: name } })),
}));
