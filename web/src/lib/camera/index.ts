/**
 * Camera helpers for game camera implementation.
 *
 * This module provides clean APIs for:
 * - Navigating the grid hierarchy by name
 * - Calculating scale and offset for view paths
 * - Camera protocol for game camera controllers
 *
 * See docs/game-camera-proposal.md for design details.
 */

export { HierarchyHelper } from './hierarchy-helper.js';

export {
  getScaleAndOffset,
  type ScaleAndOffset,
} from './scale-helper.js';

export {
  type ViewPath,
  type ViewUpdate,
  type CameraController,
} from './camera-protocol.js';

export {
  ParentViewCameraController,
} from './parent-view-camera.js';

export {
  AnimatedParentViewCameraController,
} from './animated-parent-view-camera.js';
