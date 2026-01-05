/**
 * Scale Helper - Calculates scale and offset for view paths.
 *
 * Given a path through the grid hierarchy, computes the relative scale
 * and offset (center position) of the final grid in the path.
 *
 * Scale convention: A cell in path[0] has width 1.0
 */

import type { GridStore } from '../core/types.js';
import { getGrid } from '../core/types.js';
import { findPrimaryRef } from '../utils/immutable.js';

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
  path: readonly string[]
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

    // Find the PRIMARY reference cell in the parent
    const primaryRef = findPrimaryRef(store, childGridId);
    if (!primaryRef) {
      return null; // Invalid path - child has no primary reference
    }

    const [actualParentId, refRow, refCol] = primaryRef;

    // Verify the primary reference is in the expected parent
    if (actualParentId !== parentGridId) {
      return null; // Invalid path - child's primary ref is not in the expected parent
    }
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
 * Get world coordinates for a cell in a specific view.
 *
 * World coordinates are in a space where:
 * - The root grid (path[0]) is centered at (0, 0)
 * - Cells in the root grid have width/height = 1
 *
 * @param store - Grid store
 * @param viewPath - Hierarchy path to the grid (e.g., ['main', 'inner'])
 * @param cellPosition - The cell position
 * @returns World coordinates { x, y, z } or null if invalid
 *
 * @example
 * ```typescript
 * // Get world position of cell at (1, 2) in the 'inner' grid
 * // when viewing ['main', 'inner']
 * const pos = getCellWorldPosition(store, ['main', 'inner'], new CellPosition('inner', 1, 2));
 * // pos.x, pos.z are in world space where main grid cells have size 1
 * ```
 */
export function getCellWorldPosition(
  store: GridStore,
  viewPath: readonly string[],
  cellPosition: import('../core/position.js').CellPosition
): { x: number; y: number; z: number } | null {
  if (viewPath.length === 0) {
    return null;
  }

  // Ensure the cell is in one of the grids in the view path
  if (!viewPath.includes(cellPosition.gridId)) {
    return null;
  }

  // Find which grid in the path contains this cell
  const gridIndex = viewPath.indexOf(cellPosition.gridId);
  const pathToGrid = viewPath.slice(0, gridIndex + 1);

  // Get grid's position and scale in the hierarchy
  const scaleResult = getScaleAndOffset(store, pathToGrid);
  if (!scaleResult) return null;

  const grid = getGrid(store, cellPosition.gridId);
  if (!grid) return null;

  // Calculate cell dimensions within this view
  const cellWidth = scaleResult.width / grid.cols;
  const cellHeight = scaleResult.height / grid.rows;

  // scaleResult gives us center in coordinate system where path[0] cells have width 1
  // We need to convert to world coordinates where path[0] is centered at (0, 0)
  const rootGrid = getGrid(store, viewPath[0]);
  if (!rootGrid) return null;

  // Calculate cell center in grid-local coordinates
  // Cell (row, col) center is at (col + 0.5, row + 0.5) in cell units
  const cellCenterLocalX = (cellPosition.col + 0.5) * cellWidth;
  const cellCenterLocalZ = (cellPosition.row + 0.5) * cellHeight;

  // Grid's top-left corner in coordinate system
  const gridTopLeftX = scaleResult.centerX - scaleResult.width / 2;
  const gridTopLeftZ = scaleResult.centerY - scaleResult.height / 2;

  // Cell center in coordinate system where path[0] cells have width 1
  const cellCenterX = gridTopLeftX + cellCenterLocalX;
  const cellCenterZ = gridTopLeftZ + cellCenterLocalZ;

  // Convert to world coordinates (center path[0] at origin)
  const worldX = cellCenterX - rootGrid.cols / 2;
  const worldZ = cellCenterZ - rootGrid.rows / 2;

  return {
    x: worldX,
    y: 0, // Always 0 for isometric ground plane
    z: worldZ
  };
}

/**
 * Result of camera calculation for a view path.
 */
export interface CameraParams {
  /** Camera position in world coordinates [x, y, z] */
  readonly position: [number, number, number];
  /** View width (horizontal span that camera can see) */
  readonly viewWidth: number;
}

/**
 * Calculate camera parameters for a given view path.
 * Returns camera position and viewWidth suitable for rendering.
 *
 * @param store - Grid store
 * @param viewPath - Hierarchy path to focus on
 * @param zoomMultiplier - Optional zoom factor (default 1.0). Values > 1 zoom out, < 1 zoom in.
 * @returns Camera parameters or null if path is invalid
 *
 * @example
 * ```typescript
 * // Calculate camera to view 'inner' grid within 'main'
 * const camera = calculateCameraForView(store, ['main', 'inner']);
 * // Use camera.position and camera.viewWidth to set up the renderer
 * ```
 */
export function calculateCameraForView(
  store: GridStore,
  viewPath: readonly string[],
  zoomMultiplier: number = 1.0
): CameraParams | null {
  if (viewPath.length === 0) return null;

  const gridId = viewPath[0];
  const grid = getGrid(store, gridId);
  if (!grid) return null;

  const scaleResult = getScaleAndOffset(store, viewPath);
  if (!scaleResult) return null;

  // Convert to world coordinates (where root grid is centered at origin)
  const refX = scaleResult.centerX - grid.cols / 2;
  const refZ = scaleResult.centerY - grid.rows / 2;

  // Calculate diagonal size of the focused grid
  const diagonal = Math.sqrt(scaleResult.width ** 2 + scaleResult.height ** 2);

  // Apply zoom multiplier
  const viewWidth = diagonal * zoomMultiplier;

  return {
    position: [refX, 0, refZ],
    viewWidth
  };
}

