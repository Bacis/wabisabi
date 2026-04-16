// Smoke test for the Telegram flag parser. Run with:
//   npx tsx scripts/test-flags.ts
// Not part of any automated suite — used manually to verify parseCaption
// behavior after changes to src/telegram/flags.ts.
import { parseCaption, HELP_TEXT, VOICE_ALIASES } from '../src/telegram/flags.js';

type Case = { label: string; input: string; expect: (r: ReturnType<typeof parseCaption>) => boolean };

const cases: Case[] = [
  {
    label: 'free-form brief',
    input: 'a dog runs through the snow',
    expect: (r) =>
      r.prompt === 'a dog runs through the snow' &&
      Object.keys(r.fields).length === 0 &&
      !r.help &&
      r.errors.length === 0,
  },
  {
    label: 'voice alias + preset + length + brief',
    input: '--voice rachel --preset story-sunset --length 30 a dog runs',
    expect: (r) =>
      r.prompt === 'a dog runs' &&
      r.fields.voiceId === VOICE_ALIASES.rachel &&
      r.fields.presetId === 'story-sunset' &&
      r.fields.capSeconds === '30' &&
      r.errors.length === 0,
  },
  {
    label: 'shortcut style flags merge into styleSpec',
    input: '--position top --animation karaoke --color pink --words 3',
    expect: (r) => {
      if (r.errors.length > 0 || !r.fields.styleSpec) return false;
      const s = JSON.parse(r.fields.styleSpec);
      return (
        s.layout?.position === 'top' &&
        s.layout?.maxWordsPerLine === 3 &&
        s.animation?.preset === 'karaoke' &&
        s.color?.emphasisFill === '#ff3366'
      );
    },
  },
  {
    label: 'unknown preset produces error',
    input: '--preset nope',
    expect: (r) => r.errors.some((e) => e.includes('Unknown preset')) && !r.fields.presetId,
  },
  {
    label: 'shortcut wins over --style for same key',
    input: '--color pink --style {"color":{"fill":"#ff0000","emphasisFill":"#00ff00"}}',
    expect: (r) => {
      if (r.errors.length > 0 || !r.fields.styleSpec) return false;
      const s = JSON.parse(r.fields.styleSpec);
      return s.color?.fill === '#ff0000' && s.color?.emphasisFill === '#ff3366';
    },
  },
  {
    label: 'length out of range rejected',
    input: '--length 200',
    expect: (r) => r.errors.some((e) => e.includes('20 and 60')) && !r.fields.capSeconds,
  },
  {
    label: '--help sets help flag',
    input: '--help',
    expect: (r) => r.help && r.errors.length === 0,
  },
  {
    label: 'unknown flag surfaces as error but leaves non-flag text in prompt',
    input: '--foobar hello',
    expect: (r) => r.errors.some((e) => e.includes('Unknown flag')) && r.prompt === 'hello',
  },
  {
    label: 'raw voice ID pass-through',
    input: '--voice someRawId123',
    expect: (r) => r.fields.voiceId === 'someRawId123' && r.errors.length === 0,
  },
  {
    label: '--color with hex',
    input: '--color #123abc',
    expect: (r) => {
      if (r.errors.length > 0 || !r.fields.styleSpec) return false;
      const s = JSON.parse(r.fields.styleSpec);
      return s.color?.emphasisFill === '#123abc';
    },
  },
  {
    label: 'invalid --color rejected',
    input: '--color not-a-color',
    expect: (r) => r.errors.some((e) => e.includes('hex color')),
  },
  {
    label: 'invalid --animation rejected',
    input: '--animation bouncy',
    expect: (r) => r.errors.some((e) => e.includes('--animation')),
  },
  {
    label: '--style JSON with spaces after other flags',
    input: '--preset classic --style { "color": { "emphasisFill": "#abc" } }',
    expect: (r) => {
      if (r.errors.length > 0 || !r.fields.styleSpec) return false;
      const s = JSON.parse(r.fields.styleSpec);
      return r.fields.presetId === 'classic' && s.color?.emphasisFill === '#abc';
    },
  },
  {
    label: 'invalid --style JSON rejected',
    input: '--style {"broken',
    expect: (r) => r.errors.some((e) => e.includes('not valid JSON')),
  },
  {
    label: '--length aliases work; last wins',
    input: '--cap 50 --len 40',
    expect: (r) => r.fields.capSeconds === '40' && r.errors.length === 0,
  },
  {
    label: 'missing value for known flag errors out',
    input: '--voice',
    expect: (r) => r.errors.some((e) => e.includes('needs a value')),
  },
  {
    label: 'empty caption',
    input: '',
    expect: (r) => r.prompt === '' && Object.keys(r.fields).length === 0 && !r.help,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = parseCaption(c.input);
  const ok = c.expect(r);
  if (ok) {
    pass++;
    console.log(`\u2713 ${c.label}`);
  } else {
    fail++;
    console.log(`\u2717 ${c.label}`);
    console.log(`  input: ${JSON.stringify(c.input)}`);
    console.log(`  got:   ${JSON.stringify(r, null, 2)}`);
  }
}

const helpOk =
  HELP_TEXT.includes('story-sunset') &&
  HELP_TEXT.includes('rachel') &&
  HELP_TEXT.includes('--length');
if (helpOk) {
  console.log('\u2713 HELP_TEXT includes dynamic preset + voice aliases + flag list');
  pass++;
} else {
  console.log('\u2717 HELP_TEXT missing expected content');
  fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
