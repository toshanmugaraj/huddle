// translateMessages itself needs a real Agent/model — not exercised here
// (see GemmaEdgeModel.test.ts for that style of test against the model
// layer). This covers parseTranslations, the one pure, easily-testable
// piece: turning the "[N] text..." format the translation prompt asks for
// back into an ordered string array, tolerant of a model that drops
// entries or writes multi-line translations. Exported specifically so it
// can be tested directly — that parsing logic, not the Agent plumbing
// around it, is the real risk surface (a real model's raw text output).
import { describe, expect, it } from 'vitest';
import { parseTranslations } from './translate';

describe('parseTranslations', () => {
  it('parses one translation per message in order', () => {
    const text = '[1] hola\n[2] mundo\n[3] adios';

    expect(parseTranslations(text, 3)).toEqual(['hola', 'mundo', 'adios']);
  });

  it('keeps multi-line translations together, up to the next marker', () => {
    const text = '[1] line one\nline two\n[2] second message';

    expect(parseTranslations(text, 2)).toEqual(['line one\nline two', 'second message']);
  });

  it('fills in an empty string for any index the model dropped, without throwing', () => {
    const text = '[1] first\n[3] third';

    expect(parseTranslations(text, 3)).toEqual(['first', '', 'third']);
  });

  it('returns all-empty when the model produced no recognizable markers at all', () => {
    expect(parseTranslations('sorry, I cannot help with that', 2)).toEqual(['', '']);
  });
});
