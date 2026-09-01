import { GoogleModel } from '@strands-agents/sdk/models/google';

export type GeminiModelId = 'gemini-3.6-flash' | 'gemini-3.7-flash';

export const GEMINI_MODEL_OPTIONS: { id: GeminiModelId; label: string; note: string }[] = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (fast)', note: 'Balances speed and multimodal capability.' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (quality)', note: 'Newest stable Flash tier — better reasoning, slower.' },
];
// Google deprecates/rotates these fast enough that this list *will* go
// stale — it already has once (originally shipped as gemini-2.5-flash/-pro,
// replaced 2026-08-31 after the API itself started 404ing on 2.5-flash with
// "no longer available to new users... use models/gemini-3.6-flash").
// Picked the two current STABLE tiers (no "-preview" suffix) deliberately —
// those churn even faster. Reconfirm against
// https://ai.google.dev/gemini-api/docs/models the next time either 404s.

/**
 * Builds a Strands `Model` backed by Google's hosted Gemini API
 * (`@strands-agents/sdk/models/google`, which wraps `@google/genai`).
 * Unlike GemmaEdgeModel, this sends the prompt (i.e. the room's messages
 * from today) to Google's servers — that's the whole point of offering it as
 * an alternative to the on-device model, not an oversight. See Settings'
 * copy for the user-facing warning; this file doesn't gate on consent
 * itself, the caller does.
 *
 * A fresh instance is built per call rather than cached like
 * GemmaEdgeModel — there's no expensive local warm-up here (no WASM
 * runtime, no multi-GB weights), so there's nothing worth amortizing, and
 * it sidesteps a stale-API-key instance if the user edits it between syncs.
 */
export function createGeminiModel(apiKey: string, modelId: GeminiModelId) {
  return new GoogleModel({ apiKey, modelId });
}
