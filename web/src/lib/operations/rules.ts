/**
 * Strategy system for handling Ref cells during operations.
 */

/**
 * Individual strategy types for handling Ref cells.
 */
export enum RefStrategyType {
  PORTAL = 'portal',   // Try to enter the Ref (traverse through it)
  SOLID = 'solid',     // Treat the Ref as a solid object (push it)
  SWALLOW = 'swallow', // Swallow the target cell (only when start is Ref)
}

/**
 * Ordered list of strategies to try.
 */
export type RefStrategyOrder = ReadonlyArray<RefStrategyType>;

/**
 * Common Ref handling strategy orderings.
 */
export class RefStrategy {
  /**
   * Default: try solid (push), then portal (enter), then swallow.
   */
  static readonly DEFAULT: RefStrategyOrder = Object.freeze([
    RefStrategyType.SOLID,
    RefStrategyType.PORTAL,
    RefStrategyType.SWALLOW,
  ]);

  /**
   * Legacy compatibility: try portal first.
   */
  static readonly TRY_ENTER_FIRST: RefStrategyOrder = Object.freeze([
    RefStrategyType.PORTAL,
    RefStrategyType.SOLID,
    RefStrategyType.SWALLOW,
  ]);

  /**
   * Alias for DEFAULT.
   */
  static readonly PUSH_FIRST: RefStrategyOrder = Object.freeze([
    RefStrategyType.SOLID,
    RefStrategyType.PORTAL,
    RefStrategyType.SWALLOW,
  ]);

  /**
   * Swallow-first strategy.
   */
  static readonly SWALLOW_FIRST: RefStrategyOrder = Object.freeze([
    RefStrategyType.SWALLOW,
    RefStrategyType.PORTAL,
    RefStrategyType.SOLID,
  ]);
}

/**
 * Rules governing operation behavior.
 */
export interface RuleSet {
  readonly refStrategy: RefStrategyOrder;
}

/**
 * Create a RuleSet with default settings.
 */
export function createRuleSet(
  refStrategy: RefStrategyOrder = RefStrategy.DEFAULT
): RuleSet {
  return Object.freeze({ refStrategy });
}
