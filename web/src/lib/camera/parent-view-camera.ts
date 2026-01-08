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
 * Build a view path for a given grid.
 * Look in blame here if we ever want to use `findHighestExitAncestor` again



 */
export function buildViewPath(helper: HierarchyHelper, playerGridId: string): ViewPath {
    const ancestorChain = helper.getAncestorChain(playerGridId);
    // Reverse to get root-to-player order
    ancestorChain.reverse();

    if (ancestorChain.length > 1)
      return ancestorChain;

    // need to check exit chain for e.g. edge has effective self reference, but from
    // inside (see google doc)

    // quick and dirty alternative to proper heuristics to decide how many cycle repeated grids to show  to show
    const parent = helper.getParent(playerGridId);
    return [...(parent ? [parent] : []), playerGridId];
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
