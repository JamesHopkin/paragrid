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
import { ParentViewCameraController } from './parent-view-camera.js';

/**
 * Camera controller with smooth animations for enter/exit transitions.
 */
export class AnimatedParentViewCameraController implements CameraController {
  private baseController: ParentViewCameraController;
  private currentView: ViewPath | null = null;

  constructor(helper: HierarchyHelper) {
    this.baseController = new ParentViewCameraController(helper);
  }

  /**
   * Get initial view - no animation for first view.
   */
  getInitialView(playerGridId: string): ViewUpdate {
    const update = this.baseController.getInitialView(playerGridId);
    this.currentView = update.targetView;
    return update;
  }

  /**
   * Handle player entering a grid - animate from previous view.
   * Creates a zoom-in effect as the camera focuses on the entered grid.
   */
  onPlayerEnter(fromGridId: string, toGridId: string): ViewUpdate {
    const update = this.baseController.onPlayerEnter(fromGridId, toGridId);
    const animatedUpdate = this.addAnimation(update);
    this.currentView = update.targetView;
    return animatedUpdate;
  }

  /**
   * Handle player exiting a grid - animate from previous view.
   * Creates a zoom-out effect as the camera pulls back to show context.
   */
  onPlayerExit(fromGridId: string, toGridId: string): ViewUpdate {
    const update = this.baseController.onPlayerExit(fromGridId, toGridId);
    const animatedUpdate = this.addAnimation(update);
    this.currentView = update.targetView;
    return animatedUpdate;
  }

  /**
   * Handle player moving within the same grid - no animation needed.
   * The view typically doesn't change for within-grid movement.
   */
  onPlayerMove(gridId: string): ViewUpdate {
    const update = this.baseController.onPlayerMove(gridId);
    this.currentView = update.targetView;
    return update;
  }

  /**
   * Add animation start view if we have a previous view.
   * Only adds animation if the view is actually changing.
   */
  private addAnimation(update: ViewUpdate): ViewUpdate {
    if (!this.currentView) {
      // No previous view - no animation
      return update;
    }

    if (this.viewPathsEqual(this.currentView, update.targetView)) {
      // View hasn't changed - no animation needed
      return update;
    }

    // Add current view as animation start
    return {
      targetView: update.targetView,
      animationStartView: this.currentView,
    };
  }

  /**
   * Compare two view paths for equality.
   */
  private viewPathsEqual(a: ViewPath, b: ViewPath): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((gridId, index) => gridId === b[index]);
  }
}
