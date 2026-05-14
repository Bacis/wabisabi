import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proposeDirectorScript } from './proposeDirectorScript.js';
import { DIRECTOR_SYSTEM_PROMPT } from './agentPrompts/director.system.js';
import { GROUP_ROLES, SONIC_GESTURES } from '../shared/director/vocabularies.js';

// Day 7 — planner-node unit tests (no live LLM calls). The actual prompt
// quality gate (≥7/10 sensible scripts on real transcripts) is Day 8 work,
// driven by hand against the live Sonnet endpoint per the cost-sensitivity
// memory note.

describe('director.system.ts prompt assembly', () => {
  it('contains every GROUP_ROLES entry in the bullet list', () => {
    for (const role of GROUP_ROLES) {
      expect(DIRECTOR_SYSTEM_PROMPT).toContain(`- ${role}:`);
    }
  });

  it('contains every SONIC_GESTURES entry in the bullet list', () => {
    for (const gesture of SONIC_GESTURES) {
      expect(DIRECTOR_SYSTEM_PROMPT).toContain(`- ${gesture}:`);
    }
  });

  it('flags renderer-ready strategies vs forward-compat', () => {
    expect(DIRECTOR_SYSTEM_PROMPT).toContain('cascade-stack [READY]');
    expect(DIRECTOR_SYSTEM_PROMPT).toContain('two-column-split [forward-compat');
  });

  it('includes both worked examples', () => {
    expect(DIRECTOR_SYSTEM_PROMPT).toContain('EXAMPLE 1');
    expect(DIRECTOR_SYSTEM_PROMPT).toContain('EXAMPLE 2');
  });
});

describe('proposeDirectorScript — env guard', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = saved;
    }
  });

  it('returns an ok:false result with a clear error when the key is missing', async () => {
    const r = await proposeDirectorScript({
      transcript: [{ idx: 0, t: 0, w: 'hello' }],
      message: 'plan this',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/OPENROUTER_API_KEY/);
      expect(r.attempts).toBe(0);
    }
  });
});
