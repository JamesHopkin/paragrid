/**
 * Hierarchy Helper - Navigation through grid hierarchy based on grid names.
 *
 * Provides a clean API for navigating the grid hierarchy without exposing
 * cell-level details. All operations are cycle-aware and based on primary
 * reference relationships.
 *
 * The helper holds a mutable reference to a GridStore, which should be updated
 * via setStore() when the store changes.
 */

import type { GridStore } from '../core/types.js';
import { getGrid, isRef } from '../core/types.js';
import { findPrimaryRef } from '../utils/immutable.js';
import { Direction } from '../core/direction.js';
import { CellPosition } from '../core/position.js';
import { simulateExitDestination } from '../utils/hierarchy.js';

/**
 * Helper for navigating grid hierarchy based on grid names.
 *
 * Holds a mutable reference to a GridStore. When the store changes,
 * call setStore() to update the reference.
 */
export class HierarchyHelper {
  private store: GridStore;

  constructor(store: GridStore) {
    this.store = store;
  }

  /**
   * Update the grid store reference.
   * Call this after the store has been modified or replaced.
   */
  setStore(store: GridStore): void {
    this.store = store;
  }

  /**
   * Get the parent grid ID of a given grid.
   * The parent is defined as the grid containing the primary reference.
   *
   * @param gridId - The grid to find the parent of
   * @returns The parent grid ID, or null if no parent exists (i.e., this is a root grid)
   *
   * @example
   * ```typescript
   * const parent = helper.getParent('child');
   * // parent === 'root' if root contains the primary ref to child
   * // parent === null if child has no primary ref (is a root)
   * ```
   */
  getParent(gridId: string): string | null {
    const primaryRef = findPrimaryRef(this.store, gridId);
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
   * @param gridId - The grid to get children of
   * @returns Array of grid IDs referenced by this grid (may be empty)
   *
   * @example
   * ```typescript
   * // Grid 'parent' contains cells: [Ref('a'), Ref('b'), Ref('a')]
   * const children = helper.getDirectlyContainedReferences('parent');
   * // children === ['a', 'b'] (order preserved, duplicates removed)
   * ```
   */
  getDirectlyContainedReferences(gridId: string): string[] {
    const grid = getGrid(this.store, gridId);
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
   * @param parentGridId - The parent grid to search in
   * @param childGridId - The child grid to find
   * @returns true if parentGridId directly references childGridId, false otherwise
   *
   * @example
   * ```typescript
   * const hasChild = helper.findDirectlyContainedReference('parent', 'child');
   * // hasChild === true if parent grid contains a Ref to child
   * ```
   */
  findDirectlyContainedReference(parentGridId: string, childGridId: string): boolean {
    const children = this.getDirectlyContainedReferences(parentGridId);
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
   * @param fromGridId - Starting grid
   * @param toAncestorGridId - Target ancestor grid
   * @returns Path array [fromGridId, ..., toAncestorGridId], or null if not reachable
   *
   * @example
   * ```typescript
   * // Hierarchy: root -> child -> grandchild
   * const path = helper.getPathToAncestor('grandchild', 'root');
   * // path === ['grandchild', 'child', 'root']
   *
   * const invalid = helper.getPathToAncestor('root', 'child');
   * // invalid === null (child is not an ancestor of root)
   *
   * const self = helper.getPathToAncestor('root', 'root');
   * // self === ['root'] (grid is its own ancestor)
   * ```
   */
  getPathToAncestor(fromGridId: string, toAncestorGridId: string): string[] | null {
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
      const parentId = this.getParent(currentId);
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
   * @param gridId - Starting grid
   * @returns Path array [gridId, parent, ..., root], or null if cycle detected
   *
   * @example
   * ```typescript
   * const chain = helper.getAncestorChain('child');
   * // chain === ['child', 'parent', 'root']
   *
   * const rootChain = helper.getAncestorChain('root');
   * // rootChain === ['root'] (root has no parent)
   * ```
   */
  getAncestorChain(gridId: string, stopAt?: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    let currentId = gridId;

    if (stopAt)
      visited.add(stopAt);

    while (true) {
      // Cycle detection
      if (visited.has(currentId)) {
        return chain; // Cycle detected
      }

      visited.add(currentId);
      chain.push(currentId);

      // Try to find parent
      const parentId = this.getParent(currentId);
      if (parentId === null) {
        // Reached root
        return chain;
      }

      currentId = parentId;
    }
  }

  /**
   * Get exit destinations for all four cardinal directions from a grid.
   *
   * Simulates exits in all compass directions (N, S, E, W) from a representative
   * position in the grid and returns the destination grid IDs. This is useful
   * for understanding which grids are reachable via exits, which can inform
   * camera decisions about what to render.
   *
   * Uses edge-appropriate positions for each direction:
   * - North: top edge (row 0, middle column)
   * - South: bottom edge (last row, middle column)
   * - East: right edge (middle row, last column)
   * - West: left edge (middle row, column 0)
   *
   * Returns null for directions where exit is blocked or fails.
   *
   * @param gridId - The grid to check exits from
   * @returns Map from Direction to destination grid ID (or null if blocked)
   *
   * @example
   * ```typescript
   * const exits = helper.getExitDestinations('child');
   * // exits.get(Direction.N) === 'parent' (exits north to parent)
   * // exits.get(Direction.S) === null (south exit blocked)
   * // exits.get(Direction.E) === 'sibling' (exits east to sibling)
   * // exits.get(Direction.W) === null (west exit blocked)
   * ```
   */
  getExitDestinations(gridId: string): Map<Direction, string | null> {
    const destinations = new Map<Direction, string | null>();
    const grid = getGrid(this.store, gridId);

    if (!grid) {
      // Grid doesn't exist, return empty map
      return destinations;
    }

    const middleRow = Math.floor(grid.rows / 2);
    const middleCol = Math.floor(grid.cols / 2);

    // Use edge-appropriate positions for each direction
    const positions = new Map<Direction, CellPosition>([
      [Direction.N, new CellPosition(gridId, 0, middleCol)],           // Top edge
      [Direction.S, new CellPosition(gridId, grid.rows - 1, middleCol)], // Bottom edge
      [Direction.E, new CellPosition(gridId, middleRow, grid.cols - 1)], // Right edge
      [Direction.W, new CellPosition(gridId, middleRow, 0)]              // Left edge
    ]);

    // Simulate exits from appropriate edge positions
    for (const [direction, position] of positions) {
      const destination = simulateExitDestination(this.store, position, direction);
      destinations.set(direction, destination);
    }

    return destinations;
  }
}
