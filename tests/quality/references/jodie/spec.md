# Jodie — caption style reference

## Source

- Path: `tests/quality/references/jodie/source.mp4`
- Duration: 67.7s
- Resolution: 720×1280 (9:16)
- Framerate: 30
- Use: design reference only. Not redistributed. Copied locally for offline analysis.

## Style DNA

- **Typography**: heavy sans-serif (Inter Black 900 visual character), tight letter-spacing, ALL CAPS for emphasis cards. One serif/italic accent variant used sparingly.
- **Color**: yellow `#ffd100`-ish on the speaker frame; chapter cards swap to solid black background under giant yellow text.
- **Motion**: opening title card reveals **character-by-character** ("THI" → "THIS / IS / JODIE"); chapter cards snap-cut into existence; single-word callouts pop in on the spoken word.
- **Pacing**: 5 distinct caption *modes* repeat across the clip — title open, single-word callouts on b-roll, full-frame chapter callouts, mid-screen phrase stacks, end-screen poll card.

## Beat catalog (10 moves)

| # | t      | Move                                  | Frame                                | Position        | Size class | Casing    | Layout shape          | Audio   |
|---|--------|---------------------------------------|--------------------------------------|-----------------|------------|-----------|-----------------------|---------|
| 1 | 0–2s   | Title open, char-reveal "THIS/IS/JODIE" | `frames/01-title-open.png`         | middle-center   | giant      | uppercase | cascade-stack 1-per-line | typewriter / tick |
| 2 | 5s     | Single-word callout "HERE"            | `frames/02-callout-here.png`         | bottom-center   | medium     | uppercase | lower-third 1-per-line | pop |
| 3 | 15s    | Chapter card "25 / DAYS / AGO"        | `frames/03-chapter-25-days.png`      | middle-center   | giant      | uppercase | chapter-card 1-per-line | thud |
| 4 | 20s    | Single-word callout "THEN"            | `frames/04-callout-then.png`         | bottom-center   | medium     | uppercase | lower-third 1-per-line | pop |
| 5 | 26s    | Phrase stack "MONESTISING / I LOVE"   | `frames/05-stack-monestising.png`    | middle-center   | giant      | uppercase | cascade-stack mixed-font | rise |
| 6 | 32s    | Single-word "THINGS"                  | `frames/06-callout-things.png`       | bottom-center   | medium     | uppercase | lower-third 1-per-line | pop |
| 7 | 40s    | Single-word "CONTENT"                 | `frames/07-callout-content.png`      | bottom-center   | medium     | uppercase | lower-third 1-per-line | pop |
| 8 | 47s    | Single-word "POTENTIALLY"             | `frames/08-callout-potentially.png`  | bottom-center   | medium     | uppercase | lower-third 1-per-line | pop |
| 9 | 62s    | Poll card "WHAT SHOULD JODIE DO?" + 4 bullets | `frames/09-poll-card.png`     | middle-center   | medium     | uppercase | poll-card             | shimmer |
| 10| 65s    | Single-word "DAVE"                    | `frames/10-callout-dave.png`         | bottom-center   | medium     | uppercase | lower-third 1-per-line | pop |

"Giant" means ≥ 220px at 1080-wide frame (chapter cards). "Medium" means 100–180px (lower-third callouts).

## Capability ledger

| Move | Status | Notes |
|---|---|---|
| Cascade-stack 1-per-line | ✓ shipped | `maxPerLine=1` + `cascade-stack` (Director shipped Day 3–17) |
| Per-group fontSize (≥220px) | ✓ shipped | `overrides.fontSize` honored end-to-end (verified via Playwright) |
| Center+middle anchor | ✓ shipped | `placement.anchor='middle'`, `placement.alignment='center'` |
| Yellow brand emphasis | ✓ shipped | `project.emphasisFill='#ffd100'` |
| Inter Black 900 weight | ✓ shipped | font weight from preset |
| Uppercase casing | ✓ shipped | `overrides.casing='uppercase'` |
| Lower-third bottom anchor for single-word callouts | ✓ shipped | `lower-third` layout strategy |
| **Character-by-character visual reveal** | ✗ NOT shipped | `audioPattern.type='typewriter'` exists but only emits audio. Requires renderer motion preset that gates per-character opacity off the audio pattern. ~50 LOC in `remotion/src/templates/ReelClone.tsx` + a `charRevealFrame()` helper. |
| **Chapter-card solid-black backdrop** | ✗ NOT shipped | Renderer paints captions over the video. Needs a new `chapter-card` layout strategy or a `group.cover='solid-black'` field that emits an `<AbsoluteFill style={{background:'#000'}}>` for that group's time range. ~30 LOC. |
| **Mixed font-family (sans + italic serif) within one phrase** | ✗ NOT shipped | Requires per-word `font.family` overrides; today the renderer reads font from effectiveSpec only (one family per chunk). Schema would need a beat-level `overrides.font` field. |
| **Poll-card bulleted list overlay** | ✗ NOT shipped | No layout strategy exists. Needs a `poll-card` strategy that renders an inline headline + bulleted children. ~60 LOC + new schema field for bullet children. |
| Audio sample library (thud / pop / shimmer / tick) | ◐ partial | Cue plumbing ships (`CueLayer` + `expandTypewriterCues`); the 87-file mp3 library at `remotion/public/audio/<gesture>/*.mp3` is empty. Curation + licensing is a content step, not code. |

## Recreation prompt

The prompt sent to the planner when running this reference against the orhan transcript lives at `prompt.txt` next to this file. It directs explicit placements, sizes, and `maxPerLine` per beat — verifies the user's "is direction real" question.

## Mapping onto orhan

Orhan's transcript (47.4s, 171 words) maps to Jodie's beat catalog roughly as:

| Jodie beat | Orhan target |
|---|---|
| Title open (words 0-2) | "I'M SO FED" / first 3 words |
| Chapter card 1 | "RUNNING / PATTERNS" — words 5-9 region |
| Single-word callouts | emphasis words across b-roll (e.g. "wall", "messed", "Heal") |
| Phrase stack | "MONETISE / A LIFE" — semantic parallel of Jodie's MONESTISING/I LOVE |
| Brand reveal (Jodie's "QUIT/HER/JOB") | "HEAL MAN" — words 120–123 |
| Closing poll | "WHAT SHOULD ORHAN DO?" — final words 128-170 region |

The planner is expected to make these mappings from the prompt + transcript without further hinting.
