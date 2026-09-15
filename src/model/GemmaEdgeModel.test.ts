// Exercises the toolChoice-forcing directive added to stream() — see that
// method's own comment for why it exists (Strands' structured-output
// forcing loop sends an otherwise byte-for-byte identical request on its
// "forced" retry pass, which this class has to make genuinely different
// itself since the runtime has no native per-tool forcing).
//
// Uses @litert-lm/core's own EngineFake/ConversationFake (dist/testing) —
// built by that package specifically for this — rather than hand-rolling
// mocks: EngineFake.createConversation() returns one persistent
// ConversationFake per Engine instance, and ConversationFake.history
// records exactly what was sent via sendMessageStreaming, which is the one
// thing these tests need to assert on.
import { describe, expect, it, vi } from 'vitest';
import { EngineFake } from '@litert-lm/core/testing';
import { Message, TextBlock } from '@strands-agents/sdk';
import { GemmaEdgeModel } from './GemmaEdgeModel';

// vi.mock calls are hoisted above every import in this file (including the
// GemmaEdgeModel one above), so it already sees the mocked module.
vi.mock('@litert-lm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@litert-lm/core')>();
  const { EngineFake } = await import('@litert-lm/core/testing');
  return { ...actual, Engine: EngineFake };
});

// getStoredModelFile touches OPFS/IndexedDB, unavailable in this test's
// (default, non-jsdom) environment — not what these tests are about, so
// just make it resolve to "nothing uploaded" and let GemmaEdgeModel fall
// through to its bundled-path default (irrelevant either way, since
// Engine.create is itself mocked above and never actually loads a file).
vi.mock('./modelStorage', () => ({
  getStoredModelFile: vi.fn().mockResolvedValue(undefined),
}));

function oneUserMessage(text: string): Message[] {
  return [new Message({ role: 'user', content: [new TextBlock(text)] })];
}

/** Drives model.stream()'s async generator to completion — nothing happens until it's iterated. */
async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of iterable) {
    // no-op
  }
}

describe('GemmaEdgeModel.stream() — toolChoice forcing directive', () => {
  it('appends an explicit directive naming the forced tool as a second message', async () => {
    const createSpy = vi.spyOn(EngineFake, 'create');
    const model = new GemmaEdgeModel();

    await drain(
      model.stream(oneUserMessage('summarize this'), {
        toolChoice: { tool: { name: 'strands_structured_output' } },
      }),
    );

    const engine = (await createSpy.mock.results[0].value) as unknown as EngineFake;
    const { history } = engine.cachedConversation;

    // history ends with the fake's own auto-response — everything before
    // it is exactly what stream() sent this call.
    const sent = history.slice(0, -1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ role: 'user', content: 'summarize this' });
    expect(sent[1].role).toBe('user');
    expect(String(sent[1].content)).toContain('strands_structured_output');
    expect(String(sent[1].content).toLowerCase()).toContain('must now call');
  });

  it('leaves the message unchanged (no directive) when toolChoice is absent', async () => {
    const createSpy = vi.spyOn(EngineFake, 'create');
    const model = new GemmaEdgeModel();

    await drain(model.stream(oneUserMessage('summarize this')));

    const engine = (await createSpy.mock.results[0].value) as unknown as EngineFake;
    const { history } = engine.cachedConversation;

    const sent = history.slice(0, -1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ role: 'user', content: 'summarize this' });
  });

  it('leaves the message unchanged when toolChoice is "auto" rather than a specific forced tool', async () => {
    const createSpy = vi.spyOn(EngineFake, 'create');
    const model = new GemmaEdgeModel();

    await drain(model.stream(oneUserMessage('summarize this'), { toolChoice: { auto: {} } }));

    const engine = (await createSpy.mock.results[0].value) as unknown as EngineFake;
    const { history } = engine.cachedConversation;

    const sent = history.slice(0, -1);
    expect(sent).toHaveLength(1);
  });
});

describe('GemmaEdgeModel.stream() — enableConstrainedDecoding on the forced pass', () => {
  it('passes enableConstrainedDecoding: true to createConversation when toolChoice forces a tool', async () => {
    const conversationSpy = vi.spyOn(EngineFake.prototype, 'createConversation');
    const model = new GemmaEdgeModel();

    await drain(
      model.stream(oneUserMessage('summarize this'), {
        toolChoice: { tool: { name: 'strands_structured_output' } },
      }),
    );

    expect(conversationSpy).toHaveBeenCalledTimes(1);
    expect(conversationSpy.mock.calls[0][0]).toMatchObject({ enableConstrainedDecoding: true });
  });

  it('does not pass enableConstrainedDecoding when toolChoice is absent', async () => {
    const conversationSpy = vi.spyOn(EngineFake.prototype, 'createConversation');
    const model = new GemmaEdgeModel();

    await drain(model.stream(oneUserMessage('summarize this')));

    expect(conversationSpy).toHaveBeenCalledTimes(1);
    expect(conversationSpy.mock.calls[0][0]?.enableConstrainedDecoding).toBeUndefined();
  });
});
