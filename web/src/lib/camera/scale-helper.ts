/**
 * Scale Helper - Calculates scale and offset for view paths.
 *
 * Given a path through the grid hierarchy, computes the relative scale
 * and offset (center position) of the final grid in the path.
 *
 * Scale convention: A cell in path[0] has width 1.0
 */

import type { GridStore } from '../core/types.js';
import { getGrid, isRef } from '../core/types.js';

/**
 * Result of scale and offset calculation.
 */
export interface ScaleAndOffset {
  /** Center X position in the coordinate system where path[0] cells have width 1 */
  readonly centerX: number;
  /** Center Y position in the coordinate system where path[0] cells have height 1 */
  readonly centerY: number;
  /** Width of the final grid (cell in path[0] has width 1) */
  readonly width: number;
  /** Height of the final grid (cell in path[0] has height 1) */
  readonly height: number;
}

/**
 * Calculate scale and offset for a view path.
 *
 * The path must be valid (each grid must reference the next).
 * Path[0] is the root grid with cells of width/height 1.
 * Each subsequent grid is referenced by the previous grid.
 *
 * @param store - The grid store
 * @param path - Array of grid IDs, where path[i+1] is referenced by path[i]
 * @returns Scale and offset information, or null if path is invalid
 *
 * @example
 * ```typescript
 * // Simple case: just the root grid
 * const result = getScaleAndOffset(store, ['root']);
 * // result.width = cols, result.height = rows
 * // result.centerX = cols/2, result.centerY = rows/2
 *
 * // Nested case: root contains 'child' at position (1, 1)
 * // root is 3×3, child is 2×2
 * const nested = getScaleAndOffset(store, ['root', 'child']);
 * // Child cell has width=1/2 and height=1/2 (since child is 2×2)
 * // Child ref is at position (1,1) so center is at (1.5, 1.5) in root coords
 * // Child grid center is at (1.5, 1.5) + offset for child's internal center
 * ```
 */
export function getScaleAndOffset(
  store: GridStore,
  path: string[]
): ScaleAndOffset | null {
  if (path.length === 0) {
    return null;
  }

  // Start with the root grid (path[0])
  const rootGrid = getGrid(store, path[0]);
  if (!rootGrid) {
    return null;
  }

  // For a single grid, return its dimensions and center
  if (path.length === 1) {
    return {
      centerX: rootGrid.cols / 2,
      centerY: rootGrid.rows / 2,
      width: rootGrid.cols,
      height: rootGrid.rows,
    };
  }

  // Walk the path, accumulating scale and offset
  let currentWidth = rootGrid.cols;
  let currentHeight = rootGrid.rows;
  let centerX = rootGrid.cols / 2;
  let centerY = rootGrid.rows / 2;

  for (let i = 0; i < path.length - 1; i++) {
    const parentGridId = path[i];
    const childGridId = path[i + 1];

    // Find the reference cell in the parent
    const refPos = findRefPosition(store, parentGridId, childGridId);
    if (refPos === null) {
      return null; // Invalid path - child not referenced by parent
    }

    const [refRow, refCol] = refPos;
    const parentGrid = getGrid(store, parentGridId);
    const childGrid = getGrid(store, childGridId);

    if (!parentGrid || !childGrid) {
      return null;
    }

    // Calculate the cell dimensions in the parent grid
    const cellWidth = currentWidth / parentGrid.cols;
    const cellHeight = currentHeight / parentGrid.rows;

    // The child grid fills the reference cell
    const newWidth = cellWidth;
    const newHeight = cellHeight;

    // Calculate the center of the reference cell in local coords (where current grid starts at 0,0)
    // Cell (row, col) spans from (col*cellWidth, row*cellHeight) to ((col+1)*cellWidth, (row+1)*cellHeight)
    const refCellCenterX = cellWidth * refCol + cellWidth / 2;
    const refCellCenterY = cellHeight * refRow + cellHeight / 2;

    // Update for next iteration
    // The current grid actually starts at (centerX - currentWidth/2, centerY - currentHeight/2)
    // So convert local position to absolute position by adding the grid's top-left corner
    // This is equivalent to: centerX + (refCellCenterX - currentWidth/2)
    const newCenterX = centerX + (refCellCenterX - currentWidth / 2);
    const newCenterY = centerY + (refCellCenterY - currentHeight / 2);

    currentWidth = newWidth;
    currentHeight = newHeight;
    centerX = newCenterX;
    centerY = newCenterY;
  }

  return {
    centerX,
    centerY,
    width: currentWidth,
    height: currentHeight,
  };
}

/**
 * Find the position (row, col) of a reference to a target grid within a parent grid.
 * Returns the first occurrence in row-major order.
 *
 * @param store - The grid store
 * @param parentGridId - Grid to search in
 * @param targetGridId - Grid being referenced
 * @returns [row, col] position or null if not found
 */
function findRefPosition(
  store: GridStore,
  parentGridId: string,
  targetGridId: string
): [number, number] | null {
  const parentGrid = getGrid(store, parentGridId);
  if (!parentGrid) {
    return null;
  }

  for (let row = 0; row < parentGrid.rows; row++) {
    for (let col = 0; col < parentGrid.cols; col++) {
      const cell = parentGrid.cells[row][col];
      if (isRef(cell) && cell.gridId === targetGridId) {
        return [row, col];
      }
    }
  }

  return null;
}
