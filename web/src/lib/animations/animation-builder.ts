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
 *
 * Note: Positions are intermediate values used to calculate displacement vectors.
 * For enter/exit movements, they're in world-space to enable computing displacement
 * across different grids. For in-grid movements, they're in grid-local space.
 * The animator converts these to group-relative animation offsets.
 */
export interface Movement {
  /** Unique identifier for the animated object (e.g., 'concrete-1', 'ref-inner-primary') */
  cellId: string;
  /** Starting position [x, y, z] - used to calculate displacement vector */
  oldPos: [number, number, number];
  /** Ending position [x, y, z] - used to calculate displacement vector */
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


function overlapSuffixPrefix(a: string[], b: string[]): string[] {
  const max = Math.min(a.length, b.length);

  // Try longer overlaps first
  for (let len = max; len > 0; len--) {
    let match = true;

    for (let i = 0; i < len; i++) {
      if (a[a.length - len + i] !== b[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      return a.slice(a.length - len);
    }
  }

  return [];
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
 * This function calculates position pairs (old/new) for each movement:
 * - For enter/exit movements: positions in world-space using hierarchy paths,
 *   enabling displacement calculation across different grids
 * - For in-grid movements: positions in grid-local space
 * - Scale ratios for visual scaling and parent compensation
 *
 * The animator will convert these position pairs into group-relative animation offsets.
 *
 * @param store - The grid store containing all grids
 * @param chain - Push chain with position and transition metadata
 * @param hierarchyHelper - Helper for navigating grid hierarchy
 * @returns Array of movements with position pairs and scale data
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
    const isEnterExit = nextEntry.transition === 'enter' ||
                        nextEntry.transition === 'exit';

    // Skip object animations for non-primary reference transitions
    // - For enter: check if viaNonPrimaryReference is true
    // - For exit: check if the destination ref cell is non-primary
    if (isEnterExit) {
      if (nextEntry.transition === 'enter' && nextEntry.viaNonPrimaryReference === true) {
        continue; // Skip animation for enter via non-primary reference
      }
      if (nextEntry.transition === 'exit') {
        // Check if exiting through a non-primary reference
        const refCell = store[newCellPos.gridId]?.cells[newCellPos.row]?.[newCellPos.col];
        if (refCell && refCell.type === 'ref' && refCell.isPrimary === false) {
          continue; // Skip animation for exit via non-primary reference
        }
      }
    }

    let oldPos: [number, number, number];
    let newPos: [number, number, number];
    let oldViewPath: string[] | null = null;
    let newViewPath: string[] | null = null;

    if (isEnterExit) {
      // For enter/exit movements, calculate positions in world-space
      // This allows us to compute the displacement vector between cells in different grids
      oldViewPath = getViewPathForGrid(oldCellPos.gridId);
      newViewPath = getViewPathForGrid(newCellPos.gridId);

      if (!oldViewPath || !newViewPath) {
        console.warn(`  [WARN] Skipping animation for ${cellId}: could not determine view paths`);
        console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col}), transition: ${nextEntry.transition}`);
        continue;
      }

      // Special case: self-reference enter/exit
      // For self-reference transitions, skip object animation entirely
      // The camera zoom animation provides the visual transition
      // Object animations don't make sense here because the coordinate systems
      // are the same grid at different zoom levels
      const isSelfReference = oldCellPos.gridId === newCellPos.gridId;
      if (isSelfReference) {
        continue;
      } else {
        // Normal enter/exit: find overlapping coordinate system
        if (nextEntry.transition === 'enter') {
          oldViewPath = overlapSuffixPrefix(oldViewPath, newViewPath);
          if (oldViewPath.length === 0) {
            console.warn(`  [WARN] Skipping animation for ${cellId}: no overlap between view paths`);
            console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col}), transition: ${nextEntry.transition}`);
            continue;
          }
        }
        else {
          newViewPath = overlapSuffixPrefix(newViewPath, oldViewPath);
          if (newViewPath.length === 0) {
            console.warn(`  [WARN] Skipping animation for ${cellId}: no overlap between view paths`);
            console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col}), transition: ${nextEntry.transition}`);
            continue;
          }
        }
      }

      // Get world-space positions for both the start and end of the movement
      // These will be used to calculate the displacement vector (oldPos - newPos)
      const oldWorldPos = getCellWorldPosition(store, oldViewPath, oldCellPos);
      const newWorldPos = getCellWorldPosition(store, newViewPath, newCellPos);

      if (!oldWorldPos || !newWorldPos) {
        console.warn(`  [WARN] Skipping animation for ${cellId}: could not calculate world positions`);
        console.warn(`    Old path: ${oldViewPath.join(' → ')}, New path: ${newViewPath.join(' → ')}`);
        console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col}), transition: ${nextEntry.transition}`);
        continue;
      }

      oldPos = [oldWorldPos.x, oldWorldPos.y, oldWorldPos.z];
      newPos = [newWorldPos.x, newWorldPos.y, newWorldPos.z];

      // Sanity check: even for enter/exit, cell coordinates shouldn't be too far apart
      // (more than a few cells suggests something might be wrong)
      const cellRowDist = Math.abs(newCellPos.row - oldCellPos.row);
      const cellColDist = Math.abs(newCellPos.col - oldCellPos.col);
      const maxCellDist = Math.max(cellRowDist, cellColDist);
      if (maxCellDist > 5) {
        console.warn(`  [WARN] ${cellId}: Enter/exit movement has large cell coordinate displacement (${maxCellDist} cells)`);
        console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), transition: ${nextEntry.transition}`);
        console.warn(`    New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col})`);
        console.warn(`    This might indicate incorrect world position calculation`);
      }
    } else {
      // For in-grid movements, use grid-local coordinates
      // Cell centers are at (col + 0.5, row + 0.5) in grid-local space
      // where each cell is 1x1 units
      oldPos = [oldCellPos.col + 0.5, 0, oldCellPos.row + 0.5];
      newPos = [newCellPos.col + 0.5, 0, newCellPos.row + 0.5];

      // Sanity check: in-grid movements should be exactly 1 cell (Manhattan distance)
      const manhattanDist = Math.abs(newCellPos.row - oldCellPos.row) +
                           Math.abs(newCellPos.col - oldCellPos.col);
      if (manhattanDist !== 1) {
        console.warn(`  [WARN] ${cellId}: In-grid movement is ${manhattanDist} cells (expected 1)`);
        console.warn(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col})`);
        console.warn(`    New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col})`);
      }
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
        console.warn(`  ${cellId}: Could not calculate scale values for enter/exit transition - skipping animation`);
        continue; // Skip animation; object will jump to destination
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
