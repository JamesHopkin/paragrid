/**
 * Push operation implementation.
 */

import { Direction } from '../core/direction.js';
import type { Cell, GridStore } from '../core/types.js';
import { isEmpty, isRef } from '../core/types.js';
import type { CellPosition } from '../core/position.js';
import { Navigator } from '../navigator/navigator.js';
import { getCell } from '../utils/immutable.js';
import type { RuleSet } from './rules.js';
import { RefStrategyType } from './rules.js';
import type { PushFailure } from './failure.js';
import { applyPush } from './apply.js';
import type { TagFn } from '../tagging/types.js';

/**
 * How a position in the push chain was reached.
 * - 'enter': Entered a grid through a Ref cell
 * - 'exit': Exited from a nested grid to parent
 * - 'move': Moved within the same grid
 * - null: Initial position (or cycle back to start)
 */
export type TransitionType = 'enter' | 'exit' | 'move' | null;

/**
 * A single entry in a push chain, representing a cell position and its content
 * before the push operation.
 */
export interface PushChainEntry {
  readonly position: CellPosition;
  readonly cell: Cell;
  readonly transition: TransitionType;
  /**
   * For 'enter' transitions, indicates whether entry was via a non-primary (secondary) reference.
   * Undefined for other transition types.
   */
  readonly viaNonPrimaryReference?: boolean;
  // Future: Add more metadata fields for custom animations
  // readonly metadata?: { duration?: number; easing?: string; ... }
}

/**
 * The complete chain of positions and cells involved in a push operation.
 * Represents the full path traversed during a push, from start to end.
 */
export type PushChain = ReadonlyArray<PushChainEntry>;

/**
 * Result of a successful push operation.
 */
export interface PushResult {
  readonly store: GridStore;
  readonly chain: PushChain;
}

/**
 * Simple push operation without backtracking.
 *
 * The push operation moves cell contents forward along a path, with the contents
 * rotating when the push succeeds. Success occurs when:
 * 1. The path ends at an Empty cell, OR
 * 2. The path cycles back to the starting position
 *
 * When a push fails with the initial Ref handling strategy, the entire push fails.
 * This is the simpler algorithm without backtracking, using only the first applicable
 * strategy at each decision point.
 *
 * @param store - The grid store containing all grids
 * @param start - Starting position for the push
 * @param direction - Direction to push
 * @param rules - RuleSet governing Ref handling behavior
 * @param tagFn - Optional function to tag cells (e.g., for 'stop' tag)
 * @param maxDepth - Maximum traversal depth to prevent infinite loops
 * @returns PushResult with new GridStore and push chain if successful, PushFailure with reason if push fails
 */
