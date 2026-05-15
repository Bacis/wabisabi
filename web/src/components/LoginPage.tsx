import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { BrandMark } from '@/components/atelier';
import styles from './LoginPage.module.css';

// Caption Studio · wabisabi sign-in. Bypasses the AtelierShell entirely; the
// page owns its own minimal top bar. Two-column on desktop, single-column
// under 920px. The left column shows a kinetic phone preview that cycles
// through five caption-animation scenes (pure CSS, respects
// prefers-reduced-motion). The right column is the actual form: invite-only,
// so signup + SSO are deliberately disabled placeholders.
//
// On success: useAuth().login() flips the auth state to authenticated, which
// causes the `/login` route to <Navigate to="/" replace /> via the
// LoginRoute wrapper in App.tsx — so we don't navigate from here.

const STAR_POSITIONS = Array.from({ length: 70 }, (_, i) => {
  const x = (i * 173 + 41) % 100;
  const y = (i * 67 + 13) % 100;
  const s = 1 + ((i * 7) % 3) * 0.5;
  const o = 0.15 + ((i * 31) % 100) / 320;
  return { x, y, s, o };
});

export function LoginPage() {
  const { login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedSessionPill, setDismissedSessionPill] = useState(false);

  // The ProtectedRoute redirects with state.from = original-pathname; if the
  // user landed here because their session expired, we surface that.
  const cameFromProtected =
    typeof (location.state as { from?: string } | null)?.from === 'string';
  const sessionPillVisible = cameFromProtected && !dismissedSessionPill && !error;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // LoginRoute in App.tsx watches auth state and bounces to "/" once
      // we flip to authenticated; nothing more to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const sweepLetters = useMemo(
    () => 'wabisabi'.split('').map((ch, i) => ({ ch, i })),
    [],
  );

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
        <div className={styles.beam} />
        <div className={styles.horizon} />
        <div className={styles.grain} />
      </div>

      <header className={styles.top}>
        <a className="" href="/" style={{ display: 'inline-flex' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'var(--ag-font-mono)',
              fontSize: 11,
              letterSpacing: '0.2em',
              color: 'var(--ag-ink-3)',
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            <BrandMark />
            Caption Studio
            <span
              style={{
                width: 1,
                height: 14,
                background: 'var(--ag-line)',
              }}
            />
            <span style={{ color: 'var(--ag-ink-4)', letterSpacing: '0.18em' }}>
              wabisabi
            </span>
          </span>
        </a>
        <div className={styles.topRight}>
          <span>Invite only</span>
          <a aria-disabled="true" onClick={(e) => e.preventDefault()} href="#">
            Request access →
          </a>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.left}>
          <div className={styles.quote}>
            <h1 className={styles.leftH1}>
              Sign back in to your{' '}
              <span className={styles.accent}>cinematic</span> captions.
            </h1>
            <p className={styles.leftBody}>
              Pick up where you left off — your themes, transcripts, and chat
              history with the agent are waiting on the other side.
            </p>
          </div>

          <div className={styles.phoneStage}>
            <span className={`${styles.floatPill} ${styles.f1}`}>
              <span className={styles.d}>●</span> AGENT · <b>wabisabi</b>{' '}
              drafting
            </span>
            <div className={styles.phone}>
              <div className={styles.notch} />
              <div className={styles.cinema}>
                <div className={`${styles.atmosphere} ${styles.atmo1}`} />
                <div className={`${styles.atmosphere} ${styles.atmo2}`} />
                <div className={`${styles.atmosphere} ${styles.atmo3}`} />
                <div className={`${styles.atmosphere} ${styles.atmo4}`} />
                <div className={`${styles.atmosphere} ${styles.atmo5}`} />

                <div className={`${styles.cinScene} ${styles.scene1}`}>
                  <span
                    className={`${styles.word} ${styles.w1} ${styles.amber} ${styles.pop}`}
                  >
                    LATE
                  </span>
                  <span
                    className={`${styles.word} ${styles.w2} ${styles.fadeUp} ${styles.fadeUp1}`}
                  >
                    night pop
                  </span>
                </div>

                <div className={`${styles.cinScene} ${styles.scene2}`}>
                  <span
                    className={`${styles.word} ${styles.w1} ${styles.cyan} ${styles.blurIn}`}
                  >
                    DRIFT
                  </span>
                  <span
                    className={`${styles.word} ${styles.w2} ${styles.slideRight}`}
                  >
                    soft & cool
                  </span>
                </div>

                <div className={`${styles.cinScene} ${styles.scene3}`}>
                  <span
                    className={`${styles.word} ${styles.w1} ${styles.coral} ${styles.italicShout} ${styles.punch}`}
                  >
                    BURST!
                  </span>
                  <span
                    className={`${styles.word} ${styles.w2} ${styles.snapUp}`}
                  >
                    hashtag energy
                  </span>
                </div>

                <div className={`${styles.cinScene} ${styles.scene4}`}>
                  <span
                    className={`${styles.word} ${styles.w1} ${styles.violet} ${styles.italicShout} ${styles.italicRise}`}
                  >
                    #system
                  </span>
                  <span
                    className={`${styles.word} ${styles.w2} ${styles.slideLeft}`}
                  >
                    not luck.
                  </span>
                </div>

                <div className={`${styles.cinScene} ${styles.scene5}`}>
                  <span className={`${styles.word} ${styles.w1} ${styles.sweep}`}>
                    {sweepLetters.map(({ ch, i }) => (
                      <span key={i} style={{ ['--i' as never]: i }}>
                        {ch}
                      </span>
                    ))}
                  </span>
                  <span
                    className={`${styles.word} ${styles.w2} ${styles.fadeUp} ${styles.fadeUp5}`}
                  >
                    by design
                  </span>
                </div>
              </div>
            </div>
            <span className={`${styles.floatPill} ${styles.f2}`}>
              <span className={styles.d}>●</span> THEME ·{' '}
              <b>Late Night Pop</b> v3
            </span>
          </div>

          <div className={styles.footQuote}>
            <div className={styles.q}>
              “It feels less like editing and more like directing — I just say
              what I want and it shows up on the timeline.”
            </div>
            <div className={styles.who}>
              — Mara K. · <b>filmmaker</b>, beta cohort
            </div>
          </div>
        </section>

        <section className={styles.right}>
          <div className={styles.card}>
            {error ? (
              <div className={styles.statusPill}>
                <span className={styles.d} />
                <span className={styles.pillText}>{error}</span>
                <button
                  type="button"
                  className={styles.x}
                  aria-label="Dismiss"
                  onClick={() => setError(null)}
                >
                  <svg
                    className={styles.ico}
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    strokeWidth={1.5}
                  >
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              </div>
            ) : sessionPillVisible ? (
              <div className={styles.statusPill}>
                <span className={styles.d} />
                <span className={styles.pillText}>
                  Session expired · please sign in
                </span>
                <button
                  type="button"
                  className={styles.x}
                  aria-label="Dismiss"
                  onClick={() => setDismissedSessionPill(true)}
                >
                  <svg
                    className={styles.ico}
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    strokeWidth={1.5}
                  >
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              </div>
            ) : null}

            <div className={styles.head}>
              <span className={styles.kicker}>
                <span className={styles.kdot} /> Welcome back
              </span>
              <h2>Sign in to continue.</h2>
              <p>
                Caption Studio is currently invite-only. If you have an
                account, sign in below.
              </p>
            </div>

            <div className={styles.tabs} role="tablist">
              <button
                type="button"
                className={`${styles.tab} ${styles.active}`}
                role="tab"
                aria-selected="true"
              >
                Sign in
              </button>
              <button
                type="button"
                className={`${styles.tab} ${styles.disabled}`}
                aria-disabled="true"
                disabled
                role="tab"
              >
                Create account
              </button>
            </div>

            <div className={styles.sso}>
              <button
                type="button"
                className={`${styles.ssoBtn} ${styles.disabled}`}
                disabled
                aria-disabled="true"
              >
                <svg width="16" height="16" viewBox="0 0 18 18">
                  <path
                    d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.78 2.73v2.26h2.88c1.69-1.55 2.7-3.84 2.7-6.63z"
                    fill="#4285f4"
                  />
                  <path
                    d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.88-2.26c-.8.54-1.83.86-3.08.86-2.36 0-4.36-1.6-5.08-3.74H.96v2.34A8.997 8.997 0 0 0 9 18z"
                    fill="#34a853"
                  />
                  <path
                    d="M3.92 10.68A5.41 5.41 0 0 1 3.62 9c0-.58.1-1.15.3-1.68V4.98H.96A8.997 8.997 0 0 0 0 9c0 1.45.35 2.83.96 4.02l2.96-2.34z"
                    fill="#fbbc05"
                  />
                  <path
                    d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.42 0 9 0A8.997 8.997 0 0 0 .96 4.98l2.96 2.34C4.64 5.18 6.64 3.58 9 3.58z"
                    fill="#ea4335"
                  />
                </svg>
                Google
              </button>
              <button
                type="button"
                className={`${styles.ssoBtn} ${styles.disabled}`}
                disabled
                aria-disabled="true"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.843.067.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.505-1.217.473-1.282z" />
                </svg>
                Apple
              </button>
              <button
                type="button"
                className={`${styles.ssoBtn} ${styles.disabled}`}
                disabled
                aria-disabled="true"
              >
                <svg
                  className={styles.ico}
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <rect x="3" y="7" width="10" height="7" rx="1.5" />
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
                  <circle cx="8" cy="10.5" r="0.8" fill="currentColor" />
                </svg>
                SSO
              </button>
            </div>

            <div className={styles.divider}>
              <span className={styles.line} />
              <span className={styles.or}>or with email</span>
              <span className={styles.line} />
            </div>

            <form onSubmit={onSubmit} noValidate>
              <div className={styles.field}>
                <label htmlFor="login-email">Email</label>
                <div className={styles.inputWrap}>
                  <span className={styles.lico}>
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.4}
                    >
                      <rect x="2" y="3.5" width="12" height="9" rx="1.4" />
                      <path d="M2.5 4.5l5.5 4 5.5-4" />
                    </svg>
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    name="email"
                    placeholder="you@studio.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="login-password">
                  <span>Password</span>
                  <button
                    type="button"
                    className={styles.forgot}
                    onClick={(e) => e.preventDefault()}
                    aria-disabled="true"
                  >
                    Forgot?
                  </button>
                </label>
                <div className={styles.inputWrap}>
                  <span className={styles.lico}>
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.4}
                    >
                      <rect x="3" y="7" width="10" height="7" rx="1.4" />
                      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
                    </svg>
                  </span>
                  <input
                    id="login-password"
                    type={revealed ? 'text' : 'password'}
                    name="password"
                    placeholder="••••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className={`${styles.reveal} ${revealed ? styles.on : ''}`}
                    onClick={() => setRevealed((v) => !v)}
                    aria-label={revealed ? 'Hide password' : 'Show password'}
                    aria-pressed={revealed}
                  >
                    <svg
                      className={styles.ico}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      strokeWidth={1.4}
                    >
                      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
                      <circle cx="8" cy="8" r="2" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className={styles.checkRow}>
                <label className={styles.check}>
                  <input type="checkbox" defaultChecked />
                  <span className={styles.box}>
                    <svg
                      className={styles.ico}
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      strokeWidth={2}
                    >
                      <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                    </svg>
                  </span>
                  Keep me signed in
                </label>
              </div>

              <button
                type="submit"
                className={styles.submit}
                disabled={submitting || !email || !password}
              >
                {submitting ? 'Signing you in…' : 'Sign in to wabisabi'}
                {!submitting && (
                  <svg
                    className={styles.ico}
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    strokeWidth={1.6}
                  >
                    <path d="M3 8h10M9 4l4 4-4 4" />
                  </svg>
                )}
              </button>
            </form>

            <div className={styles.fineprint}>
              By continuing you agree to our{' '}
              <a onClick={(e) => e.preventDefault()} href="#">
                Terms
              </a>{' '}
              &amp;{' '}
              <a onClick={(e) => e.preventDefault()} href="#">
                Privacy Policy
              </a>
              .<br />
              Sessions last 30 days; we never store passwords in plaintext.
            </div>
          </div>

          <div className={styles.rightFoot}>
            <a onClick={(e) => e.preventDefault()} href="#">
              Status
            </a>{' '}
            ·{' '}
            <a onClick={(e) => e.preventDefault()} href="#">
              Docs
            </a>{' '}
            ·{' '}
            <a onClick={(e) => e.preventDefault()} href="#">
              Support
            </a>{' '}
            · <span>© 2026 wabisabi</span>
          </div>
        </section>
      </main>
    </div>
  );
}
