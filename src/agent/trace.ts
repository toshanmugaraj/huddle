import {
  type Agent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  MessageAddedEvent,
  InterruptEvent,
  AgentResultEvent,
} from '@strands-agents/sdk';

/**
 * Console-logs the sequence of model calls, tool calls, messages, and
 * interrupts for one Agent, via Strands' hook system
 * (agent.addHook(EventClass, callback) — confirmed against the shipped
 * .d.ts, not the docs site). This is the lightweight, always-on option for
 * "let me see what's happening while testing in devtools" — no setup, no
 * env vars.
 *
 * For real observability backends (Langfuse), see langfuseTelemetry.ts
 * instead: Strands' Agent class already emits full OpenTelemetry spans for
 * every model/tool/loop call on its own once telemetry.setupTracer() is
 * called — that's a one-time app-startup call (main.tsx), not a per-Agent
 * hook like this function, and there's nothing to call at this file's
 * call sites (chatAgent.ts/summarize.ts) to opt an Agent into it.
 *
 * Call once per Agent instance, right after construction. Returns a
 * cleanup function that removes all the hooks (each addHook call returns
 * its own cleanup; this just batches them).
 */
export function attachTraceLogging(agent: Agent, label: string): () => void {
  const tag = `[huddle:${label}]`;
  const cleanups = [
    agent.addHook(BeforeModelCallEvent, (e) => {
      console.log(`${tag} model call → ${e.model.modelId ?? '(unknown model)'}`, {
        projectedInputTokens: e.projectedInputTokens,
      });
    }),
    agent.addHook(AfterModelCallEvent, (e) => {
      if (e.error) {
        console.error(`${tag} model call failed (attempt ${e.attemptCount})`, e.error);
      } else {
        console.log(`${tag} model call done (attempt ${e.attemptCount}) → stopReason=${e.stopData?.stopReason}`);
      }
    }),
    agent.addHook(BeforeToolCallEvent, (e) => {
      console.log(`${tag} tool call → ${e.toolUse.name}`, e.toolUse.input);
    }),
    agent.addHook(AfterToolCallEvent, (e) => {
      if (e.error) {
        console.error(`${tag} tool call failed → ${e.toolUse.name}`, e.error);
      } else {
        console.log(`${tag} tool call done → ${e.toolUse.name}`, e.result);
      }
    }),
    agent.addHook(MessageAddedEvent, (e) => {
      console.log(`${tag} message added → role=${e.message.role}`, e.message.content);
    }),
    agent.addHook(InterruptEvent, (e) => {
      console.log(`${tag} interrupt raised → ${e.interrupt.name}`, e.interrupt.reason);
    }),
    agent.addHook(AgentResultEvent, (e) => {
      console.log(`${tag} turn finished → stopReason=${e.result.stopReason}`);
    }),
  ];

  return () => cleanups.forEach((cleanup) => cleanup());
}
