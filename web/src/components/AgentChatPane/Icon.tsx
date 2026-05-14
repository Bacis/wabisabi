// Inline SVG icon set ported from the prototype. Keeps the chat panel
// dependency-light (no lucide icons here — we already use them elsewhere,
// but this set is tuned for the cinematic 13-16px scale).

type Name =
  | 'spark'
  | 'wand'
  | 'image'
  | 'hash'
  | 'layers'
  | 'clock'
  | 'wave'
  | 'audio'
  | 'undo'
  | 'send'
  | 'at'
  | 'paper'
  | 'arrow'
  | 'x'
  | 'check'
  | 'edit'
  | 'more'
  | 'branch'
  | 'diff'
  | 'history'
  | 'plus'
  | 'play'
  | 'pause'
  | 'sparkle'
  | 'caret-left'
  | 'caret-down'
  | 'cursor';

export function Icon({ name, size = 14 }: { name: Name; size?: number }) {
  const s = {
    width: size,
    height: size,
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'spark':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />
        </svg>
      );
    case 'wand':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M2 14l8-8M10 6l2-2 2 2-2 2zM12 2l.7 1.3L14 4l-1.3.7L12 6l-.7-1.3L10 4l1.3-.7zM3 8l.5 1L4.5 9.5 3.5 10 3 11l-.5-1L1.5 9.5 2.5 9z" />
        </svg>
      );
    case 'image':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <rect x="2" y="3" width="12" height="10" rx="1.2" />
          <circle cx="6" cy="7" r="1.2" />
          <path d="M3 12l3.5-3.5L9 11l2-2 2 2" />
        </svg>
      );
    case 'hash':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M6 2l-1 12M11 2l-1 12M2 6h12M2 11h12" />
        </svg>
      );
    case 'layers':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M8 2L1.5 5 8 8l6.5-3zM2 8.5L8 11l6-2.5M2 11.5L8 14l6-2.5" />
        </svg>
      );
    case 'clock':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
      );
    case 'wave':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M2 8c1-3 2-3 3 0s2 3 3 0 2-3 3 0 2 3 3 0" />
        </svg>
      );
    case 'audio':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M3 6v4h2l3 2.5v-9L5 6H3z" />
          <path d="M11 5.5a4 4 0 010 5M13 3.5a7 7 0 010 9" />
        </svg>
      );
    case 'undo':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M3 7h7a3.5 3.5 0 010 7H7M3 7l3-3M3 7l3 3" />
        </svg>
      );
    case 'send':
      return (
        <svg viewBox="0 0 16 16" {...s} fill="currentColor" stroke="none">
          <path d="M2 14L14 8 2 2l2 5 6 1-6 1z" />
        </svg>
      );
    case 'at':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="8" cy="8" r="3" />
          <path d="M11 8v1.5a1.5 1.5 0 003 0V8a6 6 0 10-2.5 4.8" />
        </svg>
      );
    case 'paper':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M11 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V4l-2-2z" />
          <path d="M10 2v3h3" />
        </svg>
      );
    case 'arrow':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M4 8h8M9 4l4 4-4 4" />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      );
    case 'edit':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M9 4l3 3-7 7H2v-3zM10.5 2.5l1 1L13 5l1-1-2-2z" />
        </svg>
      );
    case 'more':
      return (
        <svg viewBox="0 0 16 16" {...s} fill="currentColor" stroke="none">
          <circle cx="3" cy="8" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="13" cy="8" r="1.2" />
        </svg>
      );
    case 'branch':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="4" cy="12" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
          <path d="M4 5.5v5M5.5 4h2A3 3 0 0110.5 7v.5" />
        </svg>
      );
    case 'diff':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M5 2v9a2 2 0 002 2h4M11 14V5a2 2 0 00-2-2H5M3 4l2-2 2 2M13 12l-2 2-2-2" />
        </svg>
      );
    case 'history':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M3 8a5 5 0 105-5V1L4 4l4 3V5" />
          <path d="M8 5v3l2 1.5" />
        </svg>
      );
    case 'plus':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M8 3v10M3 8h10" />
        </svg>
      );
    case 'play':
      return (
        <svg viewBox="0 0 16 16" {...s} fill="currentColor" stroke="none">
          <path d="M4 3v10l9-5z" />
        </svg>
      );
    case 'pause':
      return (
        <svg viewBox="0 0 16 16" {...s} fill="currentColor" stroke="none">
          <rect x="3" y="3" width="4" height="10" />
          <rect x="9" y="3" width="4" height="10" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13 6.5 8.5 2 7l4.5-1.5z" />
        </svg>
      );
    case 'caret-left':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M10 4l-4 4 4 4" />
        </svg>
      );
    case 'caret-down':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      );
    case 'cursor':
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M3 2l4 11 2-4 4-2z" />
        </svg>
      );
    default:
      return null;
  }
}
