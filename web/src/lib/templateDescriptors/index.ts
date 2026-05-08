import type { TemplateDescriptor } from '../types';
import { reelClone } from './reel-clone';
import { editorialItalic } from './editorial-italic';
import { carnivalPoster } from './carnival-poster';
import { copacabanna } from './copacabanna';
import { kineticMontage } from './kinetic-montage';

const REGISTRY: Record<string, TemplateDescriptor> = {
  [reelClone.templateId]: reelClone,
  [editorialItalic.templateId]: editorialItalic,
  [carnivalPoster.templateId]: carnivalPoster,
  [copacabanna.templateId]: copacabanna,
  [kineticMontage.templateId]: kineticMontage,
};

export function getTemplateDescriptor(templateId: string): TemplateDescriptor | null {
  return REGISTRY[templateId] ?? null;
}

export function listTemplateIds(): string[] {
  return Object.keys(REGISTRY);
}
