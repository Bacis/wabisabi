# Wabisabi Frontend Vision

## 1. Vision

**"AI proposes, you compose."**

Wabisabi is an agentic video editing tool that makes AI-driven video production feel like a craft, not a black box. Where Opus Clips hides its decisions behind a "magic" button and Descript anchors everything to a text transcript, Wabisabi opens the machine up. Every AI decision -- from transcription word boundaries to which clip the orchestrator chose for beat 3 -- is a visible, draggable, overridable object on a canvas.

The user collaborates with the AI the way a director collaborates with an editor: giving notes, accepting or rejecting cuts, tuning the feel.

The tool should feel spatial and visual, in the lineage of Figma, Blender's node editor, and Ableton Live -- not like a web form that calls an API.

---

## 2. Competitive Positioning

| Tool | Approach | Strength | Gap Wabisabi Fills |
|------|----------|----------|--------------------|
| **Opus Clips** | Auto-clip + virality score | One-click repurposing | No post-generation editing, no transparency into AI decisions, caption accuracy issues |
| **Descript** | Transcript-as-editor | Edit text, video follows | Anchored to text -- not visual-first, no agentic pipeline |
| **CapCut** | Mobile-first template editor | Speed, accessibility | No AI orchestration, manual-heavy |
| **Runway** | Generative AI (text-to-video) | Creative generation | Different problem -- generation vs editing |

**Wabisabi's edge**: The only tool where the AI pipeline is a first-class visual object. Users see the machine, not just the output.

---

## 3. Key Innovations

### 3.1 The Pipeline Graph ("Machine Room")

No video tool today exposes its internal pipeline as an interactive visual graph. Wabisabi does.

The backend already stores per-stage artifacts (`transcript`, `faces`, `captionPlan`, `productionPlan`, `timeline`) as discrete database columns. The frontend renders each stage as a node in a directed graph:

```
[Extract Audio] --> [Transcribe] -----> [Enrich Captions] --> [Render]
                    [Detect Faces] --/
```

Nodes glow while running, show green checkmarks when done, red on failure. Users can:

- **Re-run a single node** (e.g., re-enrich the transcript without re-transcribing)
- **Fork a node** (try two different style generations side-by-side, pick the winner)
- **Inject manual data** (paste their own transcript, override face-detection)
- **Read AI reasoning** (the `notes` field from `produceTimeline`, `generateStyle`)

This makes AI agency legible. The backend already supports it -- every stage writes independently and the pipeline is sequential with well-defined intermediate artifacts.

### 3.2 Canvas-Native Caption Editor

Instead of form fields for font size, color, and position, a PixiJS canvas renders captions directly on the video frame. The user:

- **Drags** caption blocks to reposition them
- **Grabs handles** to resize text
- **Clicks a word** to toggle emphasis
- **Drags word boundaries** on a waveform to re-time a word
- **Sees live updates** via the existing `POST /jobs/:id/preview` endpoint (~1-2s response, debounced)

This replaces the current collapsible form with a WYSIWYG spatial experience.

### 3.3 AI Chat Sidebar (Natural Language as First-Class Control)

The backend's `POST /style/generate` already accepts natural language and returns a StyleSpec. The frontend wraps this in a persistent chat sidebar:

- Type "make it more neon" or "switch to kinetic burst with pink emphasis"
- See the result on the canvas instantly
- Chat preserves history: "undo that" or "go back to what you had before but keep the font"
- Each AI response shows a diff indicator of which StyleSpec fields changed
- Apply/Revert buttons per message

### 3.4 Timeline Storyboard (Multi-Clip Productions)

For the producer pipeline, timeline entries render as draggable cards on a horizontal storyboard. Each card shows a thumbnail, role badge (speaker/broll/image), duration, and narration beat text. Users can:

- **Reorder cards** by dragging
- **Trim in/out points** by dragging edges
- **Replace a clip** by dropping a new asset from the library
- **Edit narration text** inline (triggers TTS re-synthesis)
- **Add/remove beats** to reshape the story

This is what Opus Clips completely lacks: meaningful post-generation editing.

### 3.5 Style Playground with Preset Morphing

The 13 built-in presets + custom presets render as visual cards with live preview thumbnails. Users can:

- **Morph between two presets** by dragging a slider (interpolates numeric StyleSpec values, cross-fades colors)
- **Describe a style in natural language** ("cyberpunk with glitch text") to generate a new preset
- **Save custom presets** for reuse

