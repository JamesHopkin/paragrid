/**
 * Hierarchy Helper - Navigation through grid hierarchy based on grid names.
 *
 * Provides a clean API for navigating the grid hierarchy without exposing
 * cell-level details. All operations are cycle-aware and based on primary
 * reference relationships.
 */

import type { GridStore } from '../core/types.js';
import { getGrid, isRef } from '../core/types.js';
import { findPrimaryRef } from '../utils/immutable.js';

/**
 * Get the parent grid ID of a given grid.
 * The parent is defined as the grid containing the primary reference.
 *
 * @param store - The grid store
 * @param gridId - The grid to find the parent of
 * @returns The parent grid ID, or null if no parent exists (i.e., this is a root grid)
 *
 * @example
 * ```typescript
 * const parent = getParent(store, 'child');
 * // parent === 'root' if root contains the primary ref to child
 * // parent === null if child has no primary ref (is a root)
 * ```
 */
export function getParent(store: GridStore, gridId: string): string | null {
  const primaryRef = findPrimaryRef(store, gridId);
  if (!primaryRef) {
    return null;
  }
  const [parentGridId] = primaryRef;
  return parentGridId;
}

/**
 * Get all grids directly referenced by a given grid.
 * Returns a list of unique grid IDs that are referenced in the given grid,
 * in the order they first appear (row-major order).
 *
 * @param store - The grid store
 * @param gridId - The grid to get children of
 * @returns Array of grid IDs referenced by this grid (may be empty)
 *
 * @example
 * ```typescript
 * // Grid 'parent' contains cells: [Ref('a'), Ref('b'), Ref('a')]
 * const children = getDirectlyContainedReferences(store, 'parent');
 * // children === ['a', 'b'] (order preserved, duplicates removed)
 * ```
 */
export function getDirectlyContainedReferences(
  store: GridStore,
  gridId: string
): string[] {
  const grid = getGrid(store, gridId);
  if (!grid) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  // Scan cells in row-major order
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row][col];
      if (isRef(cell) && !seen.has(cell.gridId)) {
        seen.add(cell.gridId);
        result.push(cell.gridId);
      }
    }
  }

  return result;
}

/**
 * Find a specific grid among directly contained references.
 * This is a convenience wrapper around getDirectlyContainedReferences.
 *
 * @param store - The grid store
 * @param parentGridId - The parent grid to search in
 * @param childGridId - The child grid to find
 * @returns true if parentGridId directly references childGridId, false otherwise
 *
 * @example
 * ```typescript
 * const hasChild = findDirectlyContainedReference(store, 'parent', 'child');
 * // hasChild === true if parent grid contains a Ref to child
 * ```
 */
export function findDirectlyContainedReference(
  store: GridStore,
  parentGridId: string,
  childGridId: string
): boolean {
  const children = getDirectlyContainedReferences(store, parentGridId);
  return children.includes(childGridId);
}

/**
 * Get the path from a grid to a named ancestor.
 * Returns the sequence of grid IDs from the starting grid up to (and including)
 * the target ancestor, following primary references.
 *
 * This function is cycle-aware:
 * - Returns null if a cycle is detected before reaching the ancestor
 * - Returns null if the target is not actually an ancestor
 *
 * @param store - The grid store
 * @param fromGridId - Starting grid
 * @param toAncestorGridId - Target ancestor grid
 * @returns Path array [fromGridId, ..., toAncestorGridId], or null if not reachable
 *
 * @example
 * ```typescript
 * // Hierarchy: root -> child -> grandchild
 * const path = getPathToAncestor(store, 'grandchild', 'root');
 * // path === ['grandchild', 'child', 'root']
 *
 * const invalid = getPathToAncestor(store, 'root', 'child');
 * // invalid === null (child is not an ancestor of root)
 *
 * const self = getPathToAncestor(store, 'root', 'root');
 * // self === ['root'] (grid is its own ancestor)
 * ```
 */
export function getPathToAncestor(
  store: GridStore,
  fromGridId: string,
  toAncestorGridId: string
): string[] | null {
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId = fromGridId;

  while (true) {
    // Cycle detection
    if (visited.has(currentId)) {
      return null; // Cycle detected before reaching ancestor
    }

    visited.add(currentId);
    path.push(currentId);

    // Check if we've reached the target
    if (currentId === toAncestorGridId) {
      return path;
    }

    // Move to parent
    const parentId = getParent(store, currentId);
    if (parentId === null) {
      // Reached root without finding ancestor
      return null;
    }

    currentId = parentId;
  }
}

/**
 * Get the complete ancestor chain from a grid to the root.
 * This is equivalent to calling getPathToAncestor with an unknown root,
 * continuing until no parent is found.
 *
 * @param store - The grid store
 * @param gridId - Starting grid
 * @returns Path array [gridId, parent, ..., root], or null if cycle detected
 *
 * @example
 * ```typescript
 * const chain = getAncestorChain(store, 'child');
 * // chain === ['child', 'parent', 'root']
 *
 * const rootChain = getAncestorChain(store, 'root');
 * // rootChain === ['root'] (root has no parent)
 * ```
 */
export function getAncestorChain(store: GridStore, gridId: string): string[] | null {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = gridId;

  while (true) {
    // Cycle detection
    if (visited.has(currentId)) {
      return null; // Cycle detected
    }

    visited.add(currentId);
    chain.push(currentId);

    // Try to find parent
    const parentId = getParent(store, currentId);
    if (parentId === null) {
      // Reached root
      return chain;
    }

    currentId = parentId;
  }
}
