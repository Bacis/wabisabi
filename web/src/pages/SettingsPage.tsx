import { useState } from 'react';
import { LogOut, Loader2 } from 'lucide-react';
import {
  Button,
  Card,
  MonoLabel,
  PageHeader,
  Pill,
  SerifDisplay,
  atelierStyles as a,
} from '@/components/atelier';
import { useAuth } from '@/lib/auth';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const { state, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (state.status !== 'authenticated') return null;
  const { email, role } = state.user;

  return (
    <div className={`${a.page} ${a.narrow}`}>
      <PageHeader
        eyebrow={<MonoLabel tone="dim">Account · v0.1</MonoLabel>}
        title={<SerifDisplay size="xl">Who's at the desk.</SerifDisplay>}
        description="Workspace identity and session controls. Email/password reset is admin-managed — ping them in chat if you need a swap."
      />

      <div className={styles.stack}>
        <Card padding="padded" className={styles.card}>
          <MonoLabel tone="cyan">Identity</MonoLabel>
          <div className={styles.row}>
            <span className={styles.rowKey}>Email</span>
            <span className={styles.rowVal}>{email}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowKey}>Role</span>
            <span className={styles.rowVal}>
              <Pill tone={role === 'admin' ? 'amber' : 'cyan'} dot>
                {role === 'admin' ? 'Admin' : 'Member'}
              </Pill>
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowKey}>Auth</span>
            <span className={styles.rowVal}>
              <MonoLabel tone="dim">SCRYPT · 30D SESSION · HTTPONLY</MonoLabel>
            </span>
          </div>
        </Card>

        <Card padding="padded" className={styles.card}>
          <MonoLabel tone="danger">Session</MonoLabel>
          <p className={styles.copy}>
            Sign out clears the session cookie on this device. Anything saved
            on the server (designs, themes, renders) stays put.
          </p>
          <Button
            variant="danger"
            size="md"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await logout();
              } finally {
                setSigningOut(false);
              }
            }}
            leadingIcon={
              signingOut ? (
                <Loader2 size={13} className={styles.spin} />
              ) : (
                <LogOut size={13} />
              )
            }
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
