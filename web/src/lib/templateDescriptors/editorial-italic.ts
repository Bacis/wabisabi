import type { TemplateDescriptor } from '../types';

export const editorialItalic: TemplateDescriptor = {
  templateId: 'editorial-italic',
  // Editorial-italic draws no stroke (it's pure white serif on raw video)
  // and ignores animation.preset (the template uses a fixed fade+scale
  // entry with interpolate, not the pop/karaoke/typewriter dispatch).
  excludeCommonPaths: ['animation.preset', 'color.stroke', 'color.strokeWidth'],
  groups: [
    {
      id: 'editorial',
      label: 'Editorial style',
      description:
        'Italic-by-default phrase-at-a-time captions with hero/default size tiers and a position cycle.',
      controls: [
        {
          kind: 'switch',
          path: 'reel.italicByDefault',
          label: 'Italic by default',
          default: true,
          description: 'Emphasized chunks (every word) flip to roman.',
        },
        {
          kind: 'slider',
          path: 'reel.heroSizeBoost',
          label: 'Hero size boost',
          min: 1.0,
          max: 3.0,
          step: 0.1,
          default: 1.6,
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
          path: 'reel.heightCap',
          label: 'Height cap',
          min: 0.15,
          max: 0.5,
          step: 0.01,
          default: 0.32,
          description: 'Max font size as fraction of frame height.',
        },
        {
          kind: 'multiSelect',
          path: 'reel.positionCycle',
          label: 'Position cycle',
          options: [
            { value: 'top' },
            { value: 'middle' },
            { value: 'bottom' },
          ],
          default: ['top', 'middle', 'bottom'],
          description: 'Vertical bands cycled per chunk index.',
        },
      ],
    },
  ],
};
