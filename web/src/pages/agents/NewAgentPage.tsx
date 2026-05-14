// /agent/new — agentic caption studio entry. Step 1: stock-clip or upload
// picker in the Atelier aesthetic. Step 2: hand off to AgentDesigner which
// owns its own size-locked workspace.

import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, ImagePlus, ArrowRight } from 'lucide-react';
import {
  Card,
  Chip,
  EmptyState,
  MonoLabel,
  PageHeader,
  PillToggle,
  SerifDisplay,
  StarField,
  atelierStyles as a,
} from '@/components/atelier';
import { fetchStockClips, type StockClipSummary } from '@/lib/api';
import { useUploadJob } from '@/lib/useUploadJob';
import { AgentDesigner } from '@/components/AgentDesigner';
import type { EditorSource } from '@/lib/useEditableSource';
import styles from './NewAgentPage.module.css';

type ChosenSource =
  | { kind: 'stock'; clipId: string; name: string }
  | { kind: 'job'; jobId: string };

type Tab = 'stock' | 'upload';

export function NewAgentPage() {
  const [chosen, setChosen] = useState<ChosenSource | null>(null);

  const editorSource: EditorSource | null = chosen
    ? chosen.kind === 'stock'
      ? { kind: 'stock', clipId: chosen.clipId }
      : { kind: 'job', jobId: chosen.jobId }
    : null;

  if (editorSource) {
    return <AgentDesigner source={editorSource} />;
  }

  return <PickerStep setChosen={setChosen} />;
}

function PickerStep({ setChosen }: { setChosen: (s: ChosenSource) => void }) {
  const [tab, setTab] = useState<Tab>('stock');

  return (
    <div className={`${a.page} ${a.wide}`} style={{ paddingTop: 60 }}>
      <StarField count={64} opacity={0.35} />

      <PageHeader
        eyebrow={
          <MonoLabel tone="cyan" dot>
            New Session
          </MonoLabel>
        }
        title={
          <SerifDisplay size="xl" as="h1">
            Choose your stage.
          </SerifDisplay>
        }
        description="Pick a stock clip or upload your own. The agent transcribes the audio, watches your edits, and converses with you to direct the caption design — no sliders."
      />

      <div className={styles.toolbar}>
        <PillToggle<Tab>
          ariaLabel="Source"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'stock', label: 'Stock', dot: true },
            { value: 'upload', label: 'Upload', dot: true },
          ]}
        />
        <Chip subtle>9:16 only · short clips</Chip>
      </div>

      <div className={styles.body}>
        {tab === 'stock' ? (
          <StockClipPicker
            onPick={(c) =>
              setChosen({ kind: 'stock', clipId: c.id, name: c.name })
            }
          />
        ) : (
          <UploadPanel
            onUploaded={(jobId) => setChosen({ kind: 'job', jobId })}
          />
        )}
      </div>
    </div>
  );
}

function StockClipPicker({
  onPick,
}: {
  onPick: (clip: StockClipSummary) => void;
}) {
  const [clips, setClips] = useState<StockClipSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStockClips()
      .then(setClips)
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) {
    return (
      <div className={styles.errorBox}>
        <MonoLabel tone="danger" dot>Couldn't load stock clips</MonoLabel>
        <span>{error}</span>
      </div>
    );
  }
  if (!clips) {
    return (
      <div className={`${a.grid}`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.skeleton} />
        ))}
      </div>
    );
  }
  if (clips.length === 0) {
    return (
      <EmptyState
        title={<em>No clips on the shelf.</em>}
        body={
          <>
            No stock clips have been seeded yet. Run{' '}
            <code className={styles.code}>
              npx tsx scripts/seed-stock-clips.ts &lt;input-dir&gt;
            </code>{' '}
            to populate this gallery.
          </>
        }
      />
    );
  }

  return (
    <div className={`${a.grid} ${a.themes}`}>
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} onClick={() => onPick(clip)} />
      ))}
    </div>
  );
}

function ClipCard({
  clip,
  onClick,
}: {
  clip: StockClipSummary;
  onClick: () => void;
}) {
  return (
    <Card
      interactive
      padding="none"
      onClick={onClick}
      className={styles.clipCard}
    >
      <div className={styles.clipMedia}>
        <video
          src={`/stock/${clip.id}/clip.mp4`}
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={(e) => void e.currentTarget.play()}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
        <div className={styles.clipBadge}>
          <Chip>{`${clip.width}×${clip.height}`}</Chip>
        </div>
      </div>
      <div className={styles.clipFoot}>
        <div className={styles.clipMeta}>
          <SerifDisplay size="sm" as="div">
            {clip.name}
          </SerifDisplay>
          <MonoLabel tone="dim">
            {clip.durationSec.toFixed(1)}s · {clip.hasTranscript ? 'transcript' : 'no transcript'}
          </MonoLabel>
        </div>
        <ArrowRight size={16} className={styles.arrow} />
      </div>
    </Card>
  );
}

function UploadPanel({ onUploaded }: { onUploaded: (jobId: string) => void }) {
  const upload = useUploadJob({ onUploaded });
  const dropRef = useRef<HTMLLabelElement>(null);
  const [over, setOver] = useState(false);

  return (
    <label
      ref={dropRef}
      className={`${styles.drop} ${over ? styles.over : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && upload.inputProps.ref && 'current' in upload.inputProps.ref) {
          // Re-use the hook's file handler by feeding the input.
          const input = upload.inputProps.ref.current;
          if (input) {
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }}
    >
      <input {...upload.inputProps} />
      <div className={styles.dropInner}>
        <div className={styles.dropIcon}>
          {upload.busy ? (
            <Loader2 size={22} className={styles.spin} />
          ) : (
            <Upload size={22} />
          )}
        </div>
        <SerifDisplay size="md" as="div">
          {upload.busy ? 'Uploading…' : 'Drop a vertical clip here.'}
        </SerifDisplay>
        <MonoLabel tone="dim">
          {upload.busy
            ? 'Transcribing as soon as it lands.'
            : 'Or click to browse · 9:16 mp4 · expires in 24h'}
        </MonoLabel>
        {!upload.busy && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              upload.pickFile();
            }}
            className={styles.pickBtn}
          >
            <ImagePlus size={14} />
            <span>Browse files</span>
          </button>
        )}
        {upload.error && (
          <div className={styles.uploadError}>
            <MonoLabel tone="danger" dot>Upload failed</MonoLabel>
            <span>{upload.error}</span>
          </div>
        )}
      </div>
    </label>
  );
}
