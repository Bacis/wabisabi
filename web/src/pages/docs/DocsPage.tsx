import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  MonoLabel,
  PageHeader,
  Pill,
  SerifDisplay,
  atelierStyles as a,
} from '@/components/atelier';
import styles from './DocsPage.module.css';

type Section = { id: string; label: string };

const SECTIONS: Section[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'talking', label: 'Talking to Wabisabi' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'mcp', label: 'Connect your editor' },
  { id: 'reference', label: 'Reference' },
];

export function DocsPage() {
  const [active, setActive] = useState<string>('overview');
  const sectionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sectionsRef.current) return;
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top of the viewport that's visible.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`${a.page} ${a.wide}`}>
      <PageHeader
        eyebrow={
          <MonoLabel tone="dim" dot>
            Help · Guides
          </MonoLabel>
        }
        title={<SerifDisplay size="xl">Documentation.</SerifDisplay>}
        description="How to get the most out of Wabisabi — the agent that designs your captions. Strategies, recipes, and a glimpse at where this is headed."
        rightSlot={
          <Button as="a" href="/" variant="cyan">
            Open chat
          </Button>
        }
      />

      <div className={styles.layout}>
        <div className={styles.content} ref={sectionsRef}>
          <Overview />
          <Workspace />
          <Talking />
          <Recipes />
          <Mcp />
          <Reference />
        </div>

        <nav className={styles.toc} aria-label="On this page">
          <span className={styles.tocLabel}>On this page</span>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`${styles.tocLink} ${active === s.id ? styles.active : ''}`}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function SectionHead({ id, title }: { id: string; title: string }) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={id}>{title}</h2>
      <span className={styles.rule} aria-hidden="true" />
    </div>
  );
}

function Overview() {
  return (
    <section className={styles.section}>
      <SectionHead id="overview" title="Overview" />
      <p className={styles.lede}>
        You upload a vertical clip, you chat with <strong>Wabisabi</strong> — a
        Claude-Haiku design agent — and it composes a{' '}
        <em>director script</em> plus a style spec that the renderer turns into
        cinematic captions. Wabisabi is opinionated: it speaks in{' '}
        <strong>scene roles</strong>, <strong>emphasis tiers</strong>, and{' '}
        <strong>layout strategies</strong>, not raw font sizes. The faster you
        adopt its vocabulary, the better your results.
      </p>
      <p className={styles.lede}>
        These docs are for people who've already shipped one render. If you
        haven't, the homepage upload is the only stop you need — Wabisabi handles
        the rest.
      </p>
    </section>
  );
}

function Workspace() {
  return (
    <section className={styles.section}>
      <SectionHead id="workspace" title="Workspace tour" />
      <p className={styles.lede}>
        A designer session has three surfaces, side by side. You'll spend most
        of your time in the chat.
      </p>

      <div className={styles.workspace} aria-hidden="true">
        <div className={styles.wsCell}>
          <span className={styles.wsTitle}>Preview</span>
          <span className={styles.wsBody}>
            9:16 phone frame. Plays the current draft with the latest patch
            applied.
          </span>
          <span className={styles.wsHint}>PreviewBar · clip metadata</span>
        </div>
        <div className={styles.wsCell}>
          <span className={styles.wsTitle}>Timeline</span>
          <span className={styles.wsBody}>
            1-second ruler, director groups as pills, waveform, playhead. Click
            a pill to scrub.
          </span>
          <span className={styles.wsHint}>CinematicTimeline</span>
        </div>
        <div className={styles.wsCell}>
          <span className={styles.wsTitle}>Chat</span>
          <span className={styles.wsBody}>
            Wabisabi listens here. <code>/</code> opens the slash menu:{' '}
            <code>/revert</code> rolls back the last patch,{' '}
            <code>/checkpoint</code> saves a named state.
          </span>
          <span className={styles.wsHint}>AgentChatPane</span>
        </div>
      </div>
    </section>
  );
}