export function pushSimple(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  rules: RuleSet,
  tagFn?: TagFn,
  maxDepth: number = 1000
): PushResult | PushFailure {
  // Check if starting cell has stop tag - stop-tagged cells cannot be pushed
  const startCell = getCell(store, start);
  if (tagFn && tagFn(startCell).has('stop')) {
    return {
      reason: 'STOP_TAG',
      position: start,
      details: 'Cannot push from stop-tagged cell',
    };
  }

  // Initialize navigator
  const nav = new Navigator(store, start, direction);
  const path: Array<[CellPosition, TransitionType, boolean?]> = [[start, null, undefined]];
  const visited = new Set<string>([`${start.gridId},${start.row},${start.col}`]);
  let depth = 0;

  // Try to advance to first position
  if (!nav.tryAdvance()) {
    return {
      reason: 'BLOCKED',
      position: start,
      details: 'Cannot advance from start position (hit edge)',
    };
  }
  // Get the transition type and enter metadata from the navigator
  let currentTransition: TransitionType = nav.getLastTransition();
  let currentViaNonPrimary: boolean | undefined =
    currentTransition === 'enter' ? (nav.getLastEnterViaNonPrimary() ?? undefined) : undefined;

  while (depth < maxDepth) {
    depth++;

    // Get current cell
    const currentCell = getCell(store, nav.current);

    // Check for empty (success)
    if (isEmpty(currentCell)) {
      path.push([nav.current, currentTransition, currentViaNonPrimary]);
      // Build final path with cells for applyPush
      const finalPath: Array<readonly [CellPosition, Cell, TransitionType, boolean?]> = path.map(
        ([pos, trans, viaNonPrimary]) => [pos, getCell(store, pos), trans, viaNonPrimary]
      );
      return applyPush(store, finalPath);
    }

    // Check for stop tag (failure)
    if (tagFn && tagFn(currentCell).has('stop')) {
      return {
        reason: 'STOP_TAG',
        position: nav.current,
        details: 'Encountered stop-tagged cell',
      };
    }

    // Check for cycle
    const currentKey = `${nav.current.gridId},${nav.current.row},${nav.current.col}`;
    if (visited.has(currentKey)) {
      // Cycle detected - check if cycling back to start (success) or elsewhere (failure)
      if (nav.current.equals(start)) {
        path.push([nav.current, currentTransition, currentViaNonPrimary]);
        // Build final path with cells for applyPush
        const finalPath: Array<readonly [CellPosition, Cell, TransitionType, boolean?]> = path.map(
          ([pos, trans, viaNonPrimary]) => [pos, getCell(store, pos), trans, viaNonPrimary]
        );
        return applyPush(store, finalPath);
      } else {
        return {
          reason: 'PATH_CYCLE',
          position: nav.current,
          details: 'Path cycled to non-start position',
        };
      }
    }

    visited.add(currentKey);

    // Get S (source) and T (target)
    const S_pos = path.length > 0 ? path[path.length - 1][0] : null;
    const S_cell = S_pos ? getCell(store, S_pos) : null;
    const T_cell = currentCell;

    // Determine first applicable strategy based on rules order
    let selectedStrategy: RefStrategyType | null = null;

    for (const stratType of rules.refStrategy) {
      if (stratType === RefStrategyType.SOLID) {
        // Check if we can advance (peek ahead)
        const testNav = nav.clone();
        if (testNav.tryAdvance()) {
          selectedStrategy = stratType;
          break;
        }
      } else if (stratType === RefStrategyType.PORTAL && isRef(T_cell)) {
        selectedStrategy = stratType;
        break;
      } else if (stratType === RefStrategyType.SWALLOW && S_cell && isRef(S_cell)) {
        selectedStrategy = stratType;
        break;
      }
    }

    if (!selectedStrategy) {
      return {
        reason: 'NO_STRATEGY',
        position: nav.current,
        details: 'No applicable strategy available',
      };
    }

    // Execute the selected strategy and get next transition from navigator
    if (selectedStrategy === RefStrategyType.SOLID) {
      path.push([nav.current, currentTransition, currentViaNonPrimary]);
      nav.advance();
      currentTransition = nav.getLastTransition();
      currentViaNonPrimary =
        currentTransition === 'enter' ? (nav.getLastEnterViaNonPrimary() ?? undefined) : undefined;
    } else if (selectedStrategy === RefStrategyType.PORTAL) {
      nav.enter(rules);
      currentTransition = nav.getLastTransition();
      currentViaNonPrimary =
        currentTransition === 'enter' ? (nav.getLastEnterViaNonPrimary() ?? undefined) : undefined;
    } else if (selectedStrategy === RefStrategyType.SWALLOW) {
      path.push([nav.current, currentTransition, currentViaNonPrimary]);
      // Swallow: S (last in path) swallows T (current)
      // Move T into S's referenced grid from opposite direction
      nav.flip();
      nav.advance();
      nav.enter(rules);
      currentTransition = nav.getLastTransition();
      currentViaNonPrimary =
        currentTransition === 'enter' ? (nav.getLastEnterViaNonPrimary() ?? undefined) : undefined;
    }
  }

  return {
    reason: 'MAX_DEPTH',
    position: nav.current,
    details: `Exceeded maximum depth of ${maxDepth}`,
  };
}

/**
 * State for backtracking in push operations.
 */
interface State {
  readonly path: Array<[CellPosition, TransitionType, boolean?]>;
  readonly nav: Navigator;
  readonly strategies: RefStrategyType[];
  readonly visited: Set<string>;
  readonly nextTransition: TransitionType;
  readonly nextViaNonPrimary?: boolean;
}

