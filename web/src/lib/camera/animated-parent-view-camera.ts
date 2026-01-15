/**
 * Animated Parent View Camera Controller
 *
 * Extends ParentViewCameraController to add smooth animations between
 * enter/exit transitions. Tracks the current view state to provide
 * animation start views for camera transitions.
 *
 * Animation Strategy:
 * - Enter/Exit: Animates from previous view to new view (zoom in/out effect)
 * - Initial view: No animation (instant)
 * - Within-grid movement: No animation (view doesn't change)
 */

import type { CameraController, ViewUpdate, ViewPath } from './camera-protocol.js';
import type { HierarchyHelper } from './hierarchy-helper.js';
import { buildViewPath } from './parent-view-camera.js';

/**
 * Camera controller with smooth animations for enter/exit transitions.
 */
export class AnimatedParentViewCameraController implements CameraController {

  constructor(private helper: HierarchyHelper) {
  }

  /**
   * Get standard steady-state view - no animation for standard view.
   */
  getStandardView(playerGridId: string): ViewUpdate {
    return {
      targetView: buildViewPath(this.helper, playerGridId),
    };
  }

  /**
   * Handle player entering a grid - animate from previous view.
   * Creates a zoom-in effect as the camera focuses on the entered grid.
   */
  onPlayerEnter(fromGridId: string, toGridId: string, lastTeleportToGrid?: string): ViewUpdate {
    if (lastTeleportToGrid !== undefined) {
      const toViewPath = buildViewPath(this.helper, toGridId);

      // Teleport occurred - pretend we came from the parent if any
      return {
        targetView: toViewPath,
        animationStartView: toViewPath.length > 1 ? toViewPath.slice(-1) : undefined
      }
    }

    // INTENTION: Use fromViewPath as the base for animation to ensure all necessary
    // ancestor grids are visible at animation start. Using toViewPath directly could
    // cause outer recursive grids to be missing if the animation assumes a deeper
    // zoom level than we currently have.
    //
    // FIX: For exit/enter scenarios, find the common ancestor, preserve the full
    // fromViewPath depth up to that ancestor, then append the path to toGridId.
    // Example: viewing r->r->a->b, exit to a then enter c gives r->r->a->c (not r->a->c)
    const fromViewPath = buildViewPath(this.helper, fromGridId);

    if (fromGridId === toGridId) {
      if (this.helper.getParent(fromGridId) !== toGridId) {
        console.warn(`Entering same grid but not self-reference (grid ${fromGridId})?`)
      }

      return {
        targetView: [...fromViewPath, fromViewPath[0]],
        animationStartView: fromViewPath
      };
    }

    // Find the common ancestor (the grid that contains both from and to)
    const toViewPath = buildViewPath(this.helper, toGridId);
    const commonAncestor = this.helper.getParent(fromGridId) === this.helper.getParent(toGridId)
      ? this.helper.getParent(fromGridId)
      : this.findCommonAncestor(fromGridId, toGridId);

    if (!commonAncestor) {
      // Shouldn't happen in valid hierarchy, fall back to simple approach
      return {
        targetView: toViewPath,
        animationStartView: fromViewPath
      };
    }

    // Find where common ancestor appears in fromViewPath and trim there
    const ancestorIndex = fromViewPath.lastIndexOf(commonAncestor);
    const baseViewPath = fromViewPath.slice(0, ancestorIndex + 1);

    // Get path from common ancestor down to target
    const gridsDownToTo = this.helper.getAncestorChain(toGridId, commonAncestor);
    gridsDownToTo.reverse();

    return {
      targetView: [...baseViewPath, ...gridsDownToTo],
      animationStartView: fromViewPath
    };
  }

  /**
   * Find the lowest common ancestor of two grids.
   * Includes cycle detection to prevent infinite loops.
   */
  private findCommonAncestor(gridA: string, gridB: string): string | null {
    const ancestorsA = new Set<string>();
    let current: string | null = gridA;

    // Build set of ancestors from gridA, with cycle detection
    while (current !== null) {
      if (ancestorsA.has(current)) {
        // Cycle detected, stop here
        break;
      }
      ancestorsA.add(current);
      current = this.helper.getParent(current);
    }

    // Walk up from gridB to find common ancestor, with cycle detection
    const visitedB = new Set<string>();
    current = gridB;
    while (current !== null) {
      if (visitedB.has(current)) {
        // Cycle detected, no common ancestor found
        break;
      }
      if (ancestorsA.has(current)) {
        return current;
      }
      visitedB.add(current);
      current = this.helper.getParent(current);
    }

    return null;
  }

  /**
   * Handle player exiting a grid - animate from previous view.
   * Creates a zoom-out effect as the camera pulls back to show context.
   */
  onPlayerExit(fromGridId: string, toGridId: string): ViewUpdate {
    // Base everything on toViewPath, so we don't briefly show the background before popping in ancestors
    const toViewPath = buildViewPath(this.helper, toGridId);

    if (fromGridId === toGridId) {
      if (this.helper.getParent(fromGridId) !== toGridId) {
        console.warn(`Exiting to same grid but not self-reference (grid ${fromGridId})?`)
      }

      return {
        targetView: toViewPath,
        animationStartView: [toViewPath[0], ...toViewPath]
      };
    }

    const gridsDownToFrom = this.helper.getAncestorChain(fromGridId, toGridId);
    gridsDownToFrom.reverse();

    return {
      targetView: toViewPath,
      animationStartView: [...toViewPath, ...gridsDownToFrom]
    };
  }

  /**
   * Handle player moving within the same grid - no animation needed.
   * The view typically doesn't change for within-grid movement.
   * Enables tracking so camera follows if the player's grid is pushed.
   */
  onPlayerMove(gridId: string): ViewUpdate {
    return {
      targetView: buildViewPath(this.helper, gridId),
      trackObjectAnimations: true
    };
  }
}
