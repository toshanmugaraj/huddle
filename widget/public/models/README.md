# Model weights — optional, fallback only

The primary way to get a Gemma model into this widget is now **uploading it
in Settings** (local mode → "Upload model file") — it's stored in the
browser's Origin Private File System, per device, and `GemmaEdgeModel`
prefers it automatically over anything here. See `src/model/modelStorage.ts`
for how that works and why (short version: baking a multi-GB weight file
into every Docker image build/push was real, avoidable overhead once
per-browser upload was an option).

Files placed in this directory are a **fallback only**, used when nothing's
been uploaded yet — `MODEL_ASSET_PATHS` in `GemmaEdgeModel.ts`:

- `gemma-3n-E2B-it-int4-Web.litertlm`
- `gemma-3n-E4B-it-int4-Web.litertlm`

Whether to still bundle one here is a real choice, not just "why not both":
- **Bundle**: every user of this deployment gets local mode working with
  zero setup on their end — good for a shared/multi-user room. Costs you
  the multi-GB image (slower builds, slower registry pushes, more disk).
- **Upload-only** (leave this directory empty): tiny, fast image — but
  *every* browser/device needs its own upload before local mode works,
  which is real per-person friction in a multi-user room.

If you do bundle one: get the web-optimized (`-Web` suffix), int4-quantized
`.litertlm` build from Google's official distribution (Kaggle Models /
Hugging Face, under Google's Gemma terms), drop it here under exactly the
filename above, and add a `.gitignore` entry for this directory's
`*.litertlm` files once this becomes a real git repo — don't commit a
multi-GB binary.
