import type { TemplateDescriptor } from '../types';

export const carnivalPoster: TemplateDescriptor = {
  templateId: 'carnival-poster',
  // No outline (the silkscreen drop-shadow does the contrast work) and the
  // animation.preset dropdown does nothing — carnival uses a bespoke
  // pop+tilt+sway driven by spring()/sin oscillators.
  excludeCommonPaths: ['animation.preset', 'color.stroke', 'color.strokeWidth'],
  groups: [
    {
      id: 'carnival',
      label: 'Carnival poster',
      description:
        'Stacked one-word-per-line poster captions with palette cycle, per-word tilt, and corner sparkles.',
      controls: [
        {
          kind: 'switch',
          path: 'reel.paletteCycle',
          label: 'Cycle palette per chunk',
          default: true,
        },
        {
          kind: 'slider',
          path: 'reel.tiltDegreesPerWord',
          label: 'Per-word tilt',
          min: 0,
          max: 12,
          step: 0.5,
          default: 3,
          unit: '°',
        },
        {
          kind: 'slider',
          path: 'reel.swayAmplitudeDegrees',
          label: 'Sway amplitude',
          min: 0,
          max: 4,
          step: 0.1,
          default: 1.0,
          unit: '°',
        },
        {
          kind: 'slider',
          path: 'reel.swayHz',
          label: 'Sway frequency',
          min: 0,
          max: 4,
          step: 0.1,
          default: 1.0,
          unit: 'Hz',
        },
        {
          kind: 'slider',
          path: 'reel.heroFillRatio',
          label: 'Hero fill ratio',
          min: 0.5,
          max: 1.0,
          step: 0.05,
          default: 0.85,
        },
        {
          kind: 'slider',
          path: 'reel.heightCapRatio',
          label: 'Per-line height cap',
          min: 0.10,
          max: 0.40,
          step: 0.01,
          default: 0.18,
          description: 'Per-line size cap as fraction of frame height.',
        },
        {
          kind: 'switch',
          path: 'reel.sparkleEnabled',
          label: 'Show sparkles',
          default: true,
        },
        {
          kind: 'slider',
          path: 'reel.sparkleCount',
          label: 'Sparkle count',
          min: 0,
          max: 4,
          step: 1,
          default: 4,
        },
      ],
    },
  ],
};
