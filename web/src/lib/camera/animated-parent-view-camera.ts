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


// may need to generalise but handle this first
function isFromSelfReference(fromPath: ViewPath, toPath: ViewPath) {
  return fromPath.length == 2 && toPath.length == 2 &&
    fromPath[0] === fromPath[1] && fromPath[0] ===  toPath[0];
}

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
    }
  }

  /**
   * Handle player entering a grid - animate from previous view.
   * Creates a zoom-in effect as the camera focuses on the entered grid.
   */
  onPlayerEnter(fromGridId: string, toGridId: string): ViewUpdate {
    const toViewPath = buildViewPath(this.helper, toGridId);
    const fromViewPath = buildViewPath(this.helper, fromGridId);

    return {
      targetView: isFromSelfReference(fromViewPath, toViewPath)
        ? [fromViewPath[0], ...toViewPath] : toViewPath,
      animationStartView: buildViewPath(this.helper, fromGridId),
    };
  }

  /**
   * Handle player exiting a grid - animate from previous view.
   * Creates a zoom-out effect as the camera pulls back to show context.
   */
  onPlayerExit(fromGridId: string, toGridId: string): ViewUpdate {
    const toViewPath = buildViewPath(this.helper, toGridId);
    const fromViewPath = buildViewPath(this.helper, fromGridId);

    return {
      targetView: toViewPath,
      animationStartView: isFromSelfReference(toViewPath, fromViewPath)
        ? [fromViewPath[0], ...fromViewPath] : fromViewPath,
    };
  }

  /**
   * Handle player moving within the same grid - no animation needed.
   * The view typically doesn't change for within-grid movement.
   */
  onPlayerMove(gridId: string): ViewUpdate {
    return { targetView: buildViewPath(this.helper, gridId) };
  }
}
