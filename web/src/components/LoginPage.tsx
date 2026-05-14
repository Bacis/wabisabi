import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  Wordmark,
  SerifDisplay,
  MonoLabel,
  TextField,
  Button,
  StarField,
  Halo,
} from '@/components/atelier';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.scene}>
      <StarField count={96} opacity={0.5} />
      <Halo />
      <div className={styles.frame}>
        <header className={styles.head}>
          <Wordmark to="/login" tagline="GATE · INVITE ONLY" />
        </header>

        <div className={styles.crown}>
          <MonoLabel tone="cyan" dot>
            Authenticate
          </MonoLabel>
          <SerifDisplay size="lg" as="h1">
            Welcome back.
          </SerifDisplay>
          <p className={styles.lede}>
            Pick up where you left off. Sessions stay live for 30 days; we
            never store your password in plaintext.
          </p>
        </div>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            placeholder="you@studio.io"
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            placeholder="••••••••"
          />

          {error && (
            <div className={styles.error} role="alert">
              <MonoLabel tone="danger" dot>Error</MonoLabel>
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            variant="cyan"
            size="lg"
            fullWidth
            disabled={submitting || !email || !password}
            leadingIcon={
              submitting ? <Loader2 size={14} className={styles.spin} /> : null
            }
            kbd="⌘↩"
          >
            {submitting ? 'Entering…' : 'Enter Atelier'}
          </Button>

          <p className={styles.footnote}>
            Need access? Ping the workspace admin for an invite.
          </p>
        </form>
      </div>
    </div>
  );
}
