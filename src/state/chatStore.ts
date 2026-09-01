import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface PendingApproval {
  interruptId: string;
  roomId: string;
  text: string;
}

export interface SelectedRoom {
  roomId: string;
  roomName: string;
}

interface ChatState {
  messages: ChatMessage[];
  pendingApproval?: PendingApproval;
  /**
   * The room the conversation is currently about. There is no manual picker
   * for this any more — it's set by the set_selected_room tool (see
   * agent/tools.ts) whenever the agent resolves a room the user named, and
   * stays put across turns until that tool is called again with a
   * different room.
   */
  selectedRoom?: SelectedRoom;
  addMessage: (msg: ChatMessage) => void;
  setPendingApproval: (p?: PendingApproval) => void;
  setSelectedRoom: (room?: SelectedRoom) => void;
  reset: () => void;
}

/** In-memory only, same as the summary store — cleared on reload by design. */
export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  pendingApproval: undefined,
  selectedRoom: undefined,
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  setPendingApproval: (p) => set({ pendingApproval: p }),
  setSelectedRoom: (room) => set({ selectedRoom: room }),
  reset: () => set({ messages: [], pendingApproval: undefined, selectedRoom: undefined }),
}));
