// Save / Render buttons for the agent designer. Mounts into AtelierShell's
// page-actions portal so the workspace doesn't need its own header row.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Check, Loader2 } from 'lucide-react';
import { Button, PageActions, MonoLabel } from '@/components/atelier';
import { useEditor } from '@/lib/editor/store';
import { serializeState } from '@/lib/editor/serialize';
import { createDesign, patchDesign, renderDesign } from '@/lib/api';

export function HeaderActions() {
  const navigate = useNavigate();
  const designId = useEditor((s) => s.designId);
  const designName = useEditor((s) => s.designName);
  const source = useEditor((s) => s.source);
  const setDesignId = useEditor((s) => s.setDesignId);

  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    if (!source) return;
    setError(null);
    setSaving(true);
    try {
      const state = serializeState(useEditor.getState());
      if (designId) {
        await patchDesign(designId, { name: designName, state });
      } else {
        const sourceKind = source.kind;
        const sourceId = source.kind === 'stock' ? source.clipId : source.jobId;
        const created = await createDesign({ name: designName, sourceKind, sourceId, state });
        setDesignId(created.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onRender() {
    if (!designId) await onSave();
    const currentId = useEditor.getState().designId;
    if (!currentId) return;
    setRendering(true);
    setError(null);
    try {
      const { id } = await renderDesign(currentId);
      navigate(`/jobs/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setRendering(false);
    }
  }

  return (
    <PageActions>
      {error && (
        <MonoLabel tone="danger" dot>
          {error}
        </MonoLabel>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onSave}
        disabled={saving}
        leadingIcon={
          saving ? (
            <Loader2 size={12} className="atelier-spin" />
          ) : (
            <Check size={12} />
          )
        }
      >
        {saving ? 'Saving' : 'Save'}
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={onRender}
        disabled={rendering || saving}
        leadingIcon={
          rendering ? (
            <Loader2 size={12} className="atelier-spin" />
          ) : (
            <Sparkles size={12} />
          )
        }
      >
        {rendering ? 'Rendering' : 'Render'}
      </Button>
    </PageActions>
  );
}
