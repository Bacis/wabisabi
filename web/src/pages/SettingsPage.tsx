import { LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

export function SettingsPage() {
  const { state, logout } = useAuth();
  if (state.status !== 'authenticated') return null;
  const { email, role } = state.user;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account info and session controls.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Read-only — managed by the workspace admin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Email" value={email} />
          <Row
            label="Role"
            value={
              <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
                {role === 'admin' ? 'Admin' : 'Member'}
              </Badge>
            }
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Sign out</CardTitle>
          <CardDescription>
            End your current session on this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => {
              void logout();
            }}
            className="gap-2"
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
