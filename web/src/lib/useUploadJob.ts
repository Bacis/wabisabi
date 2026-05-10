import { useRef, useState, type InputHTMLAttributes, type Ref } from 'react';
import { uploadForEditing } from './api';

export type UploadJobInputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref: Ref<HTMLInputElement>;
};

export type UploadJobState = {
  busy: boolean;
  error: string | null;
  // Open the OS file picker. Wrap it in onClick of any UI button.
  pickFile: () => void;
  // Hidden <input type="file"> that must be rendered somewhere in the
  // tree for `pickFile()` to have a target. Spread on a hidden input.
  inputProps: UploadJobInputProps;
};

// Reusable upload hook so the Jobs page header CTA, an empty-state
// button, or any future surface can run the same upload flow without
// rendering the legacy <UploadButton/> chrome.
//
// The caller just renders <input {...inputProps} /> somewhere (visually
// hidden is fine) and triggers `pickFile()` from a styled button.
export function useUploadJob(opts: {
  onUploaded: (jobId: string) => void;
  keepInputMinutes?: number;
  preset?: string;
}): UploadJobState {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await uploadForEditing({
        file,
        keepInputMinutes: opts.keepInputMinutes ?? 60,
        // Default new uploads to the Cinematic (reel-clone) preset. The
        // editor can swap templates / presets afterwards via the picker.
        preset: opts.preset ?? 'reel-clone-default',
      });
      opts.onUploaded(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return {
    busy,
    error,
    pickFile: () => inputRef.current?.click(),
    inputProps: {
      ref: inputRef,
      type: 'file',
      accept: 'video/*',
      className: 'hidden',
      onChange: (e) => {
        const f = e.target.files?.[0];
        if (f) void handleFile(f);
      },
    },
  };
}
