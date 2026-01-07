/**
 * Grid analyzer - builds a CellTree from a GridStore.
 *
 * This implements the "analyze" phase of the two-phase rendering pipeline:
 * 1. Analyze: DFS traversal with dimensional tracking → CellTree
 * 2. Render: Walk CellTree to build isometric scene
 *
 * Key features:
 * - Dimensional tracking: width/height subdivided for nested grids
 * - Threshold-based cutoff: stops when dimensions < threshold (handles cycles naturally)
 * - Primary reference tracking: first ref to each grid (DFS order) is primary
 */

import type { GridStore, Cell } from '../core/types.js';
import { getGrid, isEmpty, isConcrete, isRef } from '../core/types.js';
import type { CellNode, EmptyNode, CutoffNode, ConcreteNode, RefNode, NestedNode } from './types.js';

/**
 * Analyze a grid recursively, building a CellTree with dimensional tracking.
 * Terminates when cell dimensions fall below threshold (handles cycles naturally).
 *
 * @param store - Grid store containing all grids
 * @param gridId - Grid to analyze
 * @param width - Width allocated for this grid (in arbitrary units)
 * @param height - Height allocated for this grid (in arbitrary units)
 * @param threshold - Minimum dimension before cutoff (default 0.1)
 * @param primaryRefs - Set tracking which grids have been referenced (for primary detection)
 * @param focusPath - Optional path to focused grid for computing focus metadata
 * @param currentPath - Current path during traversal (for focus metadata computation)
 * @param parentRefPos - Position of parent ref cell [col, row] (for depth -1 offset computation)
 * @returns CellNode tree representing the analyzed grid
 *
 * @example
 * ```typescript
 * const store = parseGrids({ main: '1 2|3 4' });
 * const tree = analyze(store, 'main', 1.0, 1.0);
 * // tree is a NestedNode with 2x2 children (all ConcreteNodes)
 * ```
 *
 * @example
 * ```typescript
 * // Self-referencing grid (cycle)
 * const store = parseGrids({ main: 'main _' });
 * const tree = analyze(store, 'main', 1.0, 1.0, 0.1);
 * // tree contains RefNode → NestedNode → RefNode → ... → CutoffNode
 * ```
 */
