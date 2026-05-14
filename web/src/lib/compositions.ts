// Map templateId → React composition. The Player loads one of these and
// runs it with the live styleSpec as inputProps. Templates not in the
// registry fall back to the still-frame preview path.

import type { ComponentType } from 'react';
import { ReelClone } from '@remotion-templates/ReelClone';
import { PopWords } from '@remotion-templates/PopWords';
import { CaptionDesigner } from '@remotion-templates/CaptionDesigner';

// We deliberately type as `any`-props here — the schema is dynamic
// (StyleSpec is permissive at runtime), and the Player API expects a
// loose-typed component. Each template internally narrows its styleSpec.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<string, ComponentType<any>> = {
  'reel-clone': ReelClone,
  'pop-words': PopWords,
  'caption-designer': CaptionDesigner,
};

export function getComposition(templateId: string): ComponentType<any> | null {
  return REGISTRY[templateId] ?? null;
}

export function hasPlayerSupport(templateId: string): boolean {
  return templateId in REGISTRY;
}
