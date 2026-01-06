/**
 * Parent View Camera Controller
 *
 * A camera controller that displays the parent or ancestor grid when possible,
 * providing context for the player's current position.
 *
 * Strategy:
 * - Shows the highest ancestor grid reachable via exit destinations (if available)
 * - Falls back to immediate parent grid (via primary reference)
 * - Falls back to current grid if no parent exists
 *
 * Uses a HierarchyHelper to query grid relationships without direct access
 * to the GridStore.
 */

import type { CameraController, ViewUpdate, ViewPath } from './camera-protocol.js';
import type { HierarchyHelper } from './hierarchy-helper.js';

/**
 * Build a path from ancestor grid down to target grid.
 * Assumes ancestorGridId is actually an ancestor of targetGridId.
 */
function buildPathToGrid(helper: HierarchyHelper, ancestorGridId: string, targetGridId: string): ViewPath {
  if (ancestorGridId === targetGridId) {
    return [targetGridId];
  }

  // Get path from target up to root
  const upwardPath = helper.getAncestorChain(targetGridId);
  if (!upwardPath) {
    // Cycle detected or invalid - fall back to just target
    return [targetGridId];
  }

  // Find where ancestor appears in the upward path
  const ancestorIndex = upwardPath.indexOf(ancestorGridId);
  if (ancestorIndex === -1) {
    // Ancestor not found in chain - fall back to target
    return [targetGridId];
  }

  // Slice from ancestor to target and reverse
  const downwardPath = upwardPath.slice(0, ancestorIndex + 1).reverse();
  return downwardPath;
}

/**
 * Find highest ancestor reachable via exits.
 * Returns null if no exits lead to ancestors above immediate parent.
 */
function findHighestExitAncestor(helper: HierarchyHelper, gridId: string): string | null {
    // Get ancestor chain
    const ancestorChain = helper.getAncestorChain(gridId);
    if (!ancestorChain || ancestorChain.length <= 1) {
      return null; // No ancestors or cycle
    }

    // Get exit destinations
    const exits = helper.getExitDestinations(gridId);
    const ancestorSet = new Set(ancestorChain);

    // Find highest ancestor among exit destinations
    let highestAncestor: string | null = null;
    let highestIndex = -1;

    for (const destination of exits.values()) {
      if (destination && ancestorSet.has(destination)) {
        const index = ancestorChain.indexOf(destination);
        if (index > highestIndex) {
          highestIndex = index;
          highestAncestor = destination;
        }
      }
    }

    // Only return if we found a grandparent or higher
    if (highestIndex > 1) {
      return highestAncestor;
    }

    return null;
}

/**
 * Build a view path for a given grid.
 * Attempts to show parent/ancestor grid for context.
 *
 * Priority:
 * 1. Highest ancestor from exit destinations (via getExitDestinations)
 * 2. Immediate parent grid
 * 3. Current grid (if no parent exists)
 */
export function buildViewPath(helper: HierarchyHelper, playerGridId: string): ViewPath {
    // Try to find highest ancestor via exit destinations
    const highestAncestorId = findHighestExitAncestor(helper, playerGridId);

    if (highestAncestorId) {
      // Build path from highest ancestor down to player grid
      return buildPathToGrid(helper, highestAncestorId, playerGridId);
    }

    // Fall back to immediate parent
    const parentId = helper.getParent(playerGridId);
    if (parentId) {
      // Build path from parent down to player grid
      return [parentId, playerGridId];
    }

    // Fall back to current grid - build path from root
    const ancestorChain = helper.getAncestorChain(playerGridId);
    if (ancestorChain) {
      // Reverse to get root-to-player order
      return ancestorChain.slice().reverse();
    }

    // Final fallback - just the player grid
    return [playerGridId];
  }

/**
 * Camera controller that shows parent/ancestor grids (no animation).
 */
export class ParentViewCameraController implements CameraController {
  constructor(private helper: HierarchyHelper) {}

  /**
   * Get initial view - uses ancestor chain to show context.
   */
  getInitialView(playerGridId: string): ViewUpdate {
    const viewPath = buildViewPath(this.helper, playerGridId);
    return {
      targetView: viewPath,
    };
  }

  /**
   * Handle player entering a grid (moving into a reference cell).
   * Typically shows the parent grid zoomed to the entered reference.
   */
  onPlayerEnter(fromGridId: string, toGridId: string): ViewUpdate {
    const viewPath = buildViewPath(this.helper, toGridId);
    return {
      targetView: viewPath,
    };
  }

  /**
   * Handle player exiting a grid (moving out of a reference cell).
   * Shows the parent of the new grid.
   */
  onPlayerExit(fromGridId: string, toGridId: string): ViewUpdate {
    const viewPath = buildViewPath(this.helper, toGridId);
    return {
      targetView: viewPath,
    };
  }

  /**
   * Handle player moving within the same grid.
   * Typically keeps the same view.
   */
  onPlayerMove(gridId: string): ViewUpdate {
    const viewPath = buildViewPath(this.helper, gridId);
    return {
      targetView: viewPath,
    };
  }
}
