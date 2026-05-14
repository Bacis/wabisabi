// Layout-strategy registry. Day 1 establishes the lookup; Day 2 points
// ReelClone at it via `getLayoutStrategy(id).computeLayout(...)`.
//
// Today only cascade-stack is renderer-wired. Days 3-4 add single-line-flow
// and bottom-anchor; subsequent days fill out the rest as DirectorScript
// roles need them. Strategies that aren't yet wired fall through to
// cascade-stack with a console warning so the renderer never crashes on
// a forward-compat-only id from the agent.

import {
  layoutCascadeStack,
  type CascadeStackInput,
  type CascadeStackParams,
} from './cascadeStack';
import { singleLineFlowStrategy } from './singleLineFlow';
import { bottomAnchorStrategy } from './bottomAnchor';
import {
  LAYOUT_STRATEGY_IDS,
  type LayoutPlan,
  type LayoutStrategy,
  type LayoutStrategyId,
  type StrategyInput,
} from './types';

// ---------------------------------------------------------------------------
// cascade-stack adapter — wraps the existing pure function in the uniform
// strategy shape. `frameWidth` on StrategyInput is unused here (cascade
// reads only frameHeight and usableWidth); we drop it back to CascadeStackInput.

const cascadeStackStrategy: LayoutStrategy = {
  id: 'cascade-stack',
  computeLayout(input: StrategyInput, params: unknown): LayoutPlan {
    const cascadeInput: CascadeStackInput = {
      chunk: input.chunk,
      effectiveEmphasis: input.effectiveEmphasis,
      baseSize: input.baseSize,
      frameHeight: input.frameHeight,
      usableWidth: input.usableWidth,
      charAdvance: input.charAdvance,
      maxSizeForWord: input.maxSizeForWord,
    };
    return layoutCascadeStack(cascadeInput, params as CascadeStackParams);
  },
};

// ---------------------------------------------------------------------------
// Registry. Days 3-4 push singleLineFlowStrategy and bottomAnchorStrategy
// onto this map. Unregistered ids fall through to cascade-stack.

const REGISTRY: Partial<Record<LayoutStrategyId, LayoutStrategy>> = {
  'cascade-stack': cascadeStackStrategy,
  'single-line-flow': singleLineFlowStrategy,
  // The spec calls this strategy "bottom-anchor" conceptually; the agent-side
  // stylepack schema uses 'lower-third' for the same closed-set id.
  'lower-third': bottomAnchorStrategy,
};

export function registerLayoutStrategy(strategy: LayoutStrategy): void {
  REGISTRY[strategy.id] = strategy;
}

export function getLayoutStrategy(id: LayoutStrategyId): LayoutStrategy {
  const found = REGISTRY[id];
  if (found) return found;
  // Forward-compat: the agent already emits ids like 'karaoke-row' that
  // the renderer hasn't implemented yet. Fall back to cascade-stack so the
  // render still ships; the agent's tool layer is responsible for steering
  // away from unimplemented strategies until they're in this registry.
  if (typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.warn(
      `[layout/registry] strategy "${id}" not implemented; falling back to cascade-stack`,
    );
  }
  return cascadeStackStrategy;
}

export function listRegisteredStrategies(): LayoutStrategyId[] {
  return LAYOUT_STRATEGY_IDS.filter((id) => REGISTRY[id] !== undefined);
}
