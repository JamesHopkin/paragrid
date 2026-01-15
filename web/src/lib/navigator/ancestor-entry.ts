/**
 * Ancestor-based entry position calculation.
 *
 * Uses floating-point arithmetic to map exit positions through common ancestors,
 * enabling consistent cross-depth entry without tracking depth state.
 *
 * IMPORTANT: This module is intentionally brittle and relies on strong guarantees
 * provided by the push algorithm:
 *
 * 1. Both functions are always called with ancestor parameters specified
 *    (stopAtAncestor/ancestorGridId are never undefined in practice)
 * 2. The specified ancestor is guaranteed to exist in the ancestry chain
 * 3. The push algorithm ensures these invariants before calling these functions
 *
 * The "reached root" error cases are defensive checks that should never execute
 * in correct usage. They throw errors to catch API misuse during development.
 */

import type { GridStore } from '../core/types.js';

/** Type alias for find_primary_ref function */
export type FindPrimaryRefFn = (store: GridStore, gridId: string) => [string, number, number] | undefined;

/**
 * Compute the fractional position of a cell's center along a dimension.
 *
 * Cell centers are evenly spaced within [0, 1], positioned at (i+1)/(N+1) for i=0..N-1.
 *
 * @param cellIndex - 0-based index of the cell
 * @param dimension - Total number of cells in this dimension
 * @returns Number in [0, 1] representing center position
 *
 * @example
 * ```
 * computeCellCenterFraction(0, 1) // 0.5 (center of only cell)
 * computeCellCenterFraction(0, 3) // 0.25 (first third)
 * computeCellCenterFraction(1, 3) // 0.5 (middle)
 * computeCellCenterFraction(2, 3) // 0.75 (last third)
 * ```
 */
export function computeCellCenterFraction(cellIndex: number, dimension: number): number {
  return (cellIndex + 1) / (dimension + 1);
}

/**
 * Map a fractional position within a child grid through its parent cell.
 *
 * The child grid occupies a single cell in the parent, uniformly spanning [i/n, (i+1)/n].
 * Maps child's [0, 1] space to this parent cell interval.
 *
 * @param localFraction - Position within child (0.0 to 1.0)
 * @param parentCellIndex - Which parent cell contains this child
 * @param parentDimension - Number of cells in parent along this axis
 * @returns Number in parent's coordinate system
 */
export function mapFractionThroughParent(
  localFraction: number,
  parentCellIndex: number,
  parentDimension: number
): number {
  return (localFraction + parentCellIndex) / parentDimension;
}

/**
 * Map a position in parent coordinate space to child coordinate space.
 *
 * Inverse of mapFractionThroughParent.
 *
 * @param parentFraction - Position in parent's coordinate system
 * @param parentCellIndex - Which parent cell contains the child
 * @param parentDimension - Number of cells in parent along this axis
 * @returns Number in child's [0, 1] coordinate system
 * @throws Error if result is out of valid range [0, 1]
 */
export function mapFractionToChild(
  parentFraction: number,
  parentCellIndex: number,
  parentDimension: number
): number {
  const local = parentFraction * parentDimension - parentCellIndex;

  // Assert result is in valid range [0, 1]
  if (local < 0 || local > 1) {
    throw new Error(
      `Mapped fraction ${local} out of range [0, 1]. ` +
        `parentFraction=${parentFraction}, parentCellIndex=${parentCellIndex}, ` +
        `parentDimension=${parentDimension}`
    );
  }

  return local;
}

/**
 * Convert a fractional position to a cell index using floor.
 *
 * @param fraction - Position in [0, 1]
 * @param dimension - Number of cells
 * @returns Cell index (0-based), clamped to [0, dimension-1]
 */
export function fractionToCellIndex(fraction: number, dimension: number): number {
  // Convert fraction to cell index: floor(f * n)
  // Clamp to valid range to handle f = 1.0 edge case
  const index = Math.floor(fraction * dimension);
  return Math.min(index, dimension - 1);
}

