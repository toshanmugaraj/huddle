/// <reference types="vite/client" />

// Augments Vite's own ImportMetaEnv so import.meta.env.VITE_LANGFUSE_* is
// typed instead of falling back to `any` — see src/agent/langfuseTelemetry.ts
// for what each one does and why all three are optional.
interface ImportMetaEnv {
  readonly VITE_LANGFUSE_PUBLIC_KEY?: string;
  readonly VITE_LANGFUSE_SECRET_KEY?: string;
  readonly VITE_LANGFUSE_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