function Talking() {
  return (
    <section className={styles.section}>
      <SectionHead id="talking" title="Talking to Wabisabi" />
      <p className={styles.lede}>
        Wabisabi has a closed tool ladder. Phrasing nudges which tool fires; the
        wider the blast radius, the bigger your change. Six techniques get you
        most of the way.
      </p>

      <div className={styles.strategies}>
        <Strategy
          n={1}
          title="Describe outcomes, not parameters."
          body='"Make it cinematic, hero hits hard" beats "letter-spacing -1.5, font-weight 800". Wabisabi picks the highest-impact tool that fits the intent.'
        />
        <Strategy
          n={2}
          title="Match the tool to your blast radius."
          body="The ladder runs whole-video → preset pack → effect tier → layout → style patch → field → chunk override. Phrasing decides where you land."
          examples={[
            { phrase: '"for the whole reel" / "plan the scenes"', tool: 'apply_director_script' },
            { phrase: '"Hormozi feel" / "classic look"', tool: 'apply_preset_pack' },
            { phrase: '"make the highlights pop"', tool: 'set_effect' },
            { phrase: '"this line at 0:14, make it red"', tool: 'add_chunk_override' },
          ]}
        />
        <Strategy
          n={3}
          title="Plan once, refine many."
          body='For a fresh clip, ask for a director plan early ("plan this as a cinematic reel"). Subsequent tweaks layer on as group overrides. Re-planning resets context — use sparingly.'
        />
        <Strategy
          n={4}
          title="Speak in scene roles."
          body='Wabisabi knows ten roles (see Reference). "The hero title needs more punch" lands on hero-title-card. "The title" is ambiguous — use the role.'
        />
        <Strategy
          n={5}
          title="Use selective visibility for highlight reels."
          body='"Only show stat callouts and pull quotes" hides every other caption via set_caption_visibility(selective). Combine with a director plan for clean highlight cuts.'
        />
        <Strategy
          n={6}
          title="Slash commands for state."
          body={(
            <>
              <code>/revert</code> rolls back the last patch.{' '}
              <code>/checkpoint name</code> saves a state you can return to
              later. No undo stack — just the chain of patches.
            </>
          )}
        />
      </div>

      <p className={styles.subhead}>Anti-patterns</p>
      <Card padding="none" className={styles.antiCard}>
        <ul className={styles.antiList}>
          <li>Don't micro-direct every word — Wabisabi loses the global shape.</li>
          <li>
            Don't ask for colour modes other than hex; the schema only accepts{' '}
            <code>#rgb</code>, <code>#rrggbb</code>, <code>#rrggbbaa</code>.
          </li>
          <li>
            Don't try to switch templates mid-design; the agent forces{' '}
            <code>reel-clone</code> in the designer workspace.
          </li>
          <li>
            Don't paste a five-paragraph brief. One outcome per turn lands more
            reliably than a wall of intent.
          </li>
          <li>
            Don't expect cross-clip memory — sessions are per-render. Save a
            checkpoint or re-render if you want to fork a look.
          </li>
        </ul>
      </Card>
    </section>
  );
}

type StrategyProps = {
  n: number;
  title: string;
  body: React.ReactNode;
  examples?: { phrase: string; tool: string }[];
};