export function analyze(
  store: GridStore,
  gridId: string,
  width: number,
  height: number,
  threshold: number = 0.1,
  primaryRefs: Set<string> = new Set(),
  focusPath: readonly string[] | null = null,
  currentPath: readonly string[] = [],
  parentRefPos: readonly [number, number] | null = null
): CellNode {
  // Initialize currentPath if empty (first call)
  const effectiveCurrentPath = currentPath.length === 0 ? [gridId] : currentPath;

  // Helper function to compute focus metadata for a cell at (row, col)
  const computeFocusMetadata = (
    row: number,
    col: number
  ): { focusDepth: number | null; focusOffset: readonly [number, number] | null } => {
    if (focusPath === null) {
      return { focusDepth: null, focusOffset: null };
    }

    // Compare current_path to focus_path
    const currentPathArray = Array.from(effectiveCurrentPath);
    const focusPathArray = Array.from(focusPath);

    if (arraysEqual(currentPathArray, focusPathArray)) {
      // Depth 0: inside focused grid
      return { focusDepth: 0, focusOffset: [col, row] };
    } else if (effectiveCurrentPath.length < focusPath.length) {
      // Check if current_path is a prefix of focus_path
      if (isPrefixOf(currentPathArray, focusPathArray)) {
        // We're an ancestor (negative depth)
        const depth = -(focusPath.length - effectiveCurrentPath.length);
        if (depth === -1) {
          // Depth -1: offset relative to ref position in current grid
          const refPos = findFocusRefPosition();
          if (refPos !== null) {
            const [refCol, refRow] = refPos;
            return { focusDepth: depth, focusOffset: [col - refCol, row - refRow] };
          }
        }
        return { focusDepth: depth, focusOffset: null };
      }
    } else if (effectiveCurrentPath.length > focusPath.length) {
      // Check if focus_path is a prefix of current_path
      if (isPrefixOf(focusPathArray, currentPathArray)) {
        // We're a descendant (positive depth)
        const depth = effectiveCurrentPath.length - focusPath.length;
        return { focusDepth: depth, focusOffset: null };
      }
    }

    // Paths diverged
    return { focusDepth: null, focusOffset: null };
  };

  // Helper to find the position of the ref cell that points to the next grid in focus_path
  const findFocusRefPosition = (): readonly [number, number] | null => {
    if (focusPath === null || effectiveCurrentPath.length >= focusPath.length) {
      return null;
    }

    const targetGrid = focusPath[effectiveCurrentPath.length];
    const grid = getGrid(store, gridId);
    if (!grid) return null;

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        if (isRef(cell) && cell.gridId === targetGrid) {
          return [c, r];
        }
      }
    }
    return null;
  };

  // Helper functions for array comparison
  const arraysEqual = (a: string[], b: string[]): boolean => {
    return a.length === b.length && a.every((val, idx) => val === b[idx]);
  };

  const isPrefixOf = (prefix: string[], array: string[]): boolean => {
    return prefix.length <= array.length &&
           prefix.every((val, idx) => val === array[idx]);
  };

  // Threshold check - terminate if dimensions too small
  if (width < threshold || height < threshold) {
    const metadata = computeFocusMetadata(0, 0);
    return {
      type: 'cutoff',
      gridId,
      focusDepth: metadata.focusDepth,
      focusOffset: metadata.focusOffset
    };
  }

  // Get the grid
  const grid = getGrid(store, gridId);
  if (!grid) {
    throw new Error(`Grid not found: ${gridId}`);
  }

  // Subdivide dimensions for cells
  const cellWidth = width / grid.cols;
  const cellHeight = height / grid.rows;

  // Analyze each cell
  const rows: CellNode[][] = [];
  for (let row = 0; row < grid.rows; row++) {
    const cols: CellNode[] = [];
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row][col];
      const metadata = computeFocusMetadata(row, col);

      if (isEmpty(cell)) {
        // Empty cell
        cols.push({
          type: 'empty',
          focusDepth: metadata.focusDepth,
          focusOffset: metadata.focusOffset
        });
      } else if (isConcrete(cell)) {
        // Concrete cell
        cols.push({
          type: 'concrete',
          id: cell.id,
          gridId,
          focusDepth: metadata.focusDepth,
          focusOffset: metadata.focusOffset
        });
      } else if (isRef(cell)) {
        // Reference cell - determine primary status and recurse
        let isPrimary: boolean;

        if (cell.isPrimary === true) {
          // Explicitly marked as primary
          isPrimary = true;
          primaryRefs.add(cell.gridId);
        } else if (cell.isPrimary === false) {
          // Explicitly marked as secondary
          isPrimary = false;
        } else {
          // Auto-determine: first ref to this grid is primary
          isPrimary = !primaryRefs.has(cell.gridId);
          if (isPrimary) {
            primaryRefs.add(cell.gridId);
          }
        }

        // Update current path for recursive call
        const newPath = [...effectiveCurrentPath, cell.gridId];

        // Recursively analyze the referenced grid
        // The referenced grid inherits this cell's dimensions
        const content = analyze(
          store,
          cell.gridId,
          cellWidth,
          cellHeight,
          threshold,
          primaryRefs,
          focusPath,
          newPath,
          [col, row] // Pass ref position for depth -1 calculations
        );

        cols.push({
          type: 'ref',
          gridId,
          refTarget: cell.gridId,
          isPrimary,
          content,
          focusDepth: metadata.focusDepth,
          focusOffset: metadata.focusOffset
        });
      }
    }
    rows.push(cols);
  }

  // Compute metadata for the nested node itself (use position 0,0 as representative)
  const nestedMetadata = computeFocusMetadata(0, 0);

  return {
    type: 'nested',
    gridId,
    children: rows,
    focusDepth: nestedMetadata.focusDepth,
    focusOffset: nestedMetadata.focusOffset
  };
}
