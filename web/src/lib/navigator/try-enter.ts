/**
 * Determine entry point when entering a grid via a Ref.
 */

import { Direction } from '../core/direction.js';
import { CellPosition } from '../core/position.js';
import type { GridStore } from '../core/types.js';
import type { RuleSet } from '../operations/rules.js';
import { findPrimaryRef } from '../utils/immutable.js';
import {
  computeExitAncestorFraction,
  computeEntryFromAncestorFraction,
} from './ancestor-entry.js';

/**
 * Options for ancestor-based entry.
 */
export interface AncestorBasedEntryOptions {
  /** Grid we exited from (for ancestor mapping) */
  exitGridId?: string;
  /** (row, col) when last exit occurred */
  exitPosition?: [number, number];
  /** Common ancestor grid ID (typically the Ref's parent grid) */
  ancestorGridId?: string;
}

/**
 * Determine entry point when entering a grid via a Ref.
 *
 * Entry Strategy:
 * - If exitGridId and exitPosition are available:
 *   Use ancestor-based mapping to preserve positional continuity
 * - Otherwise: Use standard middle-of-edge entry
 *
 * Standard Entry Convention:
 * - East (from left): (rows // 2, 0) — middle of left edge
 * - West (from right): (rows // 2, cols - 1) — middle of right edge
 * - South (from top): (0, cols // 2) — middle of top edge
 * - North (from bottom): (rows - 1, cols // 2) — middle of bottom edge
 *
 * @param store - The grid store containing all grids
 * @param gridId - ID of the grid to enter
 * @param direction - Direction of entry
 * @param rules - RuleSet governing entry behavior (currently unused)
 * @param options - Optional ancestor-based entry parameters
 * @returns CellPosition for entry point, or undefined to deny entry
 */
export function tryEnter(
  store: GridStore,
  gridId: string,
  direction: Direction,
  rules: RuleSet,
  options?: AncestorBasedEntryOptions
): CellPosition | undefined {
  // Get the target grid
  const grid = store[gridId];
  if (!grid) {
    return undefined;
  }

  const rows = grid.rows;
  const cols = grid.cols;

  // Check if we should use ancestor-based entry mapping
  const useAncestorMapping =
    options?.exitGridId !== undefined &&
    options?.exitPosition !== undefined &&
    options?.ancestorGridId !== undefined;

  if (useAncestorMapping) {
    const { exitGridId, exitPosition, ancestorGridId } = options!;

    // Determine dimension based on direction
    // E/W movement: position varies along N-S axis (rows)
    // N/S movement: position varies along E-W axis (cols)
    const dimensionAttr = direction === Direction.E || direction === Direction.W ? 'rows' : 'cols';
    const exitIndex = dimensionAttr === 'rows' ? exitPosition![0] : exitPosition![1];

    // Map exit position up to ancestor
    const [exitFraction] = computeExitAncestorFraction(
      store,
      findPrimaryRef,
      exitGridId!,
      exitIndex,
      dimensionAttr,
      ancestorGridId
    );

    // Map down from ancestor to target grid
    const entryIndex = computeEntryFromAncestorFraction(
      store,
      findPrimaryRef,
      gridId,
      exitFraction,
      dimensionAttr,
      ancestorGridId
    );

    // Construct entry position based on direction
    let entryRow: number;
    let entryCol: number;

    switch (direction) {
      case Direction.E:
        // Entering from left edge (col=0)
        entryRow = entryIndex;
        entryCol = 0;
        break;

      case Direction.W:
        // Entering from right edge (col=cols-1)
        entryRow = entryIndex;
        entryCol = cols - 1;
        break;

      case Direction.S:
        // Entering from top edge (row=0)
        entryRow = 0;
        entryCol = entryIndex;
        break;

      case Direction.N:
        // Entering from bottom edge (row=rows-1)
        entryRow = rows - 1;
        entryCol = entryIndex;
        break;

      default:
        return undefined;
    }

    return new CellPosition(gridId, entryRow, entryCol);
  }

  // Standard middle-of-edge entry
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
