# Chat Summary widget

A Nordeck-toolkit Matrix widget that summarizes unread messages across
rooms you choose, entirely on-device — no backend, no network call carries
message content anywhere. See `../spike-webgpu` for the WebGPU/iframe
feasibility check this design is built on.

## How it works

- **Settings**: add rooms by ID/alias, pick a Gemma variant, edit the
  summary instruction. Persisted as a state event in the widget's own room
  (`io.github.chatsummary.settings`, state-keyed per user).
- **Home**: hit **Sync** to walk your selected rooms one at a time, compute
  each room's unread messages (see `src/matrix/unread.ts`), and summarize
  them with a Strands `Agent` (`src/agent/summarize.ts`) backed by a custom
  `Model` (`src/model/GemmaEdgeModel.ts`) that runs a quantized Gemma model
  in-browser via Google's LiteRT-LM Web runtime (`@litert-lm/core`, WebGPU).
  Summaries live in an in-memory store (`src/state/summaryStore.ts`) — a
  reload clears them, by design.

## Before it'll actually summarize anything

Drop the two Gemma `.litertlm` weight files into `public/models/` — see
`public/models/README.md`. Without them, "Prepare model" will fail with a
404, cleanly (the UI surfaces the error; nothing else breaks).

## Running it

```sh
npm install
npm run dev     # https://localhost:5174 (self-signed cert)
```

Same mixed-content/cert caveat as the spike: visit the URL directly first
and click through the certificate warning, *then* add it as a custom
widget in an Element room (Room settings → Widgets → Add a widget →
Custom).

```sh
npm run build   # production bundle, dist/
npm test        # vitest — unread-detection logic covered so far
```

## Deploying

Registryless deploy to the `gamma-context` cluster's `ess` namespace,
pinned to node `mobtest1`, at `dune.wahatbh.com` — see the
`deploy-mobtest1` skill for the generic version of this flow (this app is
one of its worked examples, alongside CrewBoard).

```sh
./deploy/deploy-registryless.sh
```

Builds this repo's own `Dockerfile`, ships the image straight into
`mobtest1`'s containerd (no registry), and `helm upgrade --install`s the
chart at `../../Kube/chat-summary/charts/chat-summary-widget` (i.e.
`Kube/chat-summary/...` next to this repo's own parent dir). Drop the Gemma
weight files into `public/models/` (see that dir's README) *before*
deploying, or bake them into the image — otherwise Prepare model will 404
in production the same way it does locally without them.

## Known follow-ups (not yet built)

- **Model-load progress** is an indeterminate spinner, not a real byte
  progress bar — `Engine.create()` doesn't expose one directly for either
  model source (bundled URL or uploaded `Blob`); a real bar means fetching
  the weight file by hand and wrapping it in a `ReadableStream` that reports
  bytes as they pass through, then passing that stream as `model` instead.
- **Theme live-sync** (`main.tsx`'s `ThemeSync`) reads the to-widget
  `theme_change` payload defensively (`name`/`theme` fields) since
  matrix-widget-api's own types only say "arbitrary contents" — verify
  against a real Element session if it doesn't take effect.
- **Mobile Element** is out of scope — WebGPU + a multi-GB local model
  isn't realistic in a mobile webview; there's no feature-detect banner
  for that yet.
- Only the `getUnreadMessages` logic has tests so far; the screens and
  `GemmaEdgeModel` don't.