/**
 * Compute the fractional position of a cell along an edge, in ancestor coordinates.
 *
 * Cascades up through parent grids, transforming the position at each level.
 *
 * @param store - Grid store
 * @param findPrimaryRefFn - Function to find primary ref (returns [parentId, row, col] | null)
 * @param gridId - ID of the grid we're exiting from
 * @param cellIndex - Cell index (row or col) we're exiting from
 * @param dimensionAttr - 'rows' or 'cols'
 * @param stopAtAncestor - Ancestor ID to stop at (must be in ancestry chain)
 * @returns [fraction in ancestor coordinates, ancestor_grid_id]
 */
export function computeExitAncestorFraction(
  store: GridStore,
  findPrimaryRefFn: FindPrimaryRefFn,
  gridId: string,
  cellIndex: number,
  dimensionAttr: 'rows' | 'cols',
  stopAtAncestor: string
): [number, string] {
  const currentGrid = store[gridId];
  const dimension = currentGrid[dimensionAttr];
  let fraction = computeCellCenterFraction(cellIndex, dimension);
  let currentGridId = gridId;

  // Cascade up through parents, transforming fraction
  while (true) {
    // Stop if we reached the target ancestor
    if (currentGridId === stopAtAncestor) {
      return [fraction, currentGridId];
    }

    const ref = findPrimaryRefFn(store, currentGridId);
    if (!ref) {
      // Should be unreachable - caller must ensure stopAtAncestor is in ancestry chain
      throw new Error(
        `stopAtAncestor '${stopAtAncestor}' not found in ancestry of '${gridId}'`
      );
    }

    const [parentGridId, refRow, refCol] = ref;
    const parentGrid = store[parentGridId];
    const parentDimension = parentGrid[dimensionAttr];

    // Transform fraction through parent
    const parentCellIndex = dimensionAttr === 'rows' ? refRow : refCol;
    fraction = mapFractionThroughParent(fraction, parentCellIndex, parentDimension);

    currentGridId = parentGridId;
  }
}

/**
 * Compute entry cell index by mapping from ancestor fraction down to target grid.
 *
 * @param store - Grid store
 * @param targetGridId - Grid to enter
 * @param ancestorFraction - Position in ancestor's coordinate system
 * @param dimensionAttr - 'rows' or 'cols'
 * @param ancestorGridId - Ancestor grid ID to start from
 * @param refChain - Explicit chain of refs from ancestor to target [parent_grid_id, ref_row, ref_col, child_grid_id]
 * @returns Cell index to enter
 */
export function computeEntryFromAncestorFraction(
  store: GridStore,
  targetGridId: string,
  ancestorFraction: number,
  dimensionAttr: 'rows' | 'cols',
  ancestorGridId: string,
  refChain: Array<[string, number, number, string]>
): number {
  // The refChain should start from ancestor and lead to target
  // Each entry is [parent_grid_id, ref_row, ref_col, child_grid_id]

  // Verify the chain starts at ancestor and ends at target
  if (refChain.length > 0) {
    const firstParent = refChain[0][0];
    const lastChild = refChain[refChain.length - 1][3];
    if (firstParent !== ancestorGridId) {
      throw new Error(`Chain starts at ${firstParent}, expected ${ancestorGridId}`);
    }
    if (lastChild !== targetGridId) {
      throw new Error(`Chain ends at ${lastChild}, expected ${targetGridId}`);
    }
  }

  // Transform fraction down through hierarchy
  let fraction = ancestorFraction;
  for (const [parentGridId, refRow, refCol, childGridId] of refChain) {
    const parentGrid = store[parentGridId];
    const parentDimension = parentGrid[dimensionAttr];

    // Map from parent space to child space
    const parentCellIndex = dimensionAttr === 'rows' ? refRow : refCol;
    fraction = mapFractionToChild(fraction, parentCellIndex, parentDimension);
  }

  // Convert fraction to cell index in target grid
  const targetGrid = store[targetGridId];
  const dimension = targetGrid[dimensionAttr];
  return fractionToCellIndex(fraction, dimension);
}
