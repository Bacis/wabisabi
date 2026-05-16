import type { ControlGroup, TemplateDescriptor } from '../types';
import { REEL_CLONE_THEMES } from '../themes/reel-clone-themes';

// Reusable tier control group factory. Each emphasis tier (yellow / red /
// italic) exposes the same five sub-controls — fill, font family, font
// weight, size multiplier, stroke. The path prefix is the only thing that
// differs.
function tierGroup(
  id: string,
  label: string,
  pathPrefix: string,
  options: { description: string; defaultFill: string; defaultWeight: number },
): ControlGroup {
  return {
    id,
    label,
    description: options.description,
    controls: [
      {
        kind: 'fill',
        path: `${pathPrefix}.fill`,
        label: 'Fill (solid + alpha or gradient)',
        default: options.defaultFill,
      },
      {
        kind: 'fontFamily',
        path: `${pathPrefix}.fontFamily`,
        label: 'Font (override base)',
      },
      {
        kind: 'slider',
        path: `${pathPrefix}.fontWeight`,
        label: 'Weight',
        min: 100,
        max: 900,
        step: 100,
        default: options.defaultWeight,
      },
      {
        kind: 'slider',
        path: `${pathPrefix}.sizeMultiplier`,
        label: 'Size',
        min: 0.5,
        max: 3.0,
        step: 0.05,
        default: 1.0,
        description: '1.0 = base size; 1.5 = 50% larger.',
      },
      {
        kind: 'color',
        path: `${pathPrefix}.strokeColor`,
        label: 'Stroke color',
        default: '#000000',
      },
      {
        kind: 'slider',
        path: `${pathPrefix}.strokeWidth`,
        label: 'Stroke width',
        min: 0,
        max: 20,
        step: 0.5,
        default: 0,
        unit: 'px',
      },
      {
        kind: 'select',
        path: `${pathPrefix}.effect`,
        label: 'Motion FX',
        options: [
          { value: 'none', label: 'None — entry spring only' },
          // Vol.02 — entry/sustain motion. No intensity dial.
          { value: 'samba', label: 'Samba — partido alto clave (sustains)' },
          { value: 'breathe', label: 'Breathe — focus blur + sine sustain' },
          { value: 'flare', label: 'Flare — anamorphic horizontal streak' },
          { value: 'crystal', label: 'Crystal — per-letter shatter snap' },
          { value: 'magnetic', label: 'Magnetic — damped oscillator pull' },
          // Vol.03 — intensity-driven body distortion. Use the Intensity
          // slider below to sweep amplitude + rate together.
          { value: 'resonance', label: 'Resonance — dual-frequency vibration ◉' },
          { value: 'inflation', label: 'Inflation — dilate breathe ◉' },
          { value: 'slice', label: 'Slice Glitch — banded offsets ◉' },
          { value: 'ferro', label: 'Ferrofluid — magnetic spike halo ◉' },
          { value: 'shockwave', label: 'Shockwave — pulsed distortion ◉' },
        ],
        default: 'none',
        description:
          'Per-tier motion. Vol.02 (samba/breathe/flare/crystal/magnetic) layer on the entry spring. Vol.03 (◉ marked: resonance/inflation/slice/ferro/shockwave) are intensity-driven body distortions; set Intensity below.',
      },
      {
        kind: 'slider',
        path: `${pathPrefix}.intensity`,
        label: 'Intensity',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        description:
          'Single dial driving both amplitude and rate. 0.05 = barely-perceptible, 0.95 = violent.',
        showIf: {
          path: `${pathPrefix}.effect`,
          oneOf: ['resonance', 'inflation', 'slice', 'ferro', 'shockwave'],
        },
      },
    ],
  };
}

export const reelClone: TemplateDescriptor = {
  templateId: 'reel-clone',
  // Animation preset is shared with the other templates — reel-clone now
  // drives its entry through the same evalEnter spec engine.
  groups: [
    {
      id: 'themes',
      label: 'Theme presets',
      description:
        'One-click vibes — applies palette, fonts, and tier styling. Other knobs (animation, position, italic rate) are preserved so you can stack themes on top of your tweaks.',
      controls: [
        {
          kind: 'themePicker',
          // path is unused for themePicker — themes are bulk operations
          // applied via onApplyTheme rather than a single dotPath setter.
          path: '__theme',
          label: '',
          themes: REEL_CLONE_THEMES,
        },
      ],
    },
    {
      id: 'reel',
      label: 'Reel cascade',
      description: 'Position-aware emphasis with cascading line sizes.',
      controls: [
        {
          kind: 'select',
          path: 'reel.emphasisStyle',
          label: 'Emphasis style',
          options: [
            { value: 'inline-color', label: 'Inline color (every emphasis word colored)' },
            { value: 'block', label: 'Block (last word = white anchor, mid-stack colored)' },
            { value: 'combined', label: 'Combined (legacy: red + uppercase)' },
          ],
          default: 'inline-color',
          description:
            'Inline-color makes every emphasis word render palette-colored. Block hides palette colors on single-line chunks (last word becomes a white anchor instead).',
        },
        {
          kind: 'switch',
          path: 'reel.inferEmphasis',
          label: 'Auto-infer emphasis',
          default: true,
          description:
            'Marks long content words as emphasis when the captionPlan has no flags. Pairs well with Inline color.',
        },
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
          label: 'Cycle palette per emphasis word',
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
          default: 0.1,
          description: 'Fraction of long content words rendered italic.',
        },
      ],
    },

    // Per-tier overrides — palette index 0 is "yellow" by default,
    // palette index 1 is "red". Italic tier applies to ~italicAccentRate
    // fraction of qualifying words.
    tierGroup('tier-primary', 'Primary emphasis (yellow tier)', 'reel.tiers.byPaletteIndex.0', {
      description:
        'Words on palette index 0 of the emphasis cycle. Override fill / font / size / stroke independently. Switch the fill to a gradient for cinematic looks.',
      defaultFill: '#ffd700',
      defaultWeight: 900,
    }),
    tierGroup('tier-secondary', 'Secondary emphasis (red tier)', 'reel.tiers.byPaletteIndex.1', {
      description: 'Words on palette index 1 of the emphasis cycle.',
      defaultFill: '#ff2a2a',
      defaultWeight: 900,
    }),
    tierGroup('tier-italic', 'Italic accent', 'reel.tiers.italic', {
      description:
        'The hash-gated italic accent words (~italicAccentRate fraction). Override their look independently from the palette tiers.',
      defaultFill: '#ffffff',
      defaultWeight: 900,
    }),
  ],
};
