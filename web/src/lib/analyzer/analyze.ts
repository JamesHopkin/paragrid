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
  primaryRefs: Set<string> = new Set()
): CellNode {
  // Threshold check - terminate if dimensions too small
  if (width < threshold || height < threshold) {
    return { type: 'cutoff', gridId };
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

      if (isEmpty(cell)) {
        // Empty cell
        cols.push({ type: 'empty' });
      } else if (isConcrete(cell)) {
        // Concrete cell
        cols.push({ type: 'concrete', id: cell.id, gridId });
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

        // Recursively analyze the referenced grid
        // The referenced grid inherits this cell's dimensions
        const content = analyze(
          store,
          cell.gridId,
          cellWidth,
          cellHeight,
          threshold,
          primaryRefs
        );

        cols.push({
          type: 'ref',
          gridId,
          refTarget: cell.gridId,
          isPrimary,
          content
        });
      }
    }
    rows.push(cols);
  }

  return { type: 'nested', gridId, children: rows };
}
