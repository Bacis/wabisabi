import type { TemplateDescriptor } from '../types';

export const copacabanna: TemplateDescriptor = {
  templateId: 'copacabanna',
  // Copacabanna draws no outline; emphasisFill is unused (the per-chunk
  // palette cycle lives in reel.palette instead).
  excludeCommonPaths: ['animation.preset', 'color.stroke', 'color.strokeWidth'],
  groups: [
    {
      id: 'copacabanna',
      label: 'Copacabanna',
      description:
        'Brazilian samba-sway captions — Lobster script with a 5-stop tropical palette cycled per word, plus entry tilt and ongoing sway.',
      controls: [
        {
          kind: 'colorList',
          path: 'reel.palette',
          label: 'Palette (per-word cycle)',
          default: ['#CA402A', '#0E694F', '#6EB453', '#AED953', '#FDFF55'],
          minColors: 2,
          maxColors: 8,
        },
        {
          kind: 'slider',
          path: 'reel.tiltDegrees',
          label: 'Entry tilt',
          min: -20,
          max: 20,
          step: 0.5,
          default: -8,
          unit: '°',
          description: 'Words enter at this rotation, springs to upright.',
        },
        {
          kind: 'slider',
          path: 'reel.swayAmplitudeDegrees',
          label: 'Sway amplitude',
          min: 0,
          max: 8,
          step: 0.1,
          default: 3,
          unit: '°',
        },
        {
          kind: 'slider',
          path: 'reel.swayHz',
          label: 'Sway frequency',
          min: 0,
          max: 4,
          step: 0.1,
          default: 0.8,
          unit: 'Hz',
        },
        {
          kind: 'slider',
          path: 'reel.fillerOpacity',
          label: 'Filler word opacity',
          min: 0,
          max: 1,
          step: 0.05,
          default: 0.65,
        },
        {
          kind: 'slider',
          path: 'reel.emphasisSizeMultiplier',
          label: 'Emphasis size multiplier',
          min: 1,
          max: 2,
          step: 0.05,
          default: 1.25,
        },
        {
          kind: 'switch',
          path: 'reel.inferEmphasis',
          label: 'Auto-infer emphasis',
          default: true,
          description: 'Mark long content words as emphasis when no plan provided.',
        },
      ],
    },
  ],
};
