/**
 * Find cells with specific tags in the grid store.
 */

import type { GridStore } from '../core/types.js';
import { CellPosition } from '../core/position.js';
import type { TagFn } from './types.js';

/**
 * Find the first cell with a specific tag across all grids in the store.
 *
 * Iterates through all grids and cells, applying tag_fn to find the first
 * cell that contains the specified tag.
 *
 * @param store - The grid store to search
 * @param tag - The tag to search for (e.g., "player", "stop")
 * @param tagFn - Function that returns set of tags for a cell
 * @returns CellPosition of first tagged cell, or undefined if not found
 */
export function findTaggedCell(
  store: GridStore,
  tag: string,
  tagFn: TagFn
): CellPosition | undefined {
  for (const grid of Object.values(store)) {
    for (let rowIdx = 0; rowIdx < grid.cells.length; rowIdx++) {
      const row = grid.cells[rowIdx];
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const cell = row[colIdx];
        const tags = tagFn(cell);
        if (tags.has(tag)) {
          return new CellPosition(store, grid.id, rowIdx, colIdx);
        }
      }
    }
  }
  return undefined;
}
