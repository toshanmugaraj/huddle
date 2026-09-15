import { describe, expect, it } from 'vitest';
import { buildTranscript, buildTruncatedTranscript } from './summarize';
import type { RoomMessage } from '../matrix/messages';

function message(sender: string, body: string): RoomMessage {
  return { eventId: '$ignored', sender, body, originServerTs: 0 };
}

describe('buildTranscript', () => {
  it('prefixes each line with its 1-based original array index', () => {
    const messages = [message('alice', 'first'), message('bob', 'second'), message('alice', 'third')];

    expect(buildTranscript(messages)).toBe('[1] alice: first\n[2] bob: second\n[3] alice: third');
  });
});

describe('buildTruncatedTranscript', () => {
  it('keeps each kept message\'s index equal to its ORIGINAL position, not its position among the kept lines', () => {
    // Long enough bodies (~8000 chars each) to force truncation against the
    // real budget ((DEFAULT_MAX_TOKENS - RESERVED_TOKENS) * 4 chars) without
    // hardcoding those constants here — 5 messages this size only leave room
    // for the last 3, so the kept lines must still read "[3]"/"[4]"/"[5]",
    // not "[1]"/"[2]"/"[3]", since parseSummaryTopics.ts maps a citation
    // index straight back to messages[i - 1] regardless of what got
    // truncated.
    const messages = Array.from({ length: 5 }, (_, i) => message('alice', `${i + 1}${'x'.repeat(8000)}`));

    const transcript = buildTruncatedTranscript(messages);
    const lines = transcript.split('\n');

    expect(lines[0]).toMatch(/^\[2 earlier message\(s\) omitted/);
    expect(lines[1]).toMatch(/^\[3\] alice: 3x/);
    expect(lines[2]).toMatch(/^\[4\] alice: 4x/);
    expect(lines[3]).toMatch(/^\[5\] alice: 5x/);
  });

  it('returns every message, still 1-based-indexed, when nothing needs truncating', () => {
    const messages = [message('alice', 'short'), message('bob', 'also short')];

    expect(buildTruncatedTranscript(messages)).toBe('[1] alice: short\n[2] bob: also short');
  });
});
