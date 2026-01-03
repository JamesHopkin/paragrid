/**
 * Compute transformation for exit preview rendering.
 */

import { Direction } from '../core/direction.js';
import { CellPosition } from '../core/position.js';
import type { GridStore } from '../core/types.js';
import { Navigator } from './navigator.js';
import { findPrimaryRef } from '../utils/immutable.js';
import type { RuleSet } from '../operations/rules.js';

/**
 * Result of exit transformation calculation.
 */
export interface ExitTransformation {
  /** ID of the grid we exit into */
  targetGridId: string;
  /** Position in target grid where we land */
  exitPosition: CellPosition;
  /** Scale factor: how many current-grid cells fit in one target-grid cell */
  scale: number;
  /** Position of current grid's reference cell in target grid (where current lives) */
  currentRefPosition: { row: number; col: number } | null;
}

/**
 * Compute the transformation for rendering an exit preview.
 *
 * @param store - The grid store
 * @param currentGridId - The grid currently being rendered (at scale 1.0)
 * @param direction - Direction to check for exit
 * @param position - Position to check exit from (typically on the edge)
 * @param rules - Rules for navigation
 * @returns Exit transformation or undefined if no exit possible
 */
export function computeExitTransformation(
  store: GridStore,
  currentGridId: string,
  direction: Direction,
  position: CellPosition,
  rules: RuleSet
): ExitTransformation | undefined {
  // Try to navigate in the given direction
  const nav = new Navigator(store, position, direction);
  const canExit = nav.tryAdvance();

  if (!canExit) {
    return undefined; // No exit possible
  }

  const targetGridId = nav.current.gridId;
  const exitPosition = nav.current;

  // Find where current grid lives in a parent grid
  // Note: Even if we exited to the same grid ID (self-reference), if we have a primary ref,
  // then we're inside a reference cell and should show the exit preview
  const primaryRef = findPrimaryRef(store, currentGridId);

  if (!primaryRef) {
    // Current is root - no parent to exit to
    return undefined;
  }

  const [immediateParentGridId, refRow, refCol] = primaryRef;

  // For position calculation to work, currentRefPosition must be in the same
  // coordinate system as exitPosition (the target grid).
  // With exit chains, we need to find where the immediate parent lives in the target.
  let currentRefPosition: { row: number; col: number };

  if (targetGridId === immediateParentGridId) {
    // Simple case: exited to immediate parent
    // Current grid's ref position is already in the target grid
    currentRefPosition = { row: refRow, col: refCol };
  } else {
    // Exit chain: target is an ancestor of immediate parent
    // Find where immediate parent lives in target grid
    const parentPos = findPositionInAncestor(store, immediateParentGridId, targetGridId);
    if (!parentPos) {
      return undefined; // Shouldn't happen, but safety check
    }
    currentRefPosition = parentPos;
  }

  // Compute scale: how many current-grid cells fit in one parent-grid cell
  const currentGrid = store[currentGridId];

  // The current grid's entire width (currentGrid.cols cells) fits into 1 cell of parent
  // So one parent cell = currentGrid.cols in current's coordinate system
  const scale = Math.max(currentGrid.cols, currentGrid.rows); // Use max dimension for uniform scaling

  return {
    targetGridId,
    exitPosition,
    scale,
    currentRefPosition
  };
}

/**
 * Find where childGridId lives in ancestorGridId by walking up the parent chain.
 * Returns null if childGridId is not nested in ancestorGridId.
 */
function findPositionInAncestor(
  store: GridStore,
  childGridId: string,
  ancestorGridId: string
): { row: number; col: number } | null {
  if (childGridId === ancestorGridId) {
    return null; // Can't find position of grid in itself
  }

  let gridId = childGridId;

  while (gridId !== ancestorGridId) {
    const primaryRef = findPrimaryRef(store, gridId);
    if (!primaryRef) {
      return null; // Hit root without finding ancestor
    }

    const [parentGridId, row, col] = primaryRef;

    if (parentGridId === ancestorGridId) {
      // Found it!
      return { row, col };
    }

    gridId = parentGridId;
  }

  return null; // Shouldn't reach here
}

/**
 * Find a position on the specified edge of a grid.
 * Returns the middle cell of that edge.
 */
export function getEdgePosition(
  store: GridStore,
  gridId: string,
  direction: Direction
): CellPosition | undefined {
  const grid = store[gridId];
  if (!grid) return undefined;

  switch (direction) {
    case Direction.N:
      return new CellPosition(gridId, 0, Math.floor(grid.cols / 2));
    case Direction.S:
      return new CellPosition(gridId, grid.rows - 1, Math.floor(grid.cols / 2));
    case Direction.E:
      return new CellPosition(gridId, Math.floor(grid.rows / 2), grid.cols - 1);
    case Direction.W:
      return new CellPosition(gridId, Math.floor(grid.rows / 2), 0);
  }
}
