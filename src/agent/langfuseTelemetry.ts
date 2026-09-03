/**
 * Wires Strands' own built-in OpenTelemetry tracing
 * (`@strands-agents/sdk/telemetry`) to Langfuse's OTLP ingestion endpoint —
 * entirely gated on optional build-time env vars (see .env.example; unset
 * by default, and this module never imports a single OTel package until
 * they're set).
 *
 * This REPLACES an earlier version of Langfuse support in this repo that
 * hand-built Langfuse trace/generation/span objects directly off Strands'
 * addHook() event API (BeforeModelCallEvent etc., still used by trace.ts's
 * console logger). That worked, but was reinventing something Strands
 * already ships and actively maintains: once `setupTracer()` is called,
 * the `Agent` class automatically emits real OTel spans for every model
 * call, tool call, agent-loop cycle, and even multi-agent/memory
 * operations — with proper GenAI semantic-convention attributes and token
 * usage the public hook events don't expose at all. Strands' own tracer
 * even special-cases Langfuse already: confirmed by reading the shipped
 * telemetry/tracer.js, it has a `_detectLangfuse()`/`_isLangfuse` check
 * that, once tripped, records message content as span *attributes* instead
 * of span *events* — its own comment says why: "the backend cannot read
 * span events" (Langfuse). No reason to duplicate any of that by hand.
 *
 * Two adaptations were needed to drive that built-in path from a browser
 * bundle rather than the Node CLI/server context it's mostly written for
 * (both verified against the actual shipped code, not just its doc
 * comments):
 *
 * 1. `setupTracer({ exporters: { otlp: true } })` builds its
 *    `OTLPTraceExporter` with no arguments, which reads
 *    `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS` off
 *    `process.env` — not a real thing in a Vite browser build. So this
 *    builds that exporter directly instead, pointed at Langfuse's OTLP
 *    endpoint with a Basic-Auth header, and hands the whole
 *    provider to `setupTracer()` via its documented "bring your own
 *    provider" config option (`setupTracer({ provider })`, which the SDK's
 *    config.ts registers as the global tracer provider itself — no need to
 *    call `.register()` separately, and no such method exists on this
 *    version's `BasicTracerProvider` regardless).
 * 2. The SDK's own Langfuse auto-detection reads `globalThis.process?.env`,
 *    which doesn't exist in a browser unless something defines it. This
 *    shims a minimal `process.env.LANGFUSE_BASE_URL` before calling
 *    `setupTracer()` so that detection fires — otherwise Langfuse would
 *    still receive spans, just with message content recorded in the form
 *    (span events) its own code says it can't read.
 *
 * What this does NOT fix, because Strands doesn't either: no
 * `AsyncLocalStorage`-based context propagation exists in a browser, so
 * span parent/child nesting across `await` boundaries is best-effort here,
 * same as Strands' own documented Node-unavailable fallback ("using
 * BasicTracerProvider without async context propagation" — see
 * telemetry/config.js). Not a gap this integration introduces; it's the
 * same tier Strands itself falls back to.
 *
 * IMPORTANT trust-model note, unchanged from before: this repo is a static
 * SPA with no backend (see Dockerfile's "No runtime env injection"
 * comment), so VITE_-prefixed env vars are baked into the built JS in
 * plain text and shipped to every browser that loads the widget — secret
 * key included. Only point this at a Langfuse project/instance you're fine
 * with every widget viewer being able to read the key out of the bundle
 * and write ingestion events to (a self-hosted instance reachable only
 * from your own network, or a disposable/scoped project) — see
 * .env.example. This is an operator-level decision made once at build/
 * deploy time, not a per-user one — unlike the Gemini API key (src/state/
 * apiKeyStore.ts), which is each user's own credential entered and stored
 * only in their own browser.
 */

export interface LangfuseTelemetryConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

const DEFAULT_HOST = 'https://cloud.langfuse.com';

export function getLangfuseConfig(): LangfuseTelemetryConfig | undefined {
  const env = import.meta.env;
  const publicKey = env.VITE_LANGFUSE_PUBLIC_KEY;
  const secretKey = env.VITE_LANGFUSE_SECRET_KEY;
  // Both keys required — deliberately not "public key only", since a
  // partially-configured deployment silently sending no traces is a much
  // safer failure mode than one silently sending malformed/unauthenticated
  // ones.
  if (!publicKey || !secretKey) return undefined;
  return { publicKey, secretKey, baseUrl: env.VITE_LANGFUSE_HOST || DEFAULT_HOST };
}

let initialized = false;

/**
 * Call once at app startup (see main.tsx) — idempotent, and safe to call
 * unconditionally: no-ops, without importing a single OTel package, when
 * getLangfuseConfig() returns undefined (the common case for anyone
 * building this repo from source without setting the env vars). Once
 * initialized, every Agent constructed anywhere in the app is traced
 * automatically — unlike the old per-agent attachLangfuseTracing(), there's
 * nothing left to call at chatAgent.ts's/summarize.ts's Agent construction
 * sites.
 */
export function initLangfuseTelemetry(): void {
  if (initialized) return;
  const config = getLangfuseConfig();
  if (!config) return;
  initialized = true;

  // Fire-and-forget: telemetry wiring failing (bad host, network blocked,
  // whatever) should never block the widget from rendering.
  void setup(config).catch((err) => {
    console.error('[huddle] Langfuse telemetry setup failed — continuing without it', err);
  });
}

async function setup(config: LangfuseTelemetryConfig): Promise<void> {
  const [{ setupTracer }, { BasicTracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }] =
    await Promise.all([
      import('@strands-agents/sdk/telemetry'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
    ]);

  // See file comment #2 above. Merges rather than overwrites in case
  // something else already shimmed a partial `process` (e.g. another
  // polyfill) — this can only ever add an `env` key the SDK reads for
  // Langfuse detection, never something like `getBuiltinModule` that would
  // wrongly trip its Node-provider branch (that branch checks for a real
  // function there, which nothing here provides).
  const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  g.process = { ...g.process, env: { ...g.process?.env, LANGFUSE_BASE_URL: config.baseUrl } };

  const exporter = new OTLPTraceExporter({
    url: `${config.baseUrl}/api/public/otel/v1/traces`,
    headers: { Authorization: `Basic ${btoa(`${config.publicKey}:${config.secretKey}`)}` },
  });

  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'huddle-widget' }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  setupTracer({ provider });
}
