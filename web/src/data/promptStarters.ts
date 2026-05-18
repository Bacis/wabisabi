// Curated starter prompts the user can pick from on the Start page and
// inside the AgentChatPane. Same data was previously inlined in
// Suggestions.tsx — extracted here so both surfaces (homepage composer +
// in-conversation starter picker) consume one canonical list.
//
// Each entry's `prompt` is the full creative-director paragraph that
// becomes the user's first chat message. `title` + `description` are the
// compact preview used in card UIs. `icon` maps to the existing Icon
// component glyph set in AgentChatPane.

export type PromptStarterIcon = 'sparkle' | 'layers' | 'audio' | 'wave';

export type PromptStarter = {
  id: string;
  title: string;
  description: string;
  icon: PromptStarterIcon;
  prompt: string;
};

export const PROMPT_STARTERS: PromptStarter[] = [
  {
    id: 'short-film',
    title: 'Direct the whole clip like a short film',
    description: 'bottom-up letters · shockwave · shimmer · ripple',
    icon: 'sparkle',
    prompt:
      "Treat this clip like a short film. Read the transcript, break it into scenes — opening hook, the setup and backstory, any stats or punch-lines, a payoff line, and a clean outro — and stage each one differently. Open hard: bottom-up letter staircase reveal on the first beat with a slam impact and an explosive shockwave on the opening keywords; captions huge and filling the frame. Through the backstory shift to a calm per-word crossfade so the words land like a keynote, and let the emphasis words ripple gently with a soft resonance wobble under a low drone. When a stat or pull-quote lands, pause the room — center it, lift the size, sparkle it with a crystal shimmer, and add a rising sound. On the call-to-action line pull the keywords forward with a magnetic snap. End with a gentle sigh. Captions stay huge and dominant throughout — never small or whispered. White text with a yellow/red emphasis pair, kept consistent across the whole reel.",
  },
  {
    id: 'hormozi',
    title: 'Hormozi-style with audio impact',
    description: 'spring-scale pop · shockwave slams · samba letters',
    icon: 'layers',
    prompt:
      "Give me the Hormozi look — big yellow keyword cascade, bold black sans, every emphasis word painted in a warm yellow-red glow. Make the captions huge and fill the frame, no tiny lower lines. Use a snappy spring-scale-in entry so each word pops in with that iOS-icon overshoot feel. Hit the main emphasis tier with shockwave slams (intensity ~0.7) on the loudest words and add a samba letter-sway on the longer keywords so individual letters wiggle and feel alive (subtle, ~0.4 intensity). Soft yellow halo behind the emphasis words. Then layer real sound: a thud on every section open, a hard slam the moment any stat lands, a sharp snap on the call to action, and a whisper on the closing line. Throw in occasional italic accents for a magazine-editorial flourish on the longer keywords.",
  },
  {
    id: 'netflix-doc',
    title: 'Netflix-doc cut, soft and editorial',
    description: 'soft-blur-in · breathe pulse · lens flare on quotes',
    icon: 'audio',
    prompt:
      "Frame this clip like a Netflix mini-doc episode. Quiet, editorial, confident. Warm soft serif (Instrument Serif), off-white text with an ember accent on emphasis words — never the loud TikTok yellow. Keep captions large enough to read from across the room. Use a soft-blur-in entry across the whole piece so each line resolves out of a gentle Apple-style blur — characters fade up with a 12px blur over ~900ms. Direct the scenes: whisper the opening line low in the frame and let those words breathe with a gentle pulse (the breathe effect at low intensity ~0.3), then hum a low drone under the backstory so the room feels lived-in. Layer typewriter audio ticks under any list or sequence. When a pull-quote lands, lift it into a centered serif italic and let a soft lens flare catch the line as it appears — like sunlight glinting through a window. End on a gentle sigh. Subtle, but every choice deliberate.",
  },
  {
    id: 'imax',
    title: 'Editorial cocktail · serif italic meets bold sans',
    description: 'instrument serif italic · warm yellow accent · onest bold drop',
    icon: 'wave',
    prompt:
      "Treat the captions like our homepage hero — three voices taking turns inside the frame. Most lines in Instrument Serif italic, off-white, big and breathing. On the standout word of each beat, switch to the warm yellow gradient — the same sun-amber wash we use on the word 'cinematic' on the homepage. Then at the punchlines and the closer, hard-pivot into Onest bold sans, upright, white — short, declarative, IMAX-loud. Stage it as a back-and-forth: open quietly in the serif italic voice, drop one yellow word for the gut moment, then slam the bold-sans hit and let it sit. Position middle of the frame, captions large enough to dominate. Layer a shimmer-sweep across the serif titles for a premium-opener feel, a focus-blur snap-into-crisp entry on the bold-sans hits, and a single slam-impact on the closing word.",
  },
];
