/**
 * Camera helpers for game camera implementation.
 *
 * This module provides clean APIs for:
 * - Navigating the grid hierarchy by name
 * - Calculating scale and offset for view paths
 *
 * See docs/game-camera-proposal.md for design details.
 */

export {
  getParent,
  getDirectlyContainedReferences,
  findDirectlyContainedReference,
  getPathToAncestor,
  getAncestorChain,
} from './hierarchy-helper.js';

export {
  getScaleAndOffset,
  type ScaleAndOffset,
} from './scale-helper.js';
