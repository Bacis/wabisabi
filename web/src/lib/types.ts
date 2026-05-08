// Form descriptor types. A TemplateDescriptor declares what additional
// (template-specific) controls the editor should render alongside the
// auto-generated common-fields form. Each Control binds a path into the
// styleSpec object to a concrete UI input.

export type ControlBase = {
  path: string;            // dot-path into styleSpec, e.g. "reel.heroFillRatio"
  label: string;
  description?: string;    // optional help text shown under the control
};

export type ColorControl = ControlBase & {
  kind: 'color';
  default?: string;
  alpha?: boolean;         // expose alpha channel
};

// Linear gradient fill — matches the shape in src/shared/styleSpec.ts so it
// round-trips through the API and into the ReelClone template's CSS
// background-clip: text path.
export type GradientFill = {
  type: 'linear';
  angle: number;
  stops: Array<{ pos: number; color: string }>;
};

// Either a solid color (with optional alpha) or a gradient. The FillControl
// edits both shapes and stores the active one at the styleSpec path.
export type FillValue = string | GradientFill;

export type FillControl = ControlBase & {
  kind: 'fill';
  default?: FillValue;
  alpha?: boolean;
};

export type ColorListControl = ControlBase & {
  kind: 'colorList';
  default?: string[];
  minColors?: number;
  maxColors?: number;
};

export type SliderControl = ControlBase & {
  kind: 'slider';
  min: number;
  max: number;
  step?: number;
  default?: number;
  unit?: string;
};

export type NumberControl = ControlBase & {
  kind: 'number';
  min?: number;
  max?: number;
  step?: number;
  default?: number;
};

export type SelectControl = ControlBase & {
  kind: 'select';
  options: ReadonlyArray<{ value: string; label?: string }>;
  default?: string;
};

export type MultiSelectControl = ControlBase & {
  kind: 'multiSelect';
  options: ReadonlyArray<{ value: string; label?: string }>;
  default?: string[];
};

export type SwitchControl = ControlBase & {
  kind: 'switch';
  default?: boolean;
};

export type TextControl = ControlBase & {
  kind: 'text';
  default?: string;
  placeholder?: string;
};

export type FontFamilyControl = ControlBase & {
  kind: 'fontFamily';
  default?: string;
};

// Bundled vibe — applies multiple styleSpec patches as a single click.
// Used by the Reel-clone "Theme presets" row at the top of the form.
// Themes don't bind to a single dotPath; the picker calls a parent-supplied
// onApplyTheme callback with the patch object instead of update(path,value).
export type Theme = {
  id: string;
  name: string;
  description?: string;
  swatch: string[];           // 4–5 hex colors for the card preview dots
  patch: Record<string, any>; // partial styleSpec; deep-merged into current
  displayFont?: string;       // optional font-family for the card name
};

export type ThemePickerControl = ControlBase & {
  kind: 'themePicker';
  themes: Theme[];
};

export type Control =
  | ColorControl
  | ColorListControl
  | FillControl
  | SliderControl
  | NumberControl
  | SelectControl
  | MultiSelectControl
  | SwitchControl
  | TextControl
  | FontFamilyControl
  | ThemePickerControl;

export type ControlGroup = {
  id: string;
  label: string;
  description?: string;
  controls: Control[];
};

export type TemplateDescriptor = {
  templateId: string;
  groups: ControlGroup[];
  // Controls in COMMON_GROUPS whose path matches an entry here are hidden
  // from the form for this template. Use it for fields the template
  // ignores at runtime (e.g. animation.preset on templates that hardcode
  // their animation, color.stroke when the template draws no outline).
  // Without this, the form happily shows knobs that do nothing — confusing.
  excludeCommonPaths?: string[];
};
