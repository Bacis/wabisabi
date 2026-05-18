// MCP Resource: a prompting playbook for the upstream AI agent.
//
// Important framing: this is NOT an API reference. The only MCP tool the
// caller has is `chat` (plus `get_status` for cheap polling). Every named
// vocabulary item below is just a word the caller can USE inside a
// natural-language `chat` message — Wabisabi's internal Atelier agent
// owns the full tool ladder and will pick the right primitives. Don't
// ask Wabisabi to "call apply_director_script" or "add a token rule" —
// describe the OUTCOME and let Atelier route.

export const WABISABI_DESIGN_GUIDE = `# Wabisabi — Prompting Playbook for AI Agents

You are talking to Wabisabi via a single \`chat\` tool. Your job is to describe the **creative outcome** the user wants; Wabisabi handles all the internal mechanics (style spec, layout strategy, effect tiers, render orchestration). You will get much better-looking captions by speaking like an art director than by trying to invoke primitives.

**The prompt is the API.** This document is a vocabulary you can sprinkle into your \`chat\` messages — not a list of tools you can call directly.

---

## How to write a prompt Wabisabi will absolutely nail

The pattern that works most reliably is a single sentence that combines **archetype + intent**, optionally with **role-specific emphasis** and **palette pinning**:

> "Give me a **Hormozi cascade** with **shockwave on the stat callouts** and a **soft outro**, palette \`#0e0e0e\` / \`#ff5a1f\` / \`#f4b942\`."

That's it. One sentence. Wabisabi will plan the whole reel, pick layouts per scene role, apply the effect to the right tier, and pin the palette globally.

### Combine vocabulary like this

| Element | Examples |
|---|---|
| **Archetype** (the headline look) | Hormozi cascade · Netflix-doc minimal · IMAX maximal · MrBeast pop · TikTok-style · editorial magazine · designer poster · cinematic reel · brutalist manifesto · concert poster · vintage VHS |
| **Role emphasis** (target specific moments) | "shockwave on the stat callouts" · "shimmer-sweep on the intro hook" · "spring-scale-in on the CTA" · "blur-resolve the hero title" · "soft outro" |
| **Palette pinning** (brand match) | \`palette #0e0e0e / #ff5a1f / #f4b942\` · "deep navy + electric lime" · "monochrome white-on-black" |
| **Casing & rhythm** | "all-caps hero, sentence-case backstory" · "word-by-word pop" · "per-character rise" · "calm keynote rhythm" |

---

## The six scene roles you can target by name

Wabisabi internally segments any reel into named scene roles. Mention them by name in your prompt and Wabisabi will scope your direction to just those moments:

- **intro-hook** — the opening line, your bait
- **hero-title-card** — the big punchy headline
- **backstory-beat** — narrative connective tissue
- **stat-callout** — numbers, percentages, "$10K"
- **pull-quote** — quotable line, slow + considered
- **enumerated-list** — list items, one per beat
- **pov-shift** — "but here's the thing" pivots
- **comparison-pair** — "X vs Y" contrasts
- **cta-overlay** — call-to-action at the end
- **outro** — the soft landing

Prompts like *"make the stat-callouts hit harder"*, *"keep the outro understated"*, or *"add a flare burst on the hero-title-card"* are all valid — Wabisabi knows what those mean and will scope changes to those specific moments only.

---

## Aesthetic moves Wabisabi can deliver

Use these as building blocks in your prompt. Mix freely:

### Motion feel
- **shockwave** — explosive radial impact on the beat
- **flare** — lens-flare burst on emphasis entry
- **shimmer-sweep** — whole-headline horizontal glide
- **breathe** — soft scale pulse, ambient
- **resonance** — wobble / ripple, percussive
- **inflation** — words breathe outward then settle
- **crystal** — iridescent shimmer across emphasis words
- **magnetic** — letters pull toward / away
- **samba** — rhythmic side-to-side sway
- **ferro** — spiky ferrofluid halo
- **slice** — glitch cut + recombine

### Layout strategy
- **cascade** (stacked words, cascading sizes — Hormozi default)
- **single-line flow** (one line, centered, calm rhythm)
- **lower-third** (banner anchored to bottom third)

### Word-reveal rhythm
- **spring-scale-in** (iOS-icon overshoot per word)
- **soft-blur-in** (Apple per-character blur fade)
- **per-character rise** (tvOS crisp letter rise)
- **per-word crossfade** (calm keynote rhythm)
- **bottom-up letters** (pronounced staircase)
- **focus-blur-resolve** (cinematic blur → focus pull)

You don't need to be precise about which category any term comes from — Wabisabi parses your intent. *"Make the hero title bloom into focus with a shimmer-sweep"* works fine even though those are technically two different categories.

---

## Recipes that absolutely land

Copy these prompt shapes verbatim or adapt them. Each is one chat turn.

**Cinematic podcast reel**
> "Plan this as a cinematic reel — strong intro-hook with shimmer-sweep, two stat-callouts with shockwave on the numbers, a quiet outro that fades."

**Hormozi-style high-energy**
> "Hormozi cascade — big yellow + red emphasis on value words, shockwave on hero-title-cards, all-caps throughout. Palette yellow #f4b942 / red #ff3b30."

**Netflix-doc minimal**
> "Netflix-doc lower-third, sentence-case, soft-blur-in entries, white-on-black, no flashy effects. Keep it considered."

**Highlight-reel only**
> "Only show the most important moments — hero-title-cards, stat-callouts, and the CTA. Hide everything else."

**Brand match**
> "Apply my brand: fill #0e0e0e, emphasis #ff5a1f, accent #f4b942. Hormozi cascade base, all-caps hero, sentence-case rest."

**Refining a specific moment**
> "The pull-quote around 0:23 — slow the entry by 200ms and switch it to focus-blur-resolve. Keep everything else as-is."

---

## What to do, and what NOT to do

### DO
- **Describe outcomes, not parameters.** "Make it hit harder" beats "letter-spacing -1.5".
- **Use role names** when scoping ("on the stat-callouts", "in the intro-hook").
- **Combine 2-3 vocabulary terms per turn** for layered direction.
- **One outcome per turn** lands more reliably than a 5-paragraph brief.
- **Pin palette in hex** (\`#rrggbb\`).
- **Trust Wabisabi to plan the whole reel** with a single high-level prompt — don't try to choreograph every line.

### DON'T
- **Don't ask Wabisabi to call specific internal tools** ("call apply_director_script", "add a token rule"). The tool surface is just \`chat\` — describe the OUTCOME and Wabisabi will pick the right internal primitive.
- **Don't assume Wabisabi lacks a capability** until you've tried to describe it in plain English. *"Shockwave on stat callouts"* works; you don't need a "token rule" API to make it happen — the planner already segments stat moments into a role you can target.
- **Don't paste raw style-spec JSON.** Always natural language.
- **Don't switch templates mid-design.** Pick the look you want up front.
- **Don't ask for non-hex colors** (no rgb(), hsl(), color names — hex only).
- **Don't expect cross-conversation memory** — each \`threadId\` is its own session.
- **Don't paraphrase what Wabisabi told you back to the user as limitations** without first trying the natural-language route. Wabisabi's internal Atelier agent is the LLM you're talking to; it can interpret far more than a strict API would suggest.

---

## End-to-end flow you orchestrate

1. **Ingest.** First \`chat\` call: pass \`clipPath\` (absolute filesystem path of the user's video file) or \`clipUrl\` (public http URL). Wabisabi handles the file from there — uploads start in the background.
2. **Describe the look** in your message text using the vocabulary above. You can do this in the same first turn as the ingest.
3. **Render.** Wabisabi will kick render off automatically when it has enough direction. The \`chat\` call long-polls up to 25s. If the render is done in that window, you get an output URL. Otherwise:
4. **Poll cheaply with \`get_status\`** — no LLM tokens spent on either side. Pass \`clipId\` to get the latest render status. Repeat every 10-20s. Reply with the URL when \`status === 'done'\`.
5. **Refine if asked.** Subsequent \`chat\` turns layer additional intent on top: *"the stat-callout at 0:14 — bump it up a tier"*. Same \`threadId\`.

## What Wabisabi handles for you (don't ask the user for these)

Wabisabi's render pipeline is full-stack — it does **everything** between "raw video" and "captioned mp4". You never need to ask the user for:

- **A transcript.** Wabisabi runs Whisper on the audio automatically. If the user offered to provide an SRT/VTT, politely decline — yours will be more accurate.
- **Caption text or markup.** No need to write or "sculpt" caption text. The pipeline generates it from the audio.
- **Emphasis tier assignments (p0/p1/etc).** The planner picks which words land in which tier from the audio + your art-direction intent. Don't ask the user to mark up emphasis words.
- **Director script** (whole-video scene plan). Just ask for the look — "Hormozi cascade with shockwave on stat-callouts" — and Wabisabi's internal Director planner will segment the reel into scene roles for you.
- **Manual word timing.** Whisper provides per-word timestamps; Wabisabi uses them directly.

If you find yourself about to tell the user "I need a transcript / captions / emphasis markup before I can render" — **stop**. That's wrong. Just call \`chat\` with the design intent + \`clipPath\` and Wabisabi takes it from there. The render produces a fully-captioned video.

## When to use which tool

| Situation | Tool |
|---|---|
| First message, ingest + design + render | \`chat\` (with \`clipPath\` or \`clipUrl\`) |
| New design intent ("more cinematic") | \`chat\` |
| User says "is it ready?" | \`get_status\` (cheap, no LLM) |
| Want to refine one specific moment | \`chat\` |
| Need to know the render URL | \`get_status\` |

Default to \`get_status\` for any "polling / status / progress" pattern. Save \`chat\` for moments where Wabisabi needs to *do* something new.
`;
