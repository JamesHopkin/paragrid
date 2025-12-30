/**
 * Utilities for working with immutable grid data.
 */

import { Cell, Grid, GridStore, isRef } from '../core/types.js';
import type { CellPosition } from '../core/position.js';

/**
 * Get the cell at a given position in the grid store.
 *
 * @param store - The grid store containing all grids
 * @param pos - The position to look up
 * @returns The cell at the given position
 * @throws Error if grid or position doesn't exist
 */
export function getCellAtPosition(store: GridStore, pos: CellPosition): Cell {
  const grid = store[pos.gridId];
  if (!grid) {
    throw new Error(`Grid not found: ${pos.gridId}`);
  }
  if (pos.row < 0 || pos.row >= grid.rows || pos.col < 0 || pos.col >= grid.cols) {
    throw new Error(`Position out of bounds: ${pos}`);
  }
  return grid.cells[pos.row][pos.col];
}

/**
 * Find the primary reference to a grid.
 * First looks for explicitly marked primary (isPrimary=true), then falls back to first ref found.
 *
 * @param store - The grid store to search
 * @param targetGridId - The grid ID to find references to
 * @returns Tuple of [parentGridId, row, col] or undefined if not found
 */
export function findPrimaryRef(
  store: GridStore,
  targetGridId: string
): [string, number, number] | undefined {
  // First pass: look for explicitly marked primary
  for (const grid of Object.values(store)) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        if (isRef(cell) && cell.gridId === targetGridId && cell.isPrimary === true) {
          return [grid.id, r, c];
        }
      }
    }
  }

  // Second pass: fall back to first ref found
  for (const grid of Object.values(store)) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        if (isRef(cell) && cell.gridId === targetGridId) {
          return [grid.id, r, c];
        }
      }
    }
  }

  return undefined;
}
