// Caption Studio · wabisabi — Start page (homepage). Composer + curated
// clip chip + recent themes.
//
// Submit flow (no intermediate URL): once the user types a prompt and hits
// send, the page swaps its body for an inline <AgentDesigner /> wired to
// the curated default source + `initialPrompt={text}`. AgentChatPane fires
// the first turn automatically, which:
//   1. onFirstUserTurn  → POST /designer/sessions, stashes the new id
//   2. onTurnComplete   → PATCH the row + navigate(replace) to /designer/:id
// The URL stays at "/" during this brief processing — there is no
// "/designer/new" page in between.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentDesigner } from '@/components/AgentDesigner';
import { useEditor } from '@/lib/editor/store';
import { useUnauthenticatedHandler } from '@/lib/auth';
import {
  createDesignerSession,
  fetchStockClips,
  fetchThemes,
  patchDesignerSession,
  UnauthenticatedError,
  type StockClipSummary,
  type Theme,
} from '@/lib/api';
import { DEFAULT_STARTER, type CuratedStarter } from '@/data/curatedStarters';
import { PROMPT_STARTERS } from '@/data/promptStarters';
import type { EditorSource } from '@/lib/useEditableSource';
import styles from './StartPage.module.css';

const STAR_POSITIONS = Array.from({ length: 60 }, (_, i) => {
  const x = (i * 173 + 41) % 100;
  const y = (i * 67 + 13) % 100;
  const s = 1 + ((i * 7) % 3) * 0.5;
  const o = 0.15 + ((i * 31) % 100) / 320;
  return { x, y, s, o };
});

function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0.00s';
  return `${sec.toFixed(2)}s`;
}

// Convert a server-side stock clip into the CuratedStarter shape the composer
// expects. Used as the auto-fallback when curatedStarters.ts is empty so the
// homepage is functional out of the box for any authed user.
function stockClipAsStarter(c: StockClipSummary): CuratedStarter {
  const aspect: CuratedStarter['aspect'] =
    c.width >= c.height * 1.4
      ? '16:9'
      : c.height >= c.width * 1.4
        ? '9:16'
        : '1:1';
  return {
    id: c.id,
    sourceKind: 'stock',
    filename: `${c.id}.mp4`,
    durationSec: c.durationSec,
    aspect,
  };
}

type ComposerTab = 'caption' | 'starter';

