import { useState } from 'react';
import { useAuth } from '../lib/auth';

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
    <div className="min-h-screen flex items-center justify-center bg-ink-900 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-ink-800 border border-ink-700 rounded-lg p-7 shadow-xl"
        noValidate
      >
        <h1 className="text-base font-semibold text-ink-100 mb-1">Caption Studio</h1>
        <p className="text-xs text-ink-400 mb-6">Sign in to continue.</p>

        <label className="block text-[11px] font-medium text-ink-300 mb-1.5" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="w-full text-sm bg-ink-700 border border-ink-600 rounded px-3 py-2 mb-4 text-ink-100 focus:outline-none focus:border-amber-400/60 disabled:opacity-50"
        />

        <label className="block text-[11px] font-medium text-ink-300 mb-1.5" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="w-full text-sm bg-ink-700 border border-ink-600 rounded px-3 py-2 mb-5 text-ink-100 focus:outline-none focus:border-amber-400/60 disabled:opacity-50"
        />

        {error && (
          <p className="text-xs text-rose-300 mb-4 break-words" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full text-sm font-medium px-3 py-2 rounded bg-amber-400 text-ink-900 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-[11px] text-ink-500 mt-5 text-center">
          Need access? Contact the admin.
        </p>
      </form>
    </div>
  );
}
