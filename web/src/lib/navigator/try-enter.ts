/**
 * Determine entry point when entering a grid via a Ref.
 */

import { Direction } from '../core/direction.js';
import { CellPosition } from '../core/position.js';
import type { GridStore } from '../core/types.js';
import type { RuleSet } from '../operations/rules.js';

/**
 * Determine entry point when entering a grid via a Ref.
 *
 * Entry Convention:
 * - East (from left): (rows // 2, 0) — middle of left edge
 * - West (from right): (rows // 2, cols - 1) — middle of right edge
 * - South (from top): (0, cols // 2) — middle of top edge
 * - North (from bottom): (rows - 1, cols // 2) — middle of bottom edge
 *
 * @param store - The grid store containing all grids
 * @param gridId - ID of the grid to enter
 * @param direction - Direction of entry
 * @param rules - RuleSet governing entry behavior (currently unused)
 * @returns CellPosition for entry point, or undefined to deny entry
 */
export function tryEnter(
  store: GridStore,
  gridId: string,
  direction: Direction,
  rules: RuleSet
): CellPosition | undefined {
  // Get the target grid
  const grid = store[gridId];
  if (!grid) {
    return undefined;
  }

  const rows = grid.rows;
  const cols = grid.cols;

  // Calculate middle-of-edge entry point based on direction
  switch (direction) {
    case Direction.E:
      // Entering from left edge
      return new CellPosition(gridId, Math.floor(rows / 2), 0);

    case Direction.W:
      // Entering from right edge
      return new CellPosition(gridId, Math.floor(rows / 2), cols - 1);

    case Direction.S:
      // Entering from top edge
      return new CellPosition(gridId, 0, Math.floor(cols / 2));

    case Direction.N:
      // Entering from bottom edge
      return new CellPosition(gridId, rows - 1, Math.floor(cols / 2));

    default:
      // Unknown direction
      return undefined;
  }
}