Pure frontend interpolation -- no backend changes needed.

---

## 4. Information Architecture

### 4.1 Routes

```
/                       Dashboard (recent jobs + productions, upload)
/job/:id                Single-video editor (pipeline graph + canvas + transcript)
/production/:id         Multi-clip editor (pipeline graph + storyboard + canvas)
/presets                Style playground (grid of presets, morph tool, creator)
```

### 4.2 Universal Layout (Editor Screens)

Every editor screen uses the same 3-zone layout:

```
+---------------------------------------------------------------+
|  Top Bar  [ breadcrumb ]  [ job status pill ]  [ Export ]      |
+------------+-------------------------------+-------------------+
|            |                               |                   |
|   Left     |       Center                  |    Right          |
|   Panel    |       (PixiJS Canvas)         |    Panel          |
|            |                               |                   |
| - Pipeline |  - Video preview frame        | - AI Chat         |
|   graph    |  - Caption overlays           | - Style           |
| - Asset    |  - Drag handles               |   Inspector       |
|   library  |  - Face box visualization     | - Properties      |
| - Transcript  - Safe margin guides         |                   |
|   chunks   |                               |                   |
|            |                               |                   |
+------------+-------------------------------+-------------------+
|  Bottom Bar  [ Timeline / Storyboard / Waveform ]              |
+---------------------------------------------------------------+
```

- **Left panel**: Context-dependent. Single-video: transcript chunks + pipeline nodes. Production: asset library + pipeline nodes.
- **Center**: PixiJS canvas. The primary interaction surface. Shows current frame with caption overlays, face boxes (toggleable), and safe-margin guides.
- **Right panel**: AI chat sidebar (top) + property inspector (bottom).
- **Bottom bar**: Horizontal timeline. Single-video: waveform + word markers + chunk boundaries. Production: storyboard cards + narration beat track.

---

## 5. Screen-by-Screen Design

### 5.1 Dashboard (`/`)

The entry point. Clean, minimal, focused on action.

**Components:**

- **Upload zone**: Large drag-and-drop area in the center. Accepts single video (creates job via `POST /jobs`) or multiple files (creates production via `POST /productions`). Auto-detects pipeline based on file count.
- **Recent work grid**: Cards for jobs and productions from `GET /jobs` and `GET /productions`. Each card: thumbnail, status pill (queued/running/done/failed), template name, creation time. Click navigates to editor.
- **Quick-start presets**: Horizontal scrollable row of preset cards with preview thumbnails. Selecting one pre-fills the upload.

