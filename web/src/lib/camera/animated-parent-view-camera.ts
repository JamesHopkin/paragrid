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
   * Get initial view - no animation for first view.
   */
  getInitialView(playerGridId: string): ViewUpdate {
    return {
      targetView: buildViewPath(this.helper, playerGridId),
    };
  }

  /**
   * Handle player entering a grid - animate from previous view.
   * Creates a zoom-in effect as the camera focuses on the entered grid.
   */
  onPlayerEnter(fromGridId: string, toGridId: string): ViewUpdate {
    // Base everything on fromViewPath, so we don't briefly show the background before zooming in
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

    const gridsDownToTo = this.helper.getAncestorChain(toGridId, fromGridId);
    gridsDownToTo.reverse();

    return {
      targetView: [...fromViewPath, ...gridsDownToTo],
      animationStartView: fromViewPath
    };
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

      // Self-reference exit: un-nest from doubled path to single path
      // toViewPath might already be doubled (e.g., [main, main]), so extract the base path
      const gridId = toGridId;
      let basePath: ViewPath;

      if (toViewPath.length >= 2 &&
          toViewPath[toViewPath.length - 1] === gridId &&
          toViewPath[toViewPath.length - 2] === gridId) {
        // toViewPath is already doubled, remove the duplication
        basePath = toViewPath.slice(0, -1);
      } else {
        // toViewPath is not doubled, use as-is
        basePath = toViewPath;
      }

      return {
        targetView: basePath,                    // [main] - where we're going
        animationStartView: [...basePath, gridId]  // [main, main] - where we are
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
