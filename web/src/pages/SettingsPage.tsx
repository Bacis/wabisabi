import { useEffect, useState } from 'react';
import { LogOut, Loader2, Copy, Trash2, KeyRound } from 'lucide-react';
import {
  Button,
  Card,
  MonoLabel,
  PageHeader,
  Pill,
  SerifDisplay,
  TextField,
  atelierStyles as a,
} from '@/components/atelier';
import { useAuth } from '@/lib/auth';
import {
  type ApiKey,
  createMcpKey,
  listMcpKeys,
  revokeMcpKey,
} from '@/lib/api';
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

        <ApiKeysCard />

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

function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ plaintext: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMcpKeys()
      .then((list) => {
        if (!cancelled) setKeys(list);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setErr(null);
    try {
      const { key, plaintext } = await createMcpKey(name);
      setRevealed({ plaintext, name: key.name });
      setKeys((prev) => (prev ? [key, ...prev] : [key]));
      setNewName('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this key? Any MCP clients still using it will start getting 401s immediately.')) return;
    setErr(null);
    try {
      await revokeMcpKey(id);
      setKeys((prev) =>
        prev ? prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)) : prev,
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Card padding="padded" className={styles.card}>
      <div className={styles.cardHeader}>
        <MonoLabel tone="amber">MCP API Keys</MonoLabel>
        <span className={styles.cardEyebrow}>
          For Claude Desktop, Cursor, and other MCP clients.
        </span>
      </div>

      <p className={styles.copy}>
        Mint a bearer token to let external AI editors drive Wabisabi via the{' '}
        <code className={styles.code}>/mcp</code> endpoint. The full token is
        shown <strong>once</strong> at creation — store it in your client's
        config immediately.
      </p>

      <div className={styles.createRow}>
        <TextField
          placeholder="e.g. Claude Desktop on laptop"
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          containerClassName={styles.createInput}
          maxLength={80}
          disabled={creating}
        />
        <Button
          variant="primary"
          size="md"
          disabled={creating || !newName.trim()}
          onClick={handleCreate}
          leadingIcon={
            creating ? <Loader2 size={13} className={styles.spin} /> : <KeyRound size={13} />
          }
        >
          {creating ? 'Minting…' : 'Create key'}
        </Button>
      </div>

      {revealed && (
        <div className={styles.reveal}>
          <MonoLabel tone="amber">Copy this now — it won't be shown again</MonoLabel>
          <div className={styles.revealRow}>
            <code className={styles.revealToken}>{revealed.plaintext}</code>
            <Button
              variant="cyan"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(revealed.plaintext).catch(() => {});
              }}
              leadingIcon={<Copy size={12} />}
            >
              Copy
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRevealed(null)}
          >
            I've saved it
          </Button>
        </div>
      )}

      {err && <div className={styles.error}>{err}</div>}

      <div className={styles.keyList}>
        {keys === null && <MonoLabel tone="dim">Loading…</MonoLabel>}
        {keys && keys.length === 0 && (
          <MonoLabel tone="dim">No keys yet. Mint one above.</MonoLabel>
        )}
        {keys &&
          keys.map((k) => (
            <div key={k.id} className={styles.keyRow}>
              <div className={styles.keyMeta}>
                <span className={styles.keyName}>{k.name}</span>
                <code className={styles.keyPrefix}>{k.keyPrefix}…</code>
                <span className={styles.keyHint}>
                  {k.revokedAt
                    ? `revoked ${formatDate(k.revokedAt)}`
                    : k.lastUsedAt
                      ? `last used ${formatDate(k.lastUsedAt)}`
                      : `created ${formatDate(k.createdAt)} · unused`}
                </span>
              </div>
              {!k.revokedAt && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(k.id)}
                  leadingIcon={<Trash2 size={12} />}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
      </div>
    </Card>
  );
}

function formatDate(iso: string): string {
  // Server stores 'YYYY-MM-DD HH:MM:SS' (UTC). Render as a short relative tag.
  const t = Date.parse(iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return iso;
  const deltaSec = (Date.now() - t) / 1000;
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}
