// Client-side slash-command expansion. Each command rewrites the user's
// raw input into a natural-language prompt for Claude. Keeping this on the
// client means the server prompt stays small + stable (better caching) and
// new commands ship without server deploys.

export type SlashCommand = {
  cmd: string;
  arg: string;
  desc: string;
  ic:
    | 'spark'
    | 'layers'
    | 'image'
    | 'clock'
    | 'wave'
    | 'audio'
    | 'undo';
  kbd: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/emphasize', arg: '<word>', desc: 'Pump a single word — scale, color, fx', ic: 'spark', kbd: '1' },
  { cmd: '/variant', arg: '<name>', desc: 'Generate a new caption variant', ic: 'layers', kbd: '2' },
  { cmd: '/match', arg: '<reference>', desc: 'Mimic the style of a reference', ic: 'image', kbd: '3' },
  { cmd: '/at', arg: '<time>', desc: 'Edit the word at a timestamp', ic: 'clock', kbd: '4' },
  { cmd: '/quiet', arg: '', desc: 'Calm the entire scene by one notch', ic: 'wave', kbd: '5' },
  { cmd: '/audio', arg: '<sfx>', desc: 'Add or replace the sound on a variant', ic: 'audio', kbd: '6' },
  { cmd: '/revert', arg: '', desc: 'Roll back to an earlier state (client-side)', ic: 'undo', kbd: '7' },
];

// Returns the expanded prompt and a flag indicating whether the expansion
// is something the server can act on. /revert is purely client-side; the
// caller handles it without making a network round-trip.
export type SlashExpansion =
  | { kind: 'send'; text: string; original: string }
  | { kind: 'revert'; original: string }
  | { kind: 'passthrough'; text: string };

export function expandSlash(raw: string): SlashExpansion {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) {
    return { kind: 'passthrough', text: trimmed };
  }
  // Split into "/cmd rest" — preserve the rest verbatim.
  const spaceIdx = trimmed.indexOf(' ');
  const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case '/emphasize':
      return {
        kind: 'send',
        original: trimmed,
        text: rest
          ? `Emphasize the word '${rest}' — make it visually pop on top of the current style.`
          : 'Emphasize the most impactful word in the current caption line.',
      };
    case '/variant':
      return {
        kind: 'send',
        original: trimmed,
        text: rest
          ? `Restyle the captions toward a new variant called '${rest}'. Pick fonts, colors, and motion that suit that name.`
          : 'Restyle the captions toward a fresh variant — surprise me.',
      };
    case '/match':
      return {
        kind: 'send',
        original: trimmed,
        text: rest
          ? `Match the style of: ${rest}.`
          : 'Match a cinematic style reference — pick a fitting palette and motion.',
      };
    case '/at':
      return {
        kind: 'send',
        original: trimmed,
        text: rest
          ? `Edit the caption at ${rest}.`
          : 'Edit the caption at the current playhead time.',
      };
    case '/quiet':
      return {
        kind: 'send',
        original: trimmed,
        text: 'Calm the entire scene by one notch — softer animation, lower emphasis scale, longer durations.',
      };
    case '/audio':
      return {
        kind: 'send',
        original: trimmed,
        text: rest
          ? `Add a '${rest}' sound effect. (No audio engine wired yet — acknowledge if you can't.)`
          : 'Add a tasteful sound effect to the punchline words.',
      };
    case '/revert':
      return { kind: 'revert', original: trimmed };
    default:
      // Unknown command — send the raw text through as a passthrough.
      return { kind: 'passthrough', text: trimmed };
  }
}
