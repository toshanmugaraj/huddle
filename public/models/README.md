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

- `gemma-4-E2B-it-web.litertlm` — **the supported model for now**,
  downloadable from
  [litert-community/gemma-4-E2B-it-litert-lm on Hugging Face](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/tree/main).
- `gemma-4-E4B-it-web.litertlm`

These exact filenames matter: the LiteRT-LM JS runtime currently only loads
a small allowlist of web-packaged `.litertlm` files (general `.litertlm`
support is on their roadmap, not here yet). As of this writing that
allowlist is exactly these two builds, from Google's `litert-community` org:
`litert-community/gemma-4-E2B-it-litert-lm` and
`litert-community/gemma-4-E4B-it-litert-lm`. Any other `.litertlm` —
including older gemma-3n builds, or a non-`-web` packaging of these same
models — fails to load, typically as `Invalid magic number. Expected
'LITERTLM', got '...'` even when the file is a genuine LiteRT-LM container.

Whether to still bundle one here is a real choice, not just "why not both":
- **Bundle**: every user of this deployment gets local mode working with
  zero setup on their end — good for a shared/multi-user room. Costs you
  the multi-GB image (slower builds, slower registry pushes, more disk).
- **Upload-only** (leave this directory empty): tiny, fast image — but
  *every* browser/device needs its own upload before local mode works,
  which is real per-person friction in a multi-user room.

If you do bundle one: pull the `-web.litertlm` file straight from the
`litert-community` repo for the variant you want (Hugging Face, under
Google's Gemma terms) — not any other mirror or repacking — drop it here
under exactly the filename above, and add a `.gitignore` entry for this
directory's `*.litertlm` files once this becomes a real git repo — don't
commit a multi-GB binary.