/**
 * Push cell contents along a path in the given direction (with backtracking).
 *
 * The push operation moves cell contents forward along a path, with the contents
 * rotating when the push succeeds. Success occurs when:
 * 1. The path ends at an Empty cell, OR
 * 2. The path cycles back to the starting position
 *
 * This implementation uses a Navigator abstraction and decision stack for backtracking.
 * When a strategy fails, it backtracks and tries alternative strategies.
 *
 * @param store - The grid store containing all grids
 * @param start - Starting position for the push
 * @param direction - Direction to push
 * @param rules - RuleSet governing Ref handling behavior
 * @param tagFn - Optional function to tag cells (e.g., for 'stop' tag)
 * @param maxDepth - Maximum traversal depth to prevent infinite loops
 * @param maxBacktrackDepth - Maximum number of backtracking attempts
 * @returns PushResult with new GridStore and push chain if successful, PushFailure with reason if push fails
 */
export function push(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  rules: RuleSet,
  tagFn?: TagFn,
  maxDepth: number = 1000,
  maxBacktrackDepth: number = 10
): PushResult | PushFailure {
  /**
   * Create new state or return termination status.
   *
   * @returns 'succeed' if push succeeds, PushFailure if it fails, or a new State to continue processing
   */
  function makeNewState(
    path: Array<[CellPosition, TransitionType, boolean?]>,
    nav: Navigator,
    visited: Set<string>,
    nextTransition: TransitionType,
    nextViaNonPrimary?: boolean
  ): 'succeed' | PushFailure | State {
    // Check for empty (success)
    const currentCell = getCell(store, nav.current);
    if (isEmpty(currentCell)) {
      return 'succeed';
    }

    // Check for stop tag (failure)
    if (tagFn && tagFn(currentCell).has('stop')) {
      return {
        reason: 'STOP_TAG',
        position: nav.current,
        details: 'Encountered stop-tagged cell',
      };
    }

    // Check for cycle
    const currentKey = `${nav.current.gridId},${nav.current.row},${nav.current.col}`;
    if (visited.has(currentKey)) {
      // Cycle detected - check if cycling back to start (success) or elsewhere (failure)
      if (path.length > 0 && nav.current.equals(start)) {
        return 'succeed'; // Cycled to start
      } else {
        return {
          reason: 'PATH_CYCLE',
          position: nav.current,
          details: 'Path cycled to non-start position',
        };
      }
    }

    // Add current position to visited set for this state
    const newVisited = new Set(visited);
    newVisited.add(currentKey);

    // Compute applicable strategies
    const strategies: RefStrategyType[] = [];

    // Get S (source) and T (target)
    const S_pos = path.length > 0 ? path[path.length - 1][0] : null;
    const S_cell = S_pos ? getCell(store, S_pos) : null;
    const T_cell = currentCell;

    // Determine available strategies based on rules order
    for (const stratType of rules.refStrategy) {
      if (stratType === RefStrategyType.SOLID) {
        // Check if we can advance (peek ahead)
        const testNav = nav.clone();
        if (testNav.tryAdvance()) {
          strategies.push(stratType); // Only if nav can advance
        }
      } else if (stratType === RefStrategyType.PORTAL && isRef(T_cell)) {
        strategies.push(stratType); // Only if T is Ref
      } else if (stratType === RefStrategyType.SWALLOW && S_cell && isRef(S_cell)) {
        strategies.push(stratType); // Only if S is Ref
      }
    }

    if (strategies.length === 0) {
      return {
        reason: 'NO_STRATEGY',
        position: nav.current,
        details: 'No applicable strategy available',
      };
    }

    return {
      path,
      nav,
      strategies,
      visited: newVisited,
      nextTransition,
      nextViaNonPrimary,
    };
  }

  // Check if starting cell has stop tag - stop-tagged cells cannot be pushed
  const startCell = getCell(store, start);
  if (tagFn && tagFn(startCell).has('stop')) {
    return {
      reason: 'STOP_TAG',
      position: start,
      details: 'Cannot push from stop-tagged cell',
    };
  }

  // Initialize navigator
  const nav = new Navigator(store, start, direction);

  // Initialize with start cell in visited set
  const initialVisited = new Set<string>([`${start.gridId},${start.row},${start.col}`]);

  // Try to advance to first position
  if (!nav.tryAdvance()) {
    return {
      reason: 'BLOCKED',
      position: start,
      details: 'Cannot advance from start position (hit edge)',
    };
  }
  const firstTransition: TransitionType = nav.getLastTransition();
  const firstViaNonPrimary: boolean | undefined =
    firstTransition === 'enter' ? (nav.getLastEnterViaNonPrimary() ?? undefined) : undefined;

  // Create initial state
  const initialState = makeNewState([[start, null, undefined]], nav, initialVisited, firstTransition, firstViaNonPrimary);
  if (typeof initialState === 'object' && 'reason' in initialState) {
    return initialState; // Failed immediately
  }
  if (initialState === 'succeed') {
    // Immediate success - pushed directly into empty
    const finalPath: Array<readonly [CellPosition, Cell, TransitionType, boolean?]> = [
      [start, getCell(store, start), null, undefined],
      [nav.current, getCell(store, nav.current), firstTransition, firstViaNonPrimary],
    ];
    return applyPush(store, finalPath);
  }

  const decisionStack: State[] = [initialState];
  let lastFailure: PushFailure | undefined;
  let backtrackCount = maxBacktrackDepth;

  while (decisionStack.length > 0 && backtrackCount > 0) {
    const state = decisionStack[decisionStack.length - 1];

    if (state.strategies.length === 0) {
      decisionStack.pop();
      backtrackCount--;
      continue;
    }

    // Clone navigator for this attempt
    const navClone = state.nav.clone();

    // Handle remaining cases by strategy
    const strategy = state.strategies.shift()!;

    const newPath = [...state.path];
    let nextTransition: TransitionType;
    let nextViaNonPrimary: boolean | undefined;

    if (strategy === RefStrategyType.SOLID) {
      newPath.push([navClone.current, state.nextTransition, state.nextViaNonPrimary]);
      navClone.advance();
      nextTransition = navClone.getLastTransition();
      nextViaNonPrimary =
        nextTransition === 'enter' ? (navClone.getLastEnterViaNonPrimary() ?? undefined) : undefined;
    } else if (strategy === RefStrategyType.PORTAL) {
      navClone.enter(rules);
      nextTransition = navClone.getLastTransition();
      nextViaNonPrimary =
        nextTransition === 'enter' ? (navClone.getLastEnterViaNonPrimary() ?? undefined) : undefined;
    } else if (strategy === RefStrategyType.SWALLOW) {
      newPath.push([navClone.current, state.nextTransition, state.nextViaNonPrimary]);
      // Swallow: S (last in path) swallows T (current)
      // Move T into S's referenced grid from opposite direction
      navClone.flip();
      navClone.advance();
      navClone.enter(rules);
      nextTransition = navClone.getLastTransition();
      nextViaNonPrimary =
        nextTransition === 'enter' ? (navClone.getLastEnterViaNonPrimary() ?? undefined) : undefined;
    } else {
      throw new Error(`Unknown strategy: ${strategy}`);
    }

    const newState = makeNewState(newPath, navClone, state.visited, nextTransition, nextViaNonPrimary);

    if (newState === 'succeed') {
      // Build final path with cells for applyPush
      const pathWithCells: Array<readonly [CellPosition, Cell, TransitionType, boolean?]> = newPath.map(
        ([pos, trans, viaNonPrimary]) => [pos, getCell(store, pos), trans, viaNonPrimary]
      );
      pathWithCells.push([navClone.current, getCell(store, navClone.current), nextTransition, nextViaNonPrimary]);
      return applyPush(store, pathWithCells);
    } else if (typeof newState === 'object' && 'reason' in newState) {
      // Store failure for potential return if all strategies exhausted
      lastFailure = newState;
      continue; // Try next strategy
    } else {
      // New state - add to stack
      decisionStack.push(newState);
    }
  }

  // All strategies exhausted
  if (lastFailure) {
    return lastFailure;
  }
  return {
    reason: 'NO_STRATEGY',
    position: start,
    details: 'All backtracking attempts exhausted',
  };
}

/**
 * Detect if a push chain contains a grid transition (enter or exit).
 * Useful for camera controllers to determine how to update the view.
 *
 * @param chain - Push chain to analyze
 * @param oldGridId - Grid ID before the push
 * @param newGridId - Grid ID after the push
 * @returns Transition info if a grid change occurred, null otherwise
 */
export function detectGridTransition(
  chain: PushChain,
  oldGridId: string,
  newGridId: string
): { type: 'enter' | 'exit'; refGridId: string } | null {
  // Check if grid changed
  if (oldGridId === newGridId) return null;

  // Scan chain for 'enter' or 'exit' transition
  for (const entry of chain) {
    if (entry.transition === 'enter') {
      return { type: 'enter', refGridId: entry.position.gridId };
    }
    if (entry.transition === 'exit') {
      return { type: 'exit', refGridId: oldGridId };
    }
  }
  return null;
}
