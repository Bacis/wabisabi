import type { ControlGroup } from './types';

// Hand-curated common-fields descriptor. We could derive this from
// StyleSpecSchema (`@shared/styleSpec`) at runtime — but the schema doesn't
// carry UX hints (a number could be a px value, a millisecond, or a 0–1
// fraction; the form needs different controls for each). Authoring once is
// simpler than annotating the Zod schema.
export const COMMON_GROUPS: ControlGroup[] = [
  {
    id: 'font',
    label: 'Font',
    controls: [
      {
        kind: 'fontFamily',
        path: 'font.family',
        label: 'Family',
        default: 'Inter',
      },
      {
        kind: 'slider',
        path: 'font.weight',
        label: 'Weight',
        min: 100,
        max: 900,
        step: 100,
        default: 800,
      },
      {
        kind: 'slider',
        path: 'font.size',
        label: 'Size',
        min: 24,
        max: 320,
        step: 1,
        default: 72,
        unit: 'px',
        description: 'Nominal size at 1080-wide source. Templates may override.',
      },
      {
        kind: 'slider',
        path: 'font.letterSpacing',
        label: 'Letter spacing',
        min: -8,
        max: 8,
        step: 0.5,
        default: 0,
        unit: 'px',
      },
      {
        kind: 'select',
        path: 'font.textTransform',
        label: 'Case',
        options: [
          { value: 'none', label: 'As written' },
          { value: 'uppercase', label: 'UPPERCASE' },
          { value: 'lowercase', label: 'lowercase' },
        ],
        default: 'uppercase',
      },
    ],
  },
  {
    id: 'color',
    label: 'Color',
    controls: [
      {
        kind: 'color',
        path: 'color.fill',
        label: 'Fill',
        default: '#ffffff',
      },
      {
        kind: 'color',
        path: 'color.stroke',
        label: 'Stroke color',
        default: '#000000',
      },
      {
        kind: 'slider',
        path: 'color.strokeWidth',
        label: 'Stroke width',
        min: 0,
        max: 20,
        step: 0.5,
        default: 8,
        unit: 'px',
      },
      {
        kind: 'colorList',
        path: 'color.emphasisFill',
        label: 'Emphasis palette',
        default: ['#ffe14b'],
        minColors: 1,
        maxColors: 8,
        description: 'Cycled per chunk by templates that support it.',
      },
    ],
  },
  {
    id: 'layout',
    label: 'Layout',
    controls: [
      {
        kind: 'select',
        path: 'layout.position',
        label: 'Position',
        options: [
          { value: 'top' },
          { value: 'middle' },
          { value: 'bottom' },
        ],
        default: 'bottom',
      },
      {
        kind: 'select',
        path: 'layout.align',
        label: 'Align',
        options: [
          { value: 'left' },
          { value: 'center' },
          { value: 'right' },
        ],
        default: 'center',
      },
      {
        kind: 'slider',
        path: 'layout.safeMargin',
        label: 'Safe margin',
        min: 0,
        max: 0.4,
        step: 0.01,
        default: 0.15,
        description: 'Fraction of frame height kept clear from top/bottom edge.',
      },
      {
        kind: 'slider',
        path: 'layout.maxWordsPerLine',
        label: 'Max words / line',
        min: 1,
        max: 8,
        step: 1,
        default: 4,
      },
    ],
  },
];
