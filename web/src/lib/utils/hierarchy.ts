/**
 * Utilities for working with grid hierarchy and ancestor relationships.
 */

import { Direction } from '../core/direction.js';
import { CellPosition } from '../core/position.js';
import type { GridStore } from '../core/types.js';
import { Navigator } from '../navigator/navigator.js';
import { findPrimaryRef } from './immutable.js';

/**
 * Build the ancestor chain from a grid to the root.
 * Uses cycle detection to handle cycles in the primary reference chain.
 *
 * @param store - The grid store
 * @param gridId - Starting grid ID
 * @returns Array of grid IDs from gridId to root (inclusive), or empty array if cycle detected
 *
 * @example
 * // Simple chain: child -> parent -> root
 * getAncestorChain(store, 'child') // Returns ['child', 'parent', 'root']
 *
 * // Already at root
 * getAncestorChain(store, 'root') // Returns ['root']
 *
 * // Cycle detected
 * getAncestorChain(store, 'cyclic') // Returns []
 */
export function getAncestorChain(store: GridStore, gridId: string): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = gridId;

  while (true) {
    // Cycle detection
    if (visited.has(currentId)) {
      // Cycle detected - return empty array
      return [];
    }

    visited.add(currentId);
    chain.push(currentId);

    // Try to find parent via primary ref
    const primaryRef = findPrimaryRef(store, currentId);
    if (!primaryRef) {
      // Reached root (no parent) - return the chain
      return chain;
    }

    // Move to parent
    const [parentGridId] = primaryRef;
    currentId = parentGridId;
  }
}

/**
 * Simulate exiting a grid in a given direction to find the destination grid.
 * Reuses the Navigator's cascading exit logic.
 *
 * @param store - The grid store
 * @param position - Starting position
 * @param direction - Direction to exit
 * @returns Grid ID of destination after cascading exits, or null if blocked
 *
 * @example
 * // Exit north from position - succeeds and lands in parent grid
 * simulateExitDestination(store, pos, Direction.N) // Returns 'parentGrid'
 *
 * // Exit blocked by root edge
 * simulateExitDestination(store, pos, Direction.S) // Returns null
 */
export function simulateExitDestination(
  store: GridStore,
  position: CellPosition,
  direction: Direction
): string | null {
  // Create a temporary navigator to simulate the exit
  const navigator = new Navigator(store, position, direction);

  // Try to advance in the direction (this will handle cascading exits)
  const success = navigator.tryAdvance();

  if (!success) {
    // Exit blocked (hit root edge or cycle)
    return null;
  }

  // Return the grid we ended up in
  return navigator.current.gridId;
}

/**
 * Find the highest ancestor from all exit destinations.
 * Simulates exits in all 4 compass directions and finds the highest ancestor
 * among the destinations that are actually ancestors of the current grid.
 *
 * This implements the new root grid selection rule:
 * - Simulate exits in all 4 directions (N/S/E/W)
 * - Collect destination grid IDs
 * - Filter to only ancestors of current grid
 * - Pick the highest ancestor (furthest up the chain)
 *
 * @param store - The grid store
 * @param position - Current player position
 * @returns Grid ID of highest ancestor, or null if not applicable
 *
 * @example
 * // Player near multiple edges, exits lead to parent and grandparent
 * findHighestAncestor(store, pos) // Returns 'grandparent'
 *
 * // All exits blocked or lead to current grid
 * findHighestAncestor(store, pos) // Returns null
 *
 * // Highest ancestor is immediate parent (no benefit)
 * findHighestAncestor(store, pos) // Returns null
 */
export function findHighestAncestor(
  store: GridStore,
  position: CellPosition
): string | null {
  // Step 1: Get ancestor chain of current grid
  const ancestorChain = getAncestorChain(store, position.gridId);

  if (ancestorChain.length === 0) {
    // Cycle detected in ancestor chain - bail out
    return null;
  }

  if (ancestorChain.length === 1) {
    // Already at root (no ancestors) - no benefit
    return null;
  }

  // Step 2: Simulate exits in all 4 directions
  const directions = [Direction.N, Direction.S, Direction.E, Direction.W];
  const exitDestinations: (string | null)[] = directions.map(dir =>
    simulateExitDestination(store, position, dir)
  );

  // Step 3: Filter to only valid ancestors
  // An exit destination is valid if it appears in the ancestor chain
  const ancestorSet = new Set(ancestorChain);
  const ancestorDestinations = exitDestinations.filter(
    (dest): dest is string => dest !== null && ancestorSet.has(dest)
  );

  if (ancestorDestinations.length === 0) {
    // No exits lead to ancestors (all blocked or outside ancestor chain)
    return null;
  }

  // Step 4: Find the highest ancestor among destinations
  // The highest ancestor has the maximum index in the ancestor chain
  let highestAncestor = ancestorDestinations[0];
  let highestIndex = ancestorChain.indexOf(highestAncestor);

  for (const dest of ancestorDestinations) {
    const index = ancestorChain.indexOf(dest);
    if (index > highestIndex) {
      highestIndex = index;
      highestAncestor = dest;
    }
  }

  // Step 5: Check if the highest ancestor is meaningful
  const currentGridIndex = 0; // Current grid is always at index 0
  const immediateParentIndex = 1; // Immediate parent is at index 1 (if it exists)

  if (highestIndex === currentGridIndex) {
    // Highest ancestor is the current grid - no benefit
    return null;
  }

  if (highestIndex === immediateParentIndex) {
    // Highest ancestor is the immediate parent - let existing logic handle it
    return null;
  }

  // We found a meaningful highest ancestor (grandparent or higher)
  return highestAncestor;
}
