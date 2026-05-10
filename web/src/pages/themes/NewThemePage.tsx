import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { fetchStockClips, type StockClipSummary } from '@/lib/api';
import { useUploadJob } from '@/lib/useUploadJob';
import { Editor } from '@/components/Editor';
import { SaveThemeButton } from '@/components/SaveThemeButton';
import type { EditorSource } from '@/lib/useEditableSource';

type ChosenSource =
  | { kind: 'stock'; clipId: string; name: string }
  | { kind: 'job'; jobId: string };

export function NewThemePage() {
  const [tab, setTab] = useState<'stock' | 'upload'>('stock');
  const [chosen, setChosen] = useState<ChosenSource | null>(null);

  const editorSource: EditorSource | null = chosen
    ? chosen.kind === 'stock'
      ? { kind: 'stock', clipId: chosen.clipId }
      : { kind: 'job', jobId: chosen.jobId }
    : null;

  // Job-uploaded sources expire — they can't back a published theme. Stock
  // clip sources are permanent and become the published showcase.
  const showcaseClipId = chosen?.kind === 'stock' ? chosen.clipId : null;

  if (editorSource) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-4 py-2 flex items-center gap-3">
          <button
            onClick={() => setChosen(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Pick a different clip
          </button>
          <span className="text-xs text-muted-foreground">
            {chosen?.kind === 'stock'
              ? `Editing on stock clip "${chosen.name}"`
              : 'Editing on your uploaded clip (will expire — pick a stock clip to publish)'}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <Editor
            source={editorSource}
            actions={({ templateId, styleSpec, inputAvailable }) => (
              <SaveThemeButton
                templateId={templateId}
                styleSpec={styleSpec}
                defaultShowcaseClipId={showcaseClipId}
                disabled={!inputAvailable}
              />
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New theme</h1>
        <p className="text-sm text-muted-foreground">
          Pick a stock clip to start designing instantly, or upload your own.
          Themes published with a stock clip backdrop never expire.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'stock' | 'upload')}>
        <TabsList>
          <TabsTrigger value="stock">Stock clips</TabsTrigger>
          <TabsTrigger value="upload">Upload your own</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="mt-4">
          <StockClipPicker
            onPick={(clip) =>
              setChosen({ kind: 'stock', clipId: clip.id, name: clip.name })
            }
          />
        </TabsContent>
        <TabsContent value="upload" className="mt-4">
          <UploadPanel onUploaded={(jobId) => setChosen({ kind: 'job', jobId })} />
        </TabsContent>
      </Tabs>
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
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
        {error}
      </div>
    );
  }

  if (!clips) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading stock clips…
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground space-y-2">
        <p>No stock clips have been seeded yet.</p>
        <p className="text-xs font-mono">
          npx tsx scripts/seed-stock-clips.ts &lt;input-dir&gt;
        </p>
        <p>Or upload your own clip in the other tab.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {clips.map((clip) => (
        <Card
          key={clip.id}
          className="cursor-pointer transition-colors hover:border-primary/50"
          onClick={() => onPick(clip)}
        >
          <CardHeader className="space-y-1">
            <h3 className="font-semibold leading-tight">{clip.name}</h3>
            <p className="text-xs text-muted-foreground">
              {clip.durationSec.toFixed(1)}s · {clip.width}×{clip.height}
              {clip.hasTranscript ? '' : ' · no transcript'}
            </p>
          </CardHeader>
          <CardContent>
            <video
              src={`/stock/${clip.id}/clip.mp4`}
              muted
              loop
              playsInline
              preload="metadata"
              className="aspect-[9/16] w-full max-h-64 rounded-md bg-muted object-cover"
              onMouseEnter={(e) => void e.currentTarget.play()}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function UploadPanel({ onUploaded }: { onUploaded: (jobId: string) => void }) {
  const upload = useUploadJob({ onUploaded });
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center space-y-3">
      <p className="text-sm text-muted-foreground">
        Upload a short vertical clip. We'll transcribe it and drop you into
        the editor. Uploads expire after 24h, so they're great for quick
        experiments — pin a stock clip later to publish.
      </p>
      <input {...upload.inputProps} />
      <Button onClick={upload.pickFile} disabled={upload.busy}>
        {upload.busy ? 'Uploading…' : 'Pick a video'}
      </Button>
      {upload.error && (
        <div className="text-xs text-rose-300">{upload.error}</div>
      )}
    </div>
  );
}
