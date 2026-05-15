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
    description: 'per-scene fx · shockwave · shimmer · ripple · magnetic',
    icon: 'sparkle',
    prompt:
      "Treat this clip like a short film. Read the transcript, break it into scenes — opening hook, the setup and backstory, any stats or punch-lines, a payoff line, and a clean outro — and stage each one differently. Open hard: a slam impact on the first beat and an explosive shockwave on the opening keywords, big bold captions filling the frame. Through the backstory, let the emphasis words ripple gently with a soft resonance wobble, and hum a low drone underneath. When a stat or pull-quote lands, pause the room — center it, lift the size, sparkle it with a crystal shimmer as it appears, and add a rising sound. On the call-to-action line pull the keywords forward with a magnetic snap. On any longer breath-beat, let the keywords pulse with a soft breathing inflation. End with a gentle sigh. Captions stay huge and dominant throughout — never small or whispered. White text with a yellow/red emphasis pair, kept consistent across the whole reel.",
  },
  {
    id: 'hormozi',
    title: 'Hormozi-style with audio impact',
    description: 'molten plasma · samba letter sway · sonic hits',
    icon: 'layers',
    prompt:
      "Give me the Hormozi look — big yellow keyword cascade, bold black sans, every emphasis word painted in a warm yellow-red glow. Make the captions huge and fill the frame, no tiny lower lines. Layer a molten plasma effect on the keywords so they feel hot, and add a samba letter-sway on the longer keywords so individual letters wiggle and feel alive (subtle, ~0.4 intensity). Soft yellow halo behind the emphasis words. Then layer real sound: a thud on every section open, a hot sizzle the moment any stat lands, a sharp snap on the call to action, and a whisper on the closing line. Throw in occasional italic accents for a magazine-editorial flourish on the longer keywords.",
  },
  {
    id: 'netflix-doc',
    title: 'Netflix-doc cut, soft and editorial',
    description: 'breathe pulse · lens flare on quotes · drones',
    icon: 'audio',
    prompt:
      "Frame this clip like a Netflix mini-doc episode. Quiet, editorial, confident. Warm soft serif (Instrument Serif), off-white text with an ember accent on emphasis words — never the loud TikTok yellow. Keep captions large enough to read from across the room. Direct the scenes: whisper the opening line low in the frame and let those words breathe with a gentle pulse (the breathe effect at low intensity ~0.3), then hum a low drone under the backstory so the room feels lived-in. Switch to typewriter ticks for any list or sequence. When a pull-quote lands, lift it into a centered serif italic and let a soft lens flare catch the line as it appears — like sunlight glinting through a window. End on a gentle sigh. Subtle, but every choice deliberate.",
  },
  {
    id: 'imax',
    title: 'IMAX-grade, max maximalism',
    description: 'plasma · ferro halo · shockwave slams · glitch slice',
    icon: 'wave',
    prompt:
      "Build the most cinematic, IMAX-grade version of this clip possible. Massive captions that dominate the frame, every word feeling carved. Bold black sans, white fill with a warm vertical gradient so even filler words feel premium, thick stroke around each letter, and a sun-flare yellow halo behind the keywords. Cycle emphasis colors across yellow / red / orange / white so every chunk feels different. Stack the effects in tiers: molten plasma on the main keyword tier, a spiky ferro halo on the italic accent words, and slam-impact shockwaves on the loudest 3-4 words with a real audio hit synced to each one. Land a hard glitch slice break on the final closing word for a cinematic punctuation. Plan the whole clip as a sequence of banner moments — title cards, stat call-outs, pull-quotes with a low rumble drone — ending with a hard drop. Captions should never whisper from the bottom; they fill the screen.",
  },
];