**Visual style**: Dark background (#0a0a0f), accent color (#ff3366), generous whitespace. The upload zone should feel inviting -- a large dashed border that glows on hover.

### 5.2 Single-Video Editor (`/job/:id`)

Data source: `GET /jobs/:id` (returns `transcript`, `captionPlan`, `faces`, `styleSpec`, `progress`, `status`, `stage`).

#### Left Panel: Pipeline & Transcript

**Pipeline graph** (vertical, top of panel):

```
 [1] Extract Audio        [checkmark] 
      |
 [2] Transcribe           [checkmark]  "342 words, en"
      |
 [2b] Detect Faces        [checkmark]  "24 samples"
      |
 [3] Enrich Captions      [spinner]    "AI chunking..."
      |
 [4] Render                [pending]
```

Each node shows: stage name, status icon, summary stat. Click expands to show the full artifact (transcript JSON, face sample visualization). "Re-run" button on each completed node.

**Transcript chunk list** (below pipeline, scrollable):

Each chunk is a card:
```
 [0:02.4 - 0:03.1]
 "this is the **moment** where"
```
- Time range from `chunk.words[0].start` to `chunk.words[last].end`
- Words with emphasis shown in bold/accent color
- Click to seek canvas to that time
- Click individual word to toggle emphasis
- Drag boundary between chunks to re-group words

#### Center: PixiJS Canvas

Renders a single frame from the video with caption overlays. **Not** a real-time video player -- shows static frames from `POST /jobs/:id/preview` (~1-2s response). The canvas adds interactive overlays:

- **Caption block**: Text matching the StyleSpec. Draggable to change position. Resize handles on corners.
- **Face boxes**: Semi-transparent rectangles from `faces.samples` at current frame time. Toggleable via toolbar.
- **Safe margin guides**: Dashed lines at the safe margin boundaries.
- **Scrub handle**: Horizontal playhead at bottom of canvas. Drag to change frame time.
- **Toolbar**: Top of canvas. Buttons for: face boxes toggle, safe margin toggle, zoom, template switcher (1-4 keys).

The video frame is a `PIXI.Sprite` textured from the preview PNG. Caption overlays are `PIXI.Text` or `PIXI.BitmapText` positioned to match the StyleSpec layout rules. This dual-layer approach means the canvas always shows an accurate preview while the overlays provide interactivity.

#### Right Panel: Chat & Properties

**AI Chat** (top half):
```
 You: "make it neon with a pink glow"
 
 AI: Applied neon style
     Changed: color.fill → #00ffff
              color.emphasisFill → #ff69b4  
              color.shadow → { ... }
     [Apply] [Revert]

 You: "keep the colors but make it bigger"
 
 AI: Increased size
     Changed: font.size → 88
     [Apply] [Revert]
```

Input field at bottom. Messages scroll up. Each AI response shows a field-level diff and action buttons.

**Property Inspector** (bottom half):

Collapsible groups matching StyleSpec structure:

- **Font**: Family dropdown, weight slider (100-900), size slider, letter-spacing, text-transform toggle
- **Color**: Fill picker, stroke picker + width slider, emphasis fill picker/palette editor, shadow controls, gradient editor
- **Layout**: Position radio buttons (top/middle/bottom with visual icons), safe margin slider, max words/line stepper, alignment toggle
- **Animation**: Preset dropdown (pop/fade/karaoke/typewriter/slide), duration slider, emphasis scale slider, spring physics (damping, stiffness, mass)

Every control change debounces a preview request (500ms).

#### Bottom Bar: Waveform Timeline

Horizontal waveform of extracted audio with overlaid markers:

```
 |▁▃▅▇▇▅▃▁▁▃▅▇▇▅▃▁▃▅▇▇▅▃▁▁▃▅▇▇▅▃▁▁▃▅▇▇▅▃▁|
 |  chunk 1  |  chunk 2  |   chunk 3   | ... |
 |----[========playhead========]--------------|
      ↑ word markers (ticks)
```

- Word boundaries as vertical ticks
- Chunk boundaries as colored regions
- Emphasis markers as accent dots above emphasized words
- Draggable playhead synced with canvas frame time

### 5.3 Multi-Clip Editor (`/production/:id`)

Data source: `GET /productions/:id` (returns `assets`, `mode`, `productionPlan`, `timeline`, `narrationScript`, `styleSpec`, `progress`).

Extends the single-video editor with production-specific panels.

#### Left Panel: Assets & Pipeline

**Asset library** (top, grid layout):

Each asset as a thumbnail card:
```
 ┌─────────────┐
 │  [thumb]    │
 │  VIDEO      │ ← kind badge
 │  speaker    │ ← role badge  
 │  12.4s      │
 │  [speech]   │ ← indicator
 └─────────────┘
```
- Tags from AI classification (`analysis.sceneTags`)
- Drag onto storyboard to swap assets
- Click to preview in canvas

**Production pipeline** (below assets, vertical):

```
 [1] Analyze Assets       [checkmark]  "5 assets analyzed"
      |
 [2] Detect Mode          [checkmark]  "speaker_montage"
      |                               "speechRatio: 0.72"
 [3] Orchestrate          [checkmark]  "8 segments"
      |                               AI notes: "Selected..."
 [4] Cut Segments         [checkmark]  "8 clips cut"
      |
 [5] Narrate              [n/a]       (speaker mode)
      |
 [6] Pick Hook            [checkmark]  "hook_03.mp4"
      |
 [7] Render               [spinner]    "frame 420/1350"
```

Click "Orchestrate" node to read the AI's reasoning about why it chose these clips and this order. "Re-run" to ask the AI to try a different arrangement.

#### Center: Canvas

Same PixiJS canvas. For productions, shows the frame corresponding to the selected storyboard entry. If split-screen is active, renders the split layout (speaker top 50%, brain-rot bottom 50%).

#### Bottom Bar: Storyboard Timeline

Two-track horizontal timeline:

**Track 1 (top): Visual clips**
```
 ┌──────────┐ ┌────────────────┐ ┌──────┐ ┌────────────────────┐
 │ clip_01  │ │   clip_02      │ │img_01│ │     clip_03        │
 │ speaker  │ │   broll        │ │image │ │     speaker        │
 │  3.2s    │ │     4.8s       │ │ 2.0s │ │       6.1s         │
 │ [thumb]  │ │   [thumb]      │ │[img] │ │     [thumb]        │
 └──────────┘ └────────────────┘ └──────┘ └────────────────────┘
   ← drag →     ←── trim ──→               ← drag →
```

- Width proportional to duration
- Color-coded by role: speaker=blue, broll=green, image=purple
- Trim handles on left/right edges
- Drag to reorder
- Right-click: split, remove, swap asset

**Track 2 (bottom): Narration beats** (narrated_story mode only)
```
 ┌──────────────┐ ┌──────────────────┐ ┌────────────────────────┐
 │ "The morning  │ │ "As the sun      │ │ "And in that moment    │
 │  light..."    │ │  rose higher..." │ │  everything changed."  │
 └──────────────┘ └──────────────────┘ └────────────────────────┘
        ↕ connection lines to paired clips
```

- Double-click to edit narration text (triggers TTS re-synthesis on confirm)
- Aligned with paired clips via `narrationIndex`

### 5.4 Style Playground (`/presets`)

Full-screen grid of preset cards:

```
 ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
 │  [live preview]  │  │  [live preview]  │  │  [live preview]  │
 │                  │  │                  │  │                  │
 │  Classic         │  │  TikTok Pop      │  │  Minimal         │
 │  "Balanced..."   │  │  "Aggressive..." │  │  "Quiet..."      │
 │  [Use] [Morph]   │  │  [Use] [Morph]   │  │  [Use] [Morph]   │
 └─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Morph tool**: Select two presets, drag a slider between them, see the interpolated result in a large preview. Save the blend as a new custom preset.

**Natural language creator**: Text input at top. "describe your style" calls `POST /style/generate`. Result renders as a new card.

---

## 6. Interaction Patterns

### 6.1 AI Proposal / User Override

Every AI-generated artifact follows the same pattern:

1. AI produces result, UI renders it with a subtle **"AI" badge**
2. User can edit any field directly (drag, click, type)
3. Edited fields get a **"user-modified" badge** (different accent color)
4. User can **"Reset to AI suggestion"** per field or per artifact
5. User can **"Re-generate"** to ask the AI to try again

This pattern applies to: `captionPlan` (emphasis, chunking), `timeline` (clip order, trim), `styleSpec` (from chat), `productionPlan` (mode, clip selection).

### 6.2 Preview Lifecycle

```
User makes change → 500ms debounce → POST /jobs/:id/preview
                                       ↓
                                   Loading overlay on canvas
                                       ↓
                                   PNG response → update canvas sprite
                                       ↓
                                   If user changed during flight → cancel, restart debounce
```

The backend `renderStill` runs in ~1-2s. The frontend maintains a working `styleSpec` in memory (Zustand) as the source of truth for all controls.

### 6.3 Pipeline Re-run

Click a pipeline node → see "inputs" panel (data from previous node) + "outputs" panel (this node's data) → "Re-run" button. Requires new backend endpoints:
- `POST /jobs/:id/rerun?stage=enrich`
- `POST /productions/:id/rerun?stage=orchestrate`

### 6.4 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/pause frame scrubbing |
| `Left/Right` | Previous/next chunk |
| `Cmd+Z` | Undo style change |
| `E` | Toggle emphasis on selected word |
| `G` | Focus chat input |
| `R` | Re-render current stage |
| `1-4` | Switch template |
| `F` | Toggle face boxes |
| `M` | Toggle safe margin guides |

---

## 7. Tech Stack

### 7.1 Core

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Framework** | React 19 + Vite | Backend already uses React (Remotion). Vite for fast HMR. |
| **Canvas** | PixiJS 8 via `@pixi/react` | Hardware-accelerated sprites, hit-testing, drag interactions. Not full video playback -- renders static preview frames as textures. |
| **State** | Zustand | Lightweight, works with React. Three stores: `useJobStore`, `useProductionStore`, `useUIStore`. |
| **Pipeline Graph** | React Flow (`@xyflow/react`) | Production-grade node graph. Custom node renderers for stage status, artifacts. Built-in zoom, pan, minimap. |
| **Timeline** | Custom (React + Canvas 2D) | Waveform via wavesurfer.js. Storyboard via dnd-kit for drag-and-drop. |
| **Data Fetching** | TanStack Query | Polling for job status, caching preview images. |
| **Routing** | TanStack Router | Type-safe routing with search params. |
| **Styling** | Tailwind CSS + CSS variables | Keep existing dark theme tokens (`--bg: #0a0a0f`, `--accent: #ff3366`). |

### 7.2 PixiJS Canvas Architecture

The canvas does NOT play video in real-time. It renders static frames from the preview endpoint as `PIXI.Sprite` textures:

```
Layer stack (bottom to top):
  1. Video frame sprite (from preview PNG)
  2. Face box overlays (semi-transparent rects)
  3. Safe margin guide lines
  4. Caption text overlays (draggable, resizable)
  5. Selection handles and hover indicators
```

For actual video playback (final output), a standard HTML `<video>` element is shown in a modal or overlay.

### 7.3 Project Structure

```
frontend/
  src/
    app/                    # Routes, layout shell
    components/
      canvas/               # PixiJS canvas, overlays, drag handlers
      pipeline/             # React Flow nodes, pipeline graph
      timeline/             # Waveform, storyboard, beat track
      chat/                 # AI chat sidebar
      properties/           # Style inspector controls
      presets/              # Preset cards, morph tool
      dashboard/            # Upload zone, job grid
      common/               # Buttons, panels, status pills, modals
    stores/                 # Zustand stores (job, production, UI)
    api/                    # TanStack Query hooks for backend endpoints
    types/                  # Re-exported from src/shared/ (StyleSpec, etc.)
    lib/                    # StyleSpec interpolation, color math, undo stack
    hooks/                  # React hooks (usePreview, useDebounce, etc.)
```

### 7.4 Shared Types

The frontend imports types directly from the existing backend shared modules:

- `src/shared/styleSpec.ts` -- `StyleSpec`, `StyleSpecSchema` (Zod)
- `src/shared/types.ts` -- `Job`, `Transcript`, `CaptionPlan`, `FaceData`
- `src/shared/productionTypes.ts` -- `Production`, `TimelineEntry`, `ProductionPlan`, `NarrationBeat`
- `src/shared/presets.ts` -- `PRESETS`, preset IDs and definitions

---

## 8. Design System

### 8.1 Color Palette

```
Background:     #0a0a0f    (near-black)
Surface:        #141420    (panels, cards)
Surface-hover:  #1e1e2e    (interactive elements)
Border:         #2a2a3a    (subtle dividers)
Text-primary:   #e8e8f0    (readable white)
Text-secondary: #8888a0    (labels, hints)
Accent:         #ff3366    (primary action, emphasis)
Accent-hover:   #ff4d7a    (hover state)
Success:        #22c55e    (completed stages)
Warning:        #f59e0b    (running stages)
Error:          #ef4444    (failed stages)
AI-badge:       #a855f7    (AI-generated indicator)
User-badge:     #3b82f6    (user-modified indicator)
```

### 8.2 Typography

```
UI:             Inter, 14px base, 600 weight for labels
Headings:       Inter, 700 weight
Monospace:      JetBrains Mono (code, timestamps)
Canvas text:    Matches StyleSpec (whatever the user chose)
```

### 8.3 Component Patterns

- **Status pills**: Small rounded badges with color + text (queued=gray, running=yellow pulse, done=green, failed=red)
- **Pipeline nodes**: Rounded rectangles with left-side status dot, right-side summary stat
- **Property controls**: Inline label + control, compact vertical stacking. Sliders show numeric value. Color pickers show swatch.
- **Cards**: Surface-colored with subtle border, hover lifts slightly
- **Panels**: Resizable via drag handle on edge. Collapsible with keyboard shortcut.

---

## 9. Backend API Additions Required

The existing API covers most needs. New endpoints for full interactivity:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/jobs/:id/rerun` | POST | Re-run a single stage. Body: `{ stage: "enrich" \| "transcribe" \| "detect_faces" }` |
| `/jobs/:id/captionPlan` | PATCH | Save edited caption plan (toggled emphasis, re-grouped chunks) |
| `/jobs/:id/styleSpec` | PATCH | Save working styleSpec without triggering re-render |
| `/productions/:id/rerun` | POST | Re-run a production stage. Body: `{ stage: "orchestrate" \| "narrate" \| "compose_render" }` |
| `/productions/:id/timeline` | PATCH | Save edited timeline (reordered, trimmed, swapped clips) |
| `/jobs/:id/waveform` | GET | Waveform peak data for the extracted audio |
| `/jobs/:id/thumbnail` | GET | Lightweight thumbnail at `?sec=N` (no caption overlay, lower res) |

All are additive -- no changes to existing endpoints.

---

## 10. Implementation Phases

### Phase 1: Foundation (Weeks 1-3)

Replace `viewer.html` with a React app at feature parity plus the canvas.

- Vite + React + Tailwind project in `frontend/`
- Routing: Dashboard, Job Editor, Production Editor
- Port existing viewer functionality (job list, detail, upload, playback, presets)
- PixiJS canvas: render preview frames, debounced preview-on-edit, frame scrubbing
- Property inspector (port editor form into React components)
- Zustand stores for job state and working styleSpec

### Phase 2: AI Chat + Pipeline Viz (Weeks 4-6)

The differentiating features.

- AI chat sidebar with `POST /style/generate` integration, message history, apply/revert, diffs
- Pipeline graph via React Flow with status indicators, click-to-inspect artifacts
- Transcript editor: chunk list, emphasis toggling, click-to-seek, chunk boundary dragging
- Undo stack for style changes

### Phase 3: Canvas Interactivity (Weeks 7-9)

Make the canvas a true spatial editing surface.

- Caption block drag-to-reposition
- Text resize handles
- Face box visualization (toggleable)
- Safe margin guide lines
- Word-level selection on canvas (highlights in transcript panel)
- Full keyboard shortcuts

### Phase 4: Production Editor (Weeks 10-13)

Full multi-clip production editing.

- Asset library panel with thumbnails, role badges, classification tags
- Production pipeline graph (extended nodes)
- Storyboard timeline: draggable clips, trim handles, narration beat track, asset swap
- Narration text editing (inline, triggers TTS re-synthesis)
- Split-screen preview on canvas
- Backend: `POST /productions/:id/rerun`, `PATCH /productions/:id/timeline`

### Phase 5: Polish & Innovation (Weeks 14-16)

Preset playground, morph tool, and UX refinements.

- Preset playground page with morph slider, natural language creator
- Waveform timeline for single-video jobs (wavesurfer.js)
- Real-time progress via WebSocket (replace polling)
- Export options panel (resolution, format, platform presets)
- Onboarding flow
- Performance optimization (preview caching, sprite recycling)

---

## 11. Design Principles

1. **Spatial over textual.** Every value that can be dragged should be draggable. Sliders over number inputs. Color pickers over hex fields. Drag-to-position over dropdown menus.

2. **AI decisions are data, not magic.** Every AI output is inspectable, editable, and re-generable. The user always knows what the AI did and why (via the `notes` fields the backend already returns).

3. **Progressive disclosure.** The dashboard is simple: upload, pick preset, go. The editor reveals complexity gradually: canvas first, then properties panel, then pipeline graph, then timeline. Power users can open everything; casual users can ship with defaults.

4. **Dark-first, high-contrast.** Video editing tools are dark by convention and for practical reasons (color accuracy against dark backgrounds). The existing `#0a0a0f` / `#ff3366` palette is the foundation.

5. **Backend is the authority.** The frontend optimistically updates the canvas from working state, but the backend is the source of truth. Every meaningful edit (captionPlan, timeline, styleSpec) is persisted via PATCH endpoints. The preview endpoint is the canonical "what will this look like" oracle.

6. **Don't hide the pipeline.** Traditional tools hide complexity to seem simpler. Wabisabi shows it to seem trustworthy. The pipeline graph is not an advanced feature -- it's the product.

---

## 12. Key Backend Files for Frontend Integration

| File | What the frontend uses from it |
|------|-------------------------------|
| `src/shared/styleSpec.ts` | `StyleSpec` Zod schema -- maps 1:1 to the property inspector |
| `src/shared/types.ts` | `Job`, `Transcript`, `CaptionPlan`, `FaceData` -- data contracts for GET endpoints |
| `src/shared/productionTypes.ts` | `Production`, `TimelineEntry`, `NarrationBeat` -- storyboard timeline data |
| `src/shared/presets.ts` | `PRESETS` map -- preset cards, morph tool source |
| `src/api/server.ts` | All API endpoints -- the full integration surface |
| `src/stages/generateStyle.ts` | Natural language to StyleSpec -- powers the AI chat sidebar |
