import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';

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
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <CardTitle>Caption Studio</CardTitle>
            <CardDescription>Sign in to continue.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="text-xs font-medium text-muted-foreground"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-xs font-medium text-muted-foreground"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            {error && (
              <p
                className="break-words text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full gap-2"
              disabled={submitting || !email || !password}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Need access? Contact the admin.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
