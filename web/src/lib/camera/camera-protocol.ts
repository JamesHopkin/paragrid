/**
 * Camera Protocol - Interface for game camera view providers.
 *
 * A view provider determines which grid path should be displayed based on
 * the player's current position. Views are represented as paths through the
 * grid hierarchy (array of grid IDs from root to target).
 *
 * See docs/game-camera-proposal.md for design details.
 */

import type { GridStore } from '../core/types.js';

/**
 * A view is represented by a path of grid names from root to target.
 * The scale helper can convert this path into camera position and scale.
 *
 * Example: ['main', 'inner'] means viewing the 'inner' grid which is
 * referenced by 'main'.
 */
export type ViewPath = readonly string[];

/**
 * View update returned by the camera controller.
 * Contains the target view and optionally an animation start view.
 */
export interface ViewUpdate {
  /**
   * The target view path to display.
   * Must start with a root grid.
   */
  readonly targetView: ViewPath;

  /**
   * Optional animation start view for smooth transitions.
   * If provided, the camera should animate from this view to targetView.
   * If not provided, no animation is performed (instant jump to targetView).
   *
   * This is useful for handling visually equivalent views in cycles.
   * For example, when transitioning from 'a.b' to 'a.b.a.b', both views
   * focus on the same content but the animation provides continuity.
   */
  readonly animationStartView?: ViewPath;
}

/**
 * Camera view provider interface.
 *
 * Implementations determine which view path to display based on player position
 * and grid transitions. The view provider protocol cleanly separates camera
 * logic from rendering logic.
 */
export interface CameraController {
  /**
   * Get initial view when the game starts.
   *
   * @param store - The grid store
   * @param playerGridId - The grid containing the player
   * @returns Initial view update
   */
  getInitialView(store: GridStore, playerGridId: string): ViewUpdate;

  /**
   * Get view update when player enters a new grid (through a reference cell).
   *
   * @param store - The grid store
   * @param fromGridId - Grid the player is leaving
   * @param toGridId - Grid the player is entering
   * @returns View update, potentially with animation start view
   */
  onPlayerEnter(
    store: GridStore,
    fromGridId: string,
    toGridId: string
  ): ViewUpdate;

  /**
   * Get view update when player exits a grid (moving out of a reference cell).
   *
   * @param store - The grid store
   * @param fromGridId - Grid the player is leaving
   * @param toGridId - Grid the player is entering
   * @returns View update, potentially with animation start view
   */
  onPlayerExit(
    store: GridStore,
    fromGridId: string,
    toGridId: string
  ): ViewUpdate;

  /**
   * Get view update when player moves within the same grid (no enter/exit).
   * Most camera controllers will keep the same view for within-grid movement.
   *
   * @param store - The grid store
   * @param gridId - Grid the player is moving within
   * @returns View update (typically unchanged from previous view)
   */
  onPlayerMove(store: GridStore, gridId: string): ViewUpdate;
}
