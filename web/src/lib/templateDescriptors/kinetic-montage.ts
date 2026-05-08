import type { TemplateDescriptor } from '../types';

export const kineticMontage: TemplateDescriptor = {
  templateId: 'kinetic-montage',
  excludeCommonPaths: ['animation.preset'],
  groups: [
    {
      id: 'montage',
      label: 'Kinetic montage',
      description:
        'Cascade-anchor multi-color captions: top lines smaller, anchor line largest, per-word reveal at spoken time.',
      controls: [
        {
          kind: 'slider',
          path: 'reel.cascadeTopRatio',
          label: 'Cascade top ratio',
          min: 0.3,
          max: 1.0,
          step: 0.01,
          default: 0.47,
          description: 'Top-line size as fraction of bottom anchor.',
        },
        {
          kind: 'slider',
          path: 'reel.emphasisFillRatio',
          label: 'Anchor fill ratio',
          min: 0.4,
          max: 1.0,
          step: 0.05,
          default: 0.75,
        },
        {
          kind: 'slider',
          path: 'reel.emphasisMaxHeightRatio',
          label: 'Anchor max height',
          min: 0.08,
          max: 0.30,
          step: 0.01,
          default: 0.16,
        },
        {
          kind: 'switch',
          path: 'reel.multiColorEmphasis',
          label: 'Multi-color emphasis cycle',
          default: true,
        },
        {
          kind: 'select',
          path: 'reel.wordReveal',
          label: 'Word reveal',
          options: [
            { value: 'all', label: 'All at once' },
            { value: 'progressive', label: 'Progressive (karaoke)' },
          ],
          default: 'progressive',
        },
        {
          kind: 'slider',
          path: 'reel.italicAccentRate',
          label: 'Italic accent rate',
          min: 0,
          max: 0.3,
          step: 0.01,
          default: 0.06,
        },
      ],
    },
  ],
};
