import { create } from 'zustand';
import type { GemmaModelId } from '../model/GemmaEdgeModel';

export type ModelStatus = 'idle' | 'preparing' | 'ready' | 'error';

interface ModelState {
  /** Keyed by variant, since switching models in Settings re-triggers a separate load. */
  status: Record<GemmaModelId, ModelStatus>;
  error: Partial<Record<GemmaModelId, string>>;
  setStatus: (modelId: GemmaModelId, status: ModelStatus, error?: string) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  status: { 'gemma-4-e2b': 'idle', 'gemma-4-e4b': 'idle' },
  error: {},
  setStatus: (modelId, status, error) =>
    set((state) => ({
      status: { ...state.status, [modelId]: status },
      error: { ...state.error, [modelId]: error },
    })),
}));
