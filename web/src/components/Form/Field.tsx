import type { ReactNode } from 'react';

type Props = {
  label: string;
  description?: string;
  trailing?: ReactNode;
  children: ReactNode;
};

export function Field({ label, description, trailing, children }: Props) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-ink-200 uppercase tracking-wide">
          {label}
        </label>
        {trailing && <div className="text-xs text-ink-400 tabular-nums">{trailing}</div>}
      </div>
      {children}
      {description && (
        <p className="text-[11px] leading-snug text-ink-400">{description}</p>
      )}
    </div>
  );
}