export function StartPage() {
  const navigate = useNavigate();
  const onAuthError = useUnauthenticatedHandler();
  const [prompt, setPrompt] = useState('');
  const [activeTab, setActiveTab] = useState<ComposerTab>('caption');
  // Falls back to a real stock clip when no curated starter is configured.
  // `null` until we've finished discovering a starter; `undefined` for the
  // "tried but nothing available" terminal state (only happens if the stock
  // pool is empty AND the curated list is empty).
  const [starter, setStarter] = useState<CuratedStarter | null | undefined>(
    DEFAULT_STARTER,
  );
  const [submitted, setSubmitted] = useState<{
    text: string;
    starter: CuratedStarter;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themes, setThemes] = useState<Theme[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchThemes()
      .then((rows) => {
        if (!cancelled) setThemes(rows);
      })
      .catch((err) => {
        // Themes are decorative on the homepage; failing silently keeps the
        // page usable without a "couldn't load themes" alert in the user's
        // face every load. If we got a 401, route the user back to /login.
        onAuthError(err);
        if (!cancelled) setThemes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // If the curated starter list is empty, fall back to the longest available
  // stock clip so authed users can submit immediately on first visit. The
  // user can override later by adding entries to curatedStarters.ts.
  useEffect(() => {
    if (DEFAULT_STARTER) return;
    let cancelled = false;
    fetchStockClips()
      .then((clips) => {
        if (cancelled) return;
        if (clips.length === 0) {
          setStarter(undefined);
          return;
        }
        const longest = clips.reduce((a, b) =>
          a.durationSec >= b.durationSec ? a : b,
        );
        setStarter(stockClipAsStarter(longest));
      })
      .catch((err) => {
        onAuthError(err);
        if (!cancelled) setStarter(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSend = !!prompt.trim() && !!starter && !submitted;

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || !starter) return;
    setError(null);
    setSubmitted({ text, starter });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  }

  if (submitted) {
    return (
      <SubmittingHandoff
        text={submitted.text}
        starter={submitted.starter}
        onError={(err) => {
          // A 401 here means the session expired between page load and
          // submit — flip the auth state so ProtectedRoute redirects to
          // /login. Other errors stay inline so the user can retry.
          if (err instanceof UnauthenticatedError) {
            onAuthError(err);
            return;
          }
          setError(err instanceof Error ? err.message : 'Could not start session.');
          setSubmitted(null);
        }}
        navigate={navigate}
      />
    );
  }

  return (
    <div className={styles.scene}>
      <div className={styles.bg}>
        <div className={styles.stars}>
          {STAR_POSITIONS.map((p, i) => (
            <span
              key={i}
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.s}px`,
                height: `${p.s}px`,
                opacity: p.o,
              }}
            />
          ))}
        </div>
        <div className={styles.horizon} />
        <div className={styles.grain} />
      </div>

      <main className={styles.main}>
        <div className={styles.stage}>
          <section className={styles.hero}>
            <span className={styles.agentMark}>
              <span className={styles.ico}>w</span>
              <span className={styles.lbl}>
                Agent · <b>wabisabi</b> is ready
              </span>
            </span>
            <h1 className={styles.heroH1}>
              Design <span className={styles.accent}>cinematic</span>
              <br />
              captions <span className={styles.alt}>by talking.</span>
            </h1>
            <p className={styles.heroTag}>
              Drop a clip, then <em>chat</em> your way to a finished caption
              theme — point at any word to direct the agent, or tweak by hand.
              No layers panel required.
            </p>
          </section>

          <div className={styles.settingsStrip}>
            <div className={styles.ssGroup}>
              <button type="button" className={styles.ssItem}>
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <rect x="5" y="2" width="6" height="12" rx="1" />
                    <circle cx="8" cy="12" r="0.5" fill="currentColor" />
                  </svg>
                </span>
                <b>Vertical</b> <span className={styles.sub}>9 : 16</span>
                <svg
                  className={`${styles.ico} ${styles.chev}`}
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  strokeWidth={1.6}
                >
                  <path d="M3 5l3 3 3-3" />
                </svg>
              </button>
              <button type="button" className={styles.ssItem}>
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <circle cx="8" cy="9" r="5.2" />
                    <path d="M8 6.5V9l2 1.2M8 2v1.4M6.5 2h3" />
                  </svg>
                </span>
                <b>Auto</b> <span className={styles.sub}>max 60s</span>
                <svg
                  className={`${styles.ico} ${styles.chev}`}
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  strokeWidth={1.6}
                >
                  <path d="M3 5l3 3 3-3" />
                </svg>
              </button>
              <button type="button" className={styles.ssItem}>
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <circle cx="8" cy="8" r="6" />
                    <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
                  </svg>
                </span>
                <b>English</b>
                <svg
                  className={`${styles.ico} ${styles.chev}`}
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  strokeWidth={1.6}
                >
                  <path d="M3 5l3 3 3-3" />
                </svg>
              </button>
            </div>
            <div className={styles.ssGroup}>
              <button type="button" className={`${styles.ssItem} ${styles.amber}`}>
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <circle cx="11" cy="5" r="1.4" />
                    <circle cx="13" cy="9" r="1.4" />
                    <circle cx="5" cy="12.5" r="1.4" />
                    <circle cx="3.5" cy="7" r="1.4" />
                    <path d="M8 1.5C4.4 1.5 1.5 4.4 1.5 8s2.9 6.5 6.5 6.5c1 0 1.5-.8 1.2-1.7-.4-1.2.5-2.3 1.7-2.3H13c1 0 1.5-.8 1.5-1.5C14.5 4.4 11.6 1.5 8 1.5z" />
                  </svg>
                </span>
                <b>wabisabi Originals</b>
                <svg
                  className={`${styles.ico} ${styles.chev}`}
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  strokeWidth={1.6}
                >
                  <path d="M3 5l3 3 3-3" />
                </svg>
              </button>
              <button type="button" className={`${styles.ssItem} ${styles.cyan}`}>
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <path d="M2 8l4-4 8 8M2 8v4a2 2 0 002 2h8a2 2 0 002-2V8M9 12l2-2 3 3" />
                  </svg>
                </span>
                <b>From clip palette</b>
              </button>
            </div>
          </div>

          <form className={styles.composer} onSubmit={onSubmit}>
            <div className={styles.composerTabs}>
              <button
                type="button"
                className={`${styles.ctab} ${activeTab === 'caption' ? styles.active : ''}`}
                onClick={() => setActiveTab('caption')}
              >
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <rect x="2" y="3" width="12" height="10" rx="1.2" />
                    <path d="M5 7h6M5 10h4M5.5 1.2v2M10.5 1.2v2" />
                  </svg>
                </span>
                Caption a clip
              </button>
              <button type="button" className={styles.ctab} disabled>
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <rect x="2" y="3" width="12" height="10" rx="1.2" />
                    <path d="M3 11l3-3 3 3M9 9l1.5-1.5L13 10" />
                    <circle cx="11" cy="6" r="1" />
                  </svg>
                </span>
                From transcript
              </button>
              <button type="button" className={styles.ctab} disabled>
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <path d="M4 4l4 4-4 4M9 12h4" />
                  </svg>
                </span>
                Remix a theme
              </button>
              <button
                type="button"
                className={`${styles.ctab} ${activeTab === 'starter' ? styles.active : ''}`}
                onClick={() => setActiveTab('starter')}
              >
                <span className={styles.iconWrap}>
                  <svg
                    className={styles.ico}
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    strokeWidth={1.4}
                  >
                    <path d="M8 1l1.8 4.4L14.5 6l-3.5 3 1 4.8L8 11.5 4 13.8l1-4.8L1.5 6l4.7-.6L8 1z" />
                  </svg>
                </span>
                Pick a starter <span className={styles.badge}>new</span>
              </button>
            </div>

            {activeTab === 'caption' ? (
            <div className={styles.composerBody}>
              <div className={styles.sugRibbon}>
                <button
                  type="button"
                  className={styles.sugChip}
                  onClick={() => setPrompt('punch on key beats')}
                >
                  <span className={styles.aid}>/</span> punch on key beats
                </button>
                <button
                  type="button"
                  className={styles.sugChip}
                  onClick={() => setPrompt('kinetic italic style')}
                >
                  <span className={styles.aid}>/</span> kinetic italic style
                </button>
                <button
                  type="button"
                  className={styles.sugChip}
                  onClick={() => setPrompt('match the clip palette')}
                >
                  <span className={styles.aid}>/</span> match the clip palette
                </button>
                <button
                  type="button"
                  className={`${styles.sugChip} ${styles.amber}`}
                  onClick={() => setPrompt('add hashtag pop')}
                >
                  <span className={styles.aid}>+</span> add hashtag pop
                </button>
              </div>

              {starter ? (
                <span className={styles.clipChip}>
                  <span className={styles.thumb} />
                  <span className={styles.name}>{starter.filename}</span>
                  <span className={styles.meta}>
                    · {fmtDuration(starter.durationSec)} · {starter.aspect}
                  </span>
                </span>
              ) : starter === null ? (
                <span className={styles.clipChip} style={{ opacity: 0.6 }}>
                  <span className={styles.thumb} />
                  <span className={styles.name}>Finding a starter clip…</span>
                </span>
              ) : (
                <span className={styles.noStarter}>
                  <span className={styles.d} />
                  No stock clips available — seed remotion/public/stock or
                  add to curatedStarters.ts
                </span>
              )}

              <textarea
                className={styles.composerInput}
                rows={2}
                placeholder={
                  starter
                    ? 'Tell wabisabi the vibe — e.g. “Late-night pop, italic accents, kinetic on every shout…”'
                    : starter === null
                      ? 'Loading a starter clip…'
                      : 'No stock clips available — composer disabled.'
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={!starter}
                autoFocus
              />

              {error && <div className={styles.submitError}>{error}</div>}

              <div className={styles.composerFoot}>
                <div className={styles.cfLeft}>
                  <button
                    type="button"
                    className={styles.cfBtn}
                    title="Attach clip"
                  >
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.5}
                    >
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={styles.cfBtn}
                    title="Upload transcript"
                  >
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.4}
                    >
                      <path d="M4 2h5l3 3v9H4z" />
                      <path d="M9 2v3h3" />
                      <path d="M6 8h4M6 10.5h4M6 6h2" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={styles.cfBtn}
                    title="Slash commands"
                  >
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.5}
                    >
                      <path d="M9.5 3l-3 10" />
                    </svg>
                  </button>
                  <span className={styles.cfDivider} />
                  <span className={styles.cfCounter}>⌘ K</span>
                </div>
                <div className={styles.cfRight}>
                  <span className={styles.whisper}>
                    wabisabi <b>online</b>
                  </span>
                  <button
                    type="button"
                    className={styles.cfBtn}
                    title="Voice prompt"
                  >
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.4}
                    >
                      <rect x="6" y="2" width="4" height="8" rx="2" />
                      <path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14M5.5 14h5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={styles.cfBtn}
                    title="Magic style"
                  >
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.4}
                    >
                      <path d="M3 12l8-8M9 4l2 2M2 14l2-2" />
                      <path d="M13 9l.4 1.1L14.5 10.5l-1.1.4L13 12l-.4-1.1L11.5 10.5l1.1-.4z" />
                    </svg>
                  </button>
                  <button
                    type="submit"
                    className={styles.sendBtn}
                    disabled={!canSend}
                    title="Send (↵)"
                    aria-label="Send"
                  >
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.6}
                    >
                      <path d="M8 13V3M4 7l4-4 4 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            ) : (
              <div className={styles.composerBody}>
                {starter && (
                  <span className={styles.clipChip}>
                    <span className={styles.thumb} />
                    <span className={styles.name}>{starter.filename}</span>
                    <span className={styles.meta}>
                      · {fmtDuration(starter.durationSec)} · {starter.aspect}
                    </span>
                  </span>
                )}
                <div className={styles.starterGrid}>
                  {PROMPT_STARTERS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={styles.starterCard}
                      disabled={!starter}
                      onClick={() => {
                        if (!starter) return;
                        setError(null);
                        setSubmitted({ text: s.prompt, starter });
                      }}
                    >
                      <span className={styles.starterTitle}>{s.title}</span>
                      <span className={styles.starterDesc}>{s.description}</span>
                      <span className={styles.starterArrow}>
                        <svg
                          className={styles.ico}
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          strokeWidth={1.6}
                        >
                          <path d="M3 8h10M9 4l4 4-4 4" />
                        </svg>
                      </span>
                    </button>
                  ))}
                </div>
                <span className={styles.starterFoot}>
                  Tap a starter to submit it as the agent&rsquo;s first
                  direction — you can edit anything mid-conversation.
                </span>
              </div>
            )}
          </form>

          <div className={styles.templates}>
            <button type="button" className={styles.tmpl}>
              <span className={styles.iconWrap}>
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <rect x="2" y="3" width="12" height="10" rx="1" />
                  <path d="M2 11l4-3 3 2 3-3 2 1.5" />
                  <circle cx="6" cy="6" r="1" />
                </svg>
              </span>
              Reels / Shorts
            </button>
            <button type="button" className={styles.tmpl}>
              <span className={styles.iconWrap}>
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <path d="M3 4h10M4 4v9h8V4M6 7h4M6 9h4M6 11h2" />
                </svg>
              </span>
              Podcast clips
            </button>
            <button type="button" className={styles.tmpl}>
              <span className={styles.iconWrap}>
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <rect x="2.5" y="3" width="11" height="7" rx="1" />
                  <path d="M2.5 6h11M6 13h4M8 10v3" />
                </svg>
              </span>
              Tutorial captions
            </button>
            <button type="button" className={styles.tmpl}>
              <span className={styles.iconWrap}>
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <path d="M2 8a6 6 0 1112 0M2 8c0 1.5 1 2.5 2 2.5s2-1 2-2.5M6 8c0 1.5 1 2.5 2 2.5s2-1 2-2.5M10 8c0 1.5 1 2.5 2 2.5s2-1 2-2.5" />
                </svg>
              </span>
              Voiceover narration
            </button>
            <button type="button" className={styles.tmpl}>
              <span className={styles.iconWrap}>
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M5 8h6M8 5l3 3-3 3" />
                </svg>
              </span>
              Ads &amp; promos
            </button>
          </div>

          {themes && themes.length > 0 && (
            <section className={styles.recent}>
              <header className={styles.recentHead}>
                <span className={styles.ttl}>
                  <span className={styles.d} /> Recent themes
                </span>
                <a className={styles.viewAll} href="/themes">
                  View all →
                </a>
              </header>
              <div className={styles.themeGrid}>
                {themes.slice(0, 3).map((t) => (
                  <a
                    key={t.id}
                    className={styles.themeCard}
                    href={`/themes`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate('/themes');
                    }}
                  >
                    <div className={styles.canvas}>
                      <div className={styles.line}>
                        <span className={styles.a}>
                          {(t.name ?? 'THEME').toUpperCase().slice(0, 8)}
                        </span>
                        <span className={styles.b}>by you</span>
                      </div>
                    </div>
                    <div className={styles.meta}>
                      <div>
                        <div className={styles.name}>{t.name ?? 'Untitled'}</div>
                        <div className={styles.when}>
                          {t.publishedAt
                            ? new Date(t.publishedAt).toLocaleDateString(
                                undefined,
                                { month: 'short', day: 'numeric' },
                              )
                            : 'Draft'}
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

// Once the user submits, we render the AgentDesigner inline so the URL
// stays at "/" while the agent picks up the prompt. AgentDesigner's
// chatOpts mint the session on the first turn and navigate(replace) to
// /designer/:id once the first reply lands.
function SubmittingHandoff({
  text,
  starter,
  navigate,
  onError,
}: {
  text: string;
  starter: CuratedStarter;
  navigate: ReturnType<typeof useNavigate>;
  onError: (err: unknown) => void;
}) {
  const pendingSessionIdRef = useRef<string | null>(null);
  const navigatedRef = useRef<boolean>(false);

  const editorSource: EditorSource = useMemo(
    () => ({ kind: 'stock', clipId: starter.id }),
    [starter.id],
  );

  return (
    <AgentDesigner
      source={editorSource}
      initialPrompt={text}
      chatOpts={{
        onFirstUserTurn: async ({ firstMessage }) => {
          try {
            const styleSpec = useEditor.getState().styleSpec;
            const session = await createDesignerSession({
              templateId: 'reel-clone',
              sourceKind: 'stock',
              sourceId: starter.id,
              styleSpec: styleSpec as Record<string, unknown>,
              firstMessage,
              messages: [],
            });
            pendingSessionIdRef.current = session.id;
          } catch (err) {
            onError(err);
            throw err;
          }
        },
        onTurnComplete: ({ messages, styleSpec, directorScript }) => {
          const id = pendingSessionIdRef.current;
          if (!id || navigatedRef.current) return;
          navigatedRef.current = true;
          patchDesignerSession(id, { messages, styleSpec, directorScript })
            .catch((err) => console.warn('designer session patch failed', err))
            .finally(() => {
              navigate(`/designer/${id}`, { replace: true });
            });
        },
      }}
    />
  );
}
