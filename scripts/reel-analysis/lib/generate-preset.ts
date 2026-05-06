import { writeFileSync } from 'fs';
import { join } from 'path';

export type GeneratedPreset = {
  id: string;
  name: string;
  description: string;
  templateId: 'pop-words' | 'single-word' | 'reel-clone';
  styleSpec: Record<string, any>;
};

export function generatePreset(
  recipe: Record<string, any>,
  slug: string,
  runDir: string,
): GeneratedPreset {
  const maxWords = recipe.layout?.maxWordsPerLine ?? 4;
  const hasCustomElements = (recipe.customElements?.length ?? 0) > 0;
  const hasMultiColorEmphasis = Array.isArray(recipe.color?.emphasisFill);
  const hasDramaticSizeVariance = hasCustomElements || hasMultiColorEmphasis;

  // Choose template: reel-clone for editorial-sans styles with dramatic
  // size variance and multi-color emphasis; single-word for 1 word/chunk;
  // pop-words for everything else.
  const templateId: 'pop-words' | 'single-word' | 'reel-clone' =
    hasDramaticSizeVariance ? 'reel-clone' : maxWords <= 1 ? 'single-word' : 'pop-words';

  const styleSpec: Record<string, any> = {};

  // Font
  if (recipe.font) {
    styleSpec.font = {};
    if (recipe.font.family) styleSpec.font.family = recipe.font.family;
    if (recipe.font.weight) styleSpec.font.weight = recipe.font.weight;
    if (recipe.font.size) styleSpec.font.size = recipe.font.size;
    if (recipe.font.letterSpacing) styleSpec.font.letterSpacing = recipe.font.letterSpacing;
    if (recipe.font.textTransform) styleSpec.font.textTransform = recipe.font.textTransform;
  }

  // Color
  if (recipe.color) {
    styleSpec.color = {};
    if (recipe.color.fill) styleSpec.color.fill = recipe.color.fill;
    if (recipe.color.stroke) styleSpec.color.stroke = recipe.color.stroke;
    if (recipe.color.strokeWidth != null) styleSpec.color.strokeWidth = recipe.color.strokeWidth;
    if (recipe.color.emphasisFill) styleSpec.color.emphasisFill = recipe.color.emphasisFill;
    if (recipe.color.background) styleSpec.color.background = recipe.color.background;
    if (recipe.color.shadow) styleSpec.color.shadow = recipe.color.shadow;
    if (recipe.color.fillGradient) styleSpec.color.fillGradient = recipe.color.fillGradient;
  }

  // Layout
  if (recipe.layout) {
    styleSpec.layout = {};
    if (recipe.layout.position) styleSpec.layout.position = recipe.layout.position;
    if (recipe.layout.safeMargin != null) styleSpec.layout.safeMargin = recipe.layout.safeMargin;
    if (recipe.layout.maxWordsPerLine) styleSpec.layout.maxWordsPerLine = recipe.layout.maxWordsPerLine;
    if (recipe.layout.align) styleSpec.layout.align = recipe.layout.align;
    if (recipe.layout.padding) styleSpec.layout.padding = recipe.layout.padding;
    if (recipe.layout.borderRadius != null) styleSpec.layout.borderRadius = recipe.layout.borderRadius;
    if (recipe.layout.gapRatio != null) styleSpec.layout.gapRatio = recipe.layout.gapRatio;
  }

  // Animation
  if (recipe.animation) {
    styleSpec.animation = {};
    if (recipe.animation.preset) styleSpec.animation.preset = recipe.animation.preset;
    if (recipe.animation.durationMs) styleSpec.animation.durationMs = recipe.animation.durationMs;
    if (recipe.animation.emphasisScale) styleSpec.animation.emphasisScale = recipe.animation.emphasisScale;
    if (recipe.animation.scaleFrom) styleSpec.animation.scaleFrom = recipe.animation.scaleFrom;
    if (recipe.animation.activeBoost) styleSpec.animation.activeBoost = recipe.animation.activeBoost;
    if (recipe.animation.tailMs) styleSpec.animation.tailMs = recipe.animation.tailMs;
  }

  const preset: GeneratedPreset = {
    id: `reel-${slug}`,
    name: `Reel ${slug}`,
    description: recipe.description || `Style extracted from reel ${slug}`,
    templateId,
    styleSpec,
  };

  // Save preset
  const presetPath = join(runDir, 'preset.json');
  writeFileSync(presetPath, JSON.stringify(preset, null, 2));
  console.log(`  Preset saved: ${presetPath}`);

  // Warn about custom elements
  if (recipe.customElements && recipe.customElements.length > 0) {
    console.log(`\n  ⚠ Custom elements detected (may need a new template):`);
    recipe.customElements.forEach((el: string) => console.log(`    - ${el}`));
  }

  return preset;
}
