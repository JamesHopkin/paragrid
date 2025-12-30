/**
 * Apply push and pull operations by rotating cell contents.
 */

import type { Cell, GridStore } from '../core/types.js';
import type { CellPosition } from '../core/position.js';

/**
 * Apply a push operation by rotating cell contents along the path.
 *
 * Rotates cells forward: the last cell's content moves to the first position,
 * and all other cells shift forward by one position.
 *
 * Example: [A, B, C] -> [C, A, B]
 *
 * @param store - The grid store containing all grids
 * @param path - List of [position, original_cell] tuples representing the push path
 * @returns New GridStore with updated grids (original store unchanged)
 */
export function applyPush(
  store: GridStore,
  path: ReadonlyArray<readonly [CellPosition, Cell]>
): GridStore {
  if (path.length === 0) {
    return store;
  }

  // Extract cells and rotate: [c1, c2, c3] -> [c3, c1, c2]
  const cells = path.map(([_, cell]) => cell);
  const rotated = [cells[cells.length - 1], ...cells.slice(0, -1)];

  // Group updates by grid_id: grid_id -> list of [row, col, new_cell]
  const updates = new Map<string, Array<[number, number, Cell]>>();

  for (let i = 0; i < path.length; i++) {
    const [pos, _] = path[i];
    const newCell = rotated[i];

    if (!updates.has(pos.gridId)) {
      updates.set(pos.gridId, []);
    }
    updates.get(pos.gridId)!.push([pos.row, pos.col, newCell]);
  }

  // Reconstruct affected grids immutably
  let newStore = { ...store };

  for (const [gridId, gridUpdates] of updates.entries()) {
    const grid = store[gridId];
    if (!grid) {
      throw new Error(`Grid not found: ${gridId}`);
    }

    // Convert to mutable structure
    const mutableCells = grid.cells.map(row => [...row]);

    // Apply all updates for this grid
    for (const [row, col, newCell] of gridUpdates) {
      mutableCells[row][col] = newCell;
    }

    // Convert back to immutable and update store
    newStore = {
      ...newStore,
      [gridId]: {
        id: grid.id,
        cells: mutableCells,
        rows: grid.rows,
        cols: grid.cols,
      },
    };
  }

  return newStore;
}

/**
 * Apply a pull operation by rotating cell contents along the path.
 *
 * Rotates cells backward: the first cell's content moves to the last position,
 * and all other cells shift backward by one position.
 *
 * Example: [A, B, C] -> [B, C, A]
 *
 * @param store - The grid store containing all grids
 * @param path - List of [position, original_cell] tuples representing the pull path
 * @returns New GridStore with updated grids (original store unchanged)
 */
export function applyPull(
  store: GridStore,
  path: ReadonlyArray<readonly [CellPosition, Cell]>
): GridStore {
  if (path.length === 0) {
    return store;
  }

  // Extract cells and rotate: [c1, c2, c3] -> [c2, c3, c1]
  const cells = path.map(([_, cell]) => cell);
  const rotated = [...cells.slice(1), cells[0]];

  // Group updates by grid_id: grid_id -> list of [row, col, new_cell]
  const updates = new Map<string, Array<[number, number, Cell]>>();

  for (let i = 0; i < path.length; i++) {
    const [pos, _] = path[i];
    const newCell = rotated[i];

    if (!updates.has(pos.gridId)) {
      updates.set(pos.gridId, []);
    }
    updates.get(pos.gridId)!.push([pos.row, pos.col, newCell]);
  }

  // Reconstruct affected grids immutably
  let newStore = { ...store };

  for (const [gridId, gridUpdates] of updates.entries()) {
    const grid = store[gridId];
    if (!grid) {
      throw new Error(`Grid not found: ${gridId}`);
    }

    // Convert to mutable structure
    const mutableCells = grid.cells.map(row => [...row]);

    // Apply all updates for this grid
    for (const [row, col, newCell] of gridUpdates) {
      mutableCells[row][col] = newCell;
    }

    // Convert back to immutable and update store
    newStore = {
      ...newStore,
      [gridId]: {
        id: grid.id,
        cells: mutableCells,
        rows: grid.rows,
        cols: grid.cols,
      },
    };
  }

  return newStore;
}
