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
 * This matches the existing camera behavior from demo-iso.ts.
 */

import type { GridStore } from '../core/types.js';
import type { CameraController, ViewUpdate, ViewPath } from './camera-protocol.js';
import { getAncestorChain, getParent } from './hierarchy-helper.js';
import { findPrimaryRef } from '../utils/immutable.js';
import { findHighestAncestor } from '../utils/hierarchy.js';
import { CellPosition } from '../core/position.js';

/**
 * Default camera controller that shows parent/ancestor grids.
 */
export class ParentViewCameraController implements CameraController {
  /**
   * Get initial view - uses ancestor chain to show context.
   */
  getInitialView(store: GridStore, playerGridId: string): ViewUpdate {
    const viewPath = this.buildViewPath(store, playerGridId);
    return {
      targetView: viewPath,
    };
  }

  /**
   * Handle player entering a grid (moving into a reference cell).
   * Typically shows the parent grid zoomed to the entered reference.
   */
  onPlayerEnter(
    store: GridStore,
    fromGridId: string,
    toGridId: string
  ): ViewUpdate {
    const viewPath = this.buildViewPath(store, toGridId);
    return {
      targetView: viewPath,
      // Animation start view could be the old view, but we'll let the demo
      // handle animation based on transition type for now
    };
  }

  /**
   * Handle player exiting a grid (moving out of a reference cell).
   * Shows the parent of the new grid.
   */
  onPlayerExit(
    store: GridStore,
    fromGridId: string,
    toGridId: string
  ): ViewUpdate {
    const viewPath = this.buildViewPath(store, toGridId);
    return {
      targetView: viewPath,
      // Animation start view could be computed from the old grid's position
      // in the parent, but we'll let the demo handle this for now
    };
  }

  /**
   * Handle player moving within the same grid.
   * Typically keeps the same view.
   */
  onPlayerMove(store: GridStore, gridId: string): ViewUpdate {
    const viewPath = this.buildViewPath(store, gridId);
    return {
      targetView: viewPath,
    };
  }

  /**
   * Build a view path for a given grid.
   * Attempts to show parent/ancestor grid for context.
   *
   * Priority:
   * 1. Highest ancestor from exit destinations (via findHighestAncestor)
   * 2. Immediate parent grid
   * 3. Current grid (if no parent exists)
   */
  private buildViewPath(store: GridStore, playerGridId: string): ViewPath {
    // Try to find highest ancestor via exit destinations
    // Note: findHighestAncestor requires a CellPosition, but we only have gridId
    // We'll need to pass a position (0, 0) as a placeholder since the function
    // uses it to check exit destinations
    const dummyPosition = new CellPosition(playerGridId, 0, 0);
    const highestAncestorId = findHighestAncestor(store, dummyPosition);

    if (highestAncestorId) {
      // Build path from highest ancestor down to player grid
      return this.buildPathToGrid(store, highestAncestorId, playerGridId);
    }

    // Fall back to immediate parent
    const parentId = getParent(store, playerGridId);
    if (parentId) {
      // Build path from parent down to player grid
      return this.buildPathToGrid(store, parentId, playerGridId);
    }

    // Fall back to current grid - build path from root
    const ancestorChain = getAncestorChain(store, playerGridId);
    if (ancestorChain) {
      // Reverse to get root-to-player order
      return ancestorChain.slice().reverse();
    }

    // Final fallback - just the player grid
    return [playerGridId];
  }

  /**
   * Build a path from ancestor grid down to target grid.
   * Assumes ancestorGridId is actually an ancestor of targetGridId.
   */
  private buildPathToGrid(
    store: GridStore,
    ancestorGridId: string,
    targetGridId: string
  ): ViewPath {
    if (ancestorGridId === targetGridId) {
      return [targetGridId];
    }

    // Get path from target up to root
    const upwardPath = getAncestorChain(store, targetGridId);
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
}
