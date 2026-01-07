/**
 * Animation builder utilities for converting push operations into animations.
 *
 * This module provides functions to analyze push chains and generate
 * animation data (positions, transitions) for rendering smooth movements.
 */

import type { GridStore } from '../core/types.js';
import { isConcrete } from '../core/types.js';
import type { PushChain } from '../operations/push.js';
import { getCellWorldPosition, getRelativeScale } from '../camera/scale-helper.js';
import type { HierarchyHelper } from '../camera/hierarchy-helper.js';

/**
 * Represents a single object movement animation.
 */
export interface Movement {
  /** Unique identifier for the animated object (e.g., 'concrete-1', 'ref-inner-primary') */
  cellId: string;
  /** Starting position in world coordinates [x, y, z] */
  oldPos: [number, number, number];
  /** Ending position in world coordinates [x, y, z] */
  newPos: [number, number, number];
  /** Whether this movement crosses grid boundaries (enter/exit transition) */
  isEnterExit: boolean;
  /**
   * Visual scale ratio for the scale animation (oldCellSize / newCellSize).
   * Represents the visual size change the object undergoes during enter/exit.
   * Only present when isEnterExit is true.
   * - Value > 1: moving to smaller cells (object shrinks visually)
   * - Value < 1: moving to larger cells (object grows visually)
   */
  visualScaleRatio?: number;
  /**
   * Parent scale compensation for translation offset (rootCellSize / destCellSize).
   * Used to compensate for cumulative parent template scaling in the scene hierarchy.
   * The destination object is nested inside scaled templates, so animation offsets
   * must be scaled up by this amount to achieve the correct visual movement.
   * Only present when isEnterExit is true.
   */
  parentScaleCompensation?: number;
}

/**
 * Convert a push chain to movement animations.
 * The chain represents positions and their cells BEFORE the push.
 * After a push, cells rotate forward: each cell moves to the next position in the chain.
 *
 * Example: [(pos0, A), (pos1, B), (pos2, Empty)]
 * After rotation: pos0←Empty, pos1←A, pos2←B
 * Movements: A(pos0→pos1), B(pos1→pos2), Empty(pos2→pos0)
 *
 * This function calculates movements in objective world coordinates by using
 * the hierarchy helper to determine each cell's path through the grid hierarchy.
 * Movements are independent of the camera's current view.
 *
 * @param store - The grid store containing all grids
 * @param chain - Push chain with position and transition metadata
 * @param hierarchyHelper - Helper for navigating grid hierarchy
 * @returns Array of movements with world coordinates
 */
export function chainToMovements(
  store: GridStore,
  chain: PushChain,
  hierarchyHelper: HierarchyHelper
): Movement[] {
  const movements: Movement[] = [];

  if (chain.length === 0) return movements;

  // Helper function to get the view path for a grid using the hierarchy helper
  const getViewPathForGrid = (gridId: string): string[] | null => {
    const ancestorChain = hierarchyHelper.getAncestorChain(gridId);
    if (!ancestorChain) {
      console.warn(`Could not compute ancestor chain for grid '${gridId}'`);
      return null;
    }
    // Reverse the chain to get a view path [root, ..., parent, gridId]
    return [...ancestorChain].reverse();
  };

  // For each cell in the chain, determine its movement
  // Cell at position[i] moves to position[i+1] (with wraparound in the FULL chain)
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const cell = entry.cell;
    const oldCellPos = entry.position;

    // Only animate non-empty cells
    if (cell.type === 'empty') continue;

    // Find the next position in the FULL chain (with wraparound)
    const nextIndex = (i + 1) % chain.length;
    const nextEntry = chain[nextIndex];
    const newCellPos = nextEntry.position;

    // Skip if cell didn't actually move (same position)
    if (oldCellPos.equals(newCellPos)) continue;

    // Generate cell ID for animation
    // Must match the ID generation in isometric.ts renderGridDirect
    let cellId: string;
    if (isConcrete(cell)) {
      cellId = `concrete-${cell.id}`;
    } else if (cell.type === 'ref') {
      const primarySuffix = cell.isPrimary === true ? 'primary' :
                            cell.isPrimary === false ? 'secondary' :
                            'auto';
      cellId = `ref-${cell.gridId}-${primarySuffix}`;
    } else {
      continue; // Unknown cell type
    }

    // Determine if this is a cross-grid movement (enter/exit transition)
    const isEnterExit = //oldCellPos.gridId !== newCellPos.gridId ||
                        nextEntry.transition === 'enter' ||
                        nextEntry.transition === 'exit';

    let oldPos: [number, number, number];
    let newPos: [number, number, number];
    let oldViewPath: string[] | null = null;
    let newViewPath: string[] | null = null;

    if (isEnterExit) {
      // For enter/exit movements, use world coordinates
      oldViewPath = getViewPathForGrid(oldCellPos.gridId);
      newViewPath = getViewPathForGrid(newCellPos.gridId);

      if (!oldViewPath || !newViewPath) {
        console.warn(`  [WARN] Skipping animation for ${cellId}: could not determine view paths`);
        console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col})`);
        continue;
      }

      // Calculate world positions using the hierarchy-determined view paths
      const oldWorldPos = getCellWorldPosition(store, oldViewPath, oldCellPos);
      const newWorldPos = getCellWorldPosition(store, newViewPath, newCellPos);

      if (!oldWorldPos || !newWorldPos) {
        console.warn(`  [WARN] Skipping animation for ${cellId}: could not calculate world positions`);
        console.warn(`    Old path: ${oldViewPath.join(' → ')}, New path: ${newViewPath.join(' → ')}`);
        console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col})`);
        continue;
      }

      oldPos = [oldWorldPos.x, oldWorldPos.y, oldWorldPos.z];
      newPos = [newWorldPos.x, newWorldPos.y, newWorldPos.z];
    } else {
      // For in-grid movements, use grid-local coordinates
      // Cell centers are at (col + 0.5, row + 0.5) in grid-local space
      // where each cell is 1x1 units
      oldPos = [oldCellPos.col + 0.5, 0, oldCellPos.row + 0.5];
      newPos = [newCellPos.col + 0.5, 0, newCellPos.row + 0.5];
    }

    // Calculate scale values for enter/exit movements
    let visualScaleRatio: number | undefined;
    let parentScaleCompensation: number | undefined;

    if (isEnterExit) {
      // Visual scale for the scale animation (old -> new)
      const visualScale = getRelativeScale(store, oldViewPath!, newViewPath!);
      if (visualScale !== null) {
        visualScaleRatio = visualScale;
      }

      // Parent scale compensation for translation offset (root -> new)
      const rootViewPath = [newViewPath![0]]; // Just the root grid
      const parentCompensation = getRelativeScale(store, rootViewPath, newViewPath!);
      if (parentCompensation !== null) {
        parentScaleCompensation = parentCompensation;
      }

      if (visualScaleRatio === undefined || parentScaleCompensation === undefined) {
        console.warn(`  ${cellId}: Could not calculate scale values for enter/exit transition`);
      }
    }

    movements.push({
      cellId,
      oldPos,
      newPos,
      isEnterExit,
      visualScaleRatio,
      parentScaleCompensation
    });
  }

  return movements;
}
