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

interface ChatState {
  messages: ChatMessage[];
  pendingApproval?: PendingApproval;
  addMessage: (msg: ChatMessage) => void;
  setPendingApproval: (p?: PendingApproval) => void;
  reset: () => void;
}

/** In-memory only, same as the summary store — cleared on reload by design. */
export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  pendingApproval: undefined,
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  setPendingApproval: (p) => set({ pendingApproval: p }),
  reset: () => set({ messages: [], pendingApproval: undefined }),
}));
