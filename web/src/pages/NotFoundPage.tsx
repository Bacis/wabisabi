import { ArrowLeft } from 'lucide-react';
import {
  Button,
  Halo,
  MonoLabel,
  SerifDisplay,
  StarField,
  atelierStyles as a,
} from '@/components/atelier';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <div className={`${a.page} ${styles.scene}`}>
      <StarField count={56} opacity={0.45} />
      <Halo soft />
      <div className={styles.body}>
        <MonoLabel tone="dim">404 · No route</MonoLabel>
        <SerifDisplay size="xl">Off the map.</SerifDisplay>
        <p className={styles.lede}>
          This URL doesn't lead anywhere in the studio. Head back to the
          agent or browse the ledger.
        </p>
        <div className={styles.actions}>
          <Button
            as="a"
            href="/agent/new"
            variant="cyan"
            leadingIcon={<ArrowLeft size={13} />}
          >
            Back to Atelier
          </Button>
          <Button as="a" href="/jobs" variant="ghost">
            Open ledger
          </Button>
        </div>
      </div>
    </div>
  );
}