function Strategy({ n, title, body, examples }: StrategyProps) {
  return (
    <Card padding="none" className={styles.strategyCard}>
      <div className={styles.strategyHead}>
        <span className={styles.strategyNum}>{String(n).padStart(2, '0')}</span>
        <h3 className={styles.strategyTitle}>{title}</h3>
      </div>
      <p className={styles.strategyBody}>{body}</p>
      {examples && (
        <ul className={styles.strategyExamples}>
          {examples.map((ex) => (
            <li key={ex.tool}>
              <span>{ex.phrase}</span>
              <code>{ex.tool}</code>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Recipes() {
  const recipes: { goal: string; prompt: string; fires: string }[] = [
    {
      goal: 'Cinematic reel from a podcast clip',
      prompt:
        'Plan this as a cinematic reel — strong hook, two stat callouts, soft outro.',
      fires: 'apply_director_script',
    },
    {
      goal: 'Hormozi cascade',
      prompt:
        'Give me a Hormozi cascade — big yellow emphasis on the value words.',
      fires: 'apply_preset_pack',
    },
    {
      goal: 'Highlight-only edit',
      prompt:
        'Only show the most important moments — hero title, stats, and the CTA.',
      fires: 'set_caption_visibility',
    },
    {
      goal: 'Brand match',
      prompt:
        'Use my palette: fill #0e0e0e, emphasis #ff5a1f, accent #f4b942.',
      fires: 'tune_field × 3',
    },
    {
      goal: 'One stubborn line',
      prompt:
        'The line at 0:14 — keep it red and slow the entry by 200ms.',
      fires: 'add_chunk_override',
    },
  ];

  return (
    <section className={styles.section}>
      <SectionHead id="recipes" title="Recipes" />
      <p className={styles.lede}>
        Five prompt shapes that land cleanly. Copy, paste, adapt.
      </p>

      <div className={styles.recipes}>
        {recipes.map((r) => (
          <Card key={r.goal} padding="none" className={styles.recipeCard}>
            <div className={styles.recipeBody}>
              <p className={styles.recipeGoal}>{r.goal}</p>
              <p className={styles.recipePrompt}>"{r.prompt}"</p>
            </div>
            <div className={styles.recipeFires}>
              Fires <code>{r.fires}</code>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Mcp() {
  const mcpTools: { tool: string; wraps: string }[] = [
    { tool: 'plan_director_script(transcript)', wraps: 'proposeDirectorScript' },
    { tool: 'apply_preset(slot, presetId)', wraps: 'apply_preset_pack validator' },
    { tool: 'set_effect(tier, effect, params)', wraps: 'set_effect validator' },
    { tool: 'tune(path, value)', wraps: 'tune_field validator' },
    { tool: 'set_visibility(mode, roles)', wraps: 'set_caption_visibility' },
    { tool: 'chat(threadId, message, currentSpec)', wraps: 'POST /agent/chat' },
    { tool: 'render(video, styleSpec, templateId)', wraps: 'POST /jobs → poll GET /jobs/:id/output' },
  ];

  return (
    <section className={styles.section}>
      <SectionHead id="mcp" title="Connect your editor" />
      <div className={styles.mcpHead}>
        <Pill tone="amber" dot>
          Planned · not yet available
        </Pill>
        <span className={styles.refNote}>Concept · feedback welcome</span>
      </div>

      <p className={styles.lede}>
        Keep your editor — Premiere, DaVinci, Final Cut, or an LLM workspace
        like Claude Desktop or Cursor — as home base. Reach into Wabisabi when
        you need cinematic captions, without leaving the room. Wabisabi's tool
        surface becomes a callable extension of your editor's AI via{' '}
        <strong>Model Context Protocol</strong>.
      </p>

      <p className={styles.subhead}>Proposed shape</p>

      <div className={styles.mcpDiagram} aria-hidden="true">
        <div className={styles.mcpNode}>
          Your editor
          <span className={styles.mcpNodeSub}>
            Claude Desktop, Cursor, Premiere plugin, …
          </span>
        </div>
        <div className={styles.mcpArrow}>→</div>
        <div className={`${styles.mcpNode} ${styles.center}`}>
          Wabisabi MCP
          <span className={styles.mcpNodeSub}>
            Tool surface · auth · job orchestration
          </span>
        </div>
        <div className={styles.mcpArrow}>→</div>
        <div className={styles.mcpNode}>
          Wabisabi API
          <span className={styles.mcpNodeSub}>
            /agent/chat · /jobs · Remotion render
          </span>
        </div>
      </div>

      <p className={styles.subhead}>Tools we'd expose</p>
      <table className={styles.mcpTable}>
        <thead>
          <tr>
            <th>MCP tool</th>
            <th>Wraps</th>
          </tr>
        </thead>
        <tbody>
          {mcpTools.map((t) => (
            <tr key={t.tool}>
              <td>{t.tool}</td>
              <td>{t.wraps}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className={styles.subhead}>What this needs first</p>
      <ul className={styles.mcpCaveats}>
        <li>
          <span>
            <strong>API-key auth.</strong> Today the API runs on session
            cookies; MCP clients can't carry those. We'd add a per-user
            bearer-token table and inherit the existing ownership scoping.
          </span>
        </li>
        <li>
          <span>
            <strong>Per-user conversation history.</strong> The agent's
            checkpointer is module-level — fine for one browser tab, not for
            many MCP clients. Moving it to a SQLite-backed store keyed by
            user + threadId is a prerequisite.
          </span>
        </li>
        <li>
          <span>
            <strong>Transcript bundling.</strong> Director planning needs the
            full timed transcript in the request payload. The MCP tool would
            either accept a transcript directly or fetch one from a prior job.
          </span>
        </li>
        <li>
          <span>
            <strong>Async render.</strong> Renders take 10–90 seconds. The MCP
            tool either blocks on poll (slow but ergonomic) or returns a job
            ID (fast but pushes polling to the client). Probably both.
          </span>
        </li>
      </ul>

      <div className={styles.mcpFooter}>
        <strong>Would you use this?</strong> If yes, ping the team — the
        early-access list is open. Your use-case shapes which surface lands
        first.
      </div>
    </section>
  );
}

function Reference() {
  return (
    <section className={styles.section}>
      <SectionHead id="reference" title="Reference" />
      <p className={styles.lede}>
        The closed vocabularies Wabisabi speaks. Names matter — using them
        verbatim is the fastest way to land a precise change.
      </p>

      <div className={styles.refStack}>
        <div className={styles.refBlock}>
          <p className={styles.refNote}>Scene roles · 10</p>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th>Role</th>
                <th>Default layout · motion · casing</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map(([role, dflt]) => (
                <tr key={role}>
                  <td>{role}</td>
                  <td>{dflt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.refBlock}>
          <p className={styles.refNote}>Effects · 11</p>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th>Effect</th>
                <th>Feel</th>
              </tr>
            </thead>
            <tbody>
              {EFFECTS.map(([effect, feel]) => (
                <tr key={effect}>
                  <td>{effect}</td>
                  <td>{feel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.refBlock}>
          <p className={styles.refNote}>Layout strategies · 8 · 3 renderer-ready</p>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {LAYOUTS.map(([id, status, ready]) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td className={ready ? '' : styles.dimmed}>{status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.refBlock}>
          <p className={styles.refNote}>Motion presets · 7</p>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th>Preset</th>
                <th>Feel</th>
              </tr>
            </thead>
            <tbody>
              {MOTION.map(([id, feel]) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>{feel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.refBlock}>
          <p className={styles.refNote}>Preset packs · 2</p>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th>Preset</th>
                <th>Template · description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>classic</td>
                <td>
                  <code>pop-words</code> · Bold white, yellow emphasis, 4
                  words/line. Balanced TikTok default.
                </td>
              </tr>
              <tr>
                <td>reel-clone-default</td>
                <td>
                  <code>reel-clone</code> · Inter Black, yellow + red inline
                  emphasis, cascading sizes, progressive reveal, left-aligned.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Static reference data — mirrors src/shared/director/{vocabularies,
   roleDefaults}.ts and the set_effect enum in src/stages/agentChat.ts.
   Update here when those evolve. */

const ROLES: ReadonlyArray<[string, string]> = [
  ['intro-hook', 'single-line-flow · shimmer-sweep · sentence-case · 1.0×'],
  ['hero-title-card', 'cascade-stack · focus-blur-resolve · uppercase · 1.2×'],
  ['backstory-beat', 'single-line-flow · per-word-crossfade · sentence-case · 0.9×'],
  ['enumerated-list', 'lower-third · per-character-rise · sentence-case · 1.0×'],
  ['stat-callout', 'cascade-stack · spring-scale-in · uppercase · 1.3×'],
  ['pull-quote', 'cascade-stack · soft-blur-in · sentence-case · 1.0×'],
  ['pov-shift', 'single-line-flow · per-word-crossfade · sentence-case · 0.95×'],
  ['comparison-pair', 'cascade-stack · bottom-up-letters · uppercase · 1.0×'],
  ['cta-overlay', 'lower-third · spring-scale-in · uppercase · 1.1×'],
  ['outro', 'single-line-flow · soft-blur-in · sentence-case · 1.0×'],
];

const EFFECTS: ReadonlyArray<[string, string]> = [
  ['none', 'No motion FX. Plain caption.'],
  ['samba', 'Letters sway side-to-side, rhythmic.'],
  ['crystal', 'Iridescent shimmer across emphasis words.'],
  ['magnetic', 'Letters pull toward / away from each other.'],
  ['breathe', 'Soft scale pulse — slow, ambient.'],
  ['flare', 'Lens-flare burst on emphasis entry.'],
  ['resonance', 'Wobble / ripple — physical, percussive.'],
  ['inflation', 'Words breathe outward, then settle.'],
  ['ferro', 'Spiky ferrofluid halo around the word.'],
  ['shockwave', 'Explosive radial impact on the beat.'],
  ['slice', 'Glitch-slice — quick horizontal cut + recombine.'],
];

const LAYOUTS: ReadonlyArray<[string, string, boolean]> = [
  ['cascade-stack', 'Renderer-ready', true],
  ['single-line-flow', 'Renderer-ready', true],
  ['lower-third', 'Renderer-ready', true],
  ['karaoke-row', 'Forward-compat', false],
  ['centered-pop', 'Forward-compat', false],
  ['top-banner', 'Forward-compat', false],
  ['two-column-split', 'Forward-compat', false],
  ['free-positioned', 'Forward-compat', false],
];

const MOTION: ReadonlyArray<[string, string]> = [
  ['spring-scale-in', 'iOS-icon overshoot, per-word.'],
  ['soft-blur-in', 'Apple per-character blur fade.'],
  ['per-character-rise', 'tvOS crisp letter rise.'],
  ['per-word-crossfade', 'Calm keynote rhythm, per-word. Default.'],
  ['shimmer-sweep', 'Whole-headline horizontal glide.'],
  ['bottom-up-letters', 'Pronounced per-letter staircase.'],
  ['focus-blur-resolve', 'Cinematic blur → crisp focus pull.'],
];
