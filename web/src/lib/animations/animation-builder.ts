/**
 * Animation builder utilities for converting push operations into animations.
 *
 * This module provides functions to analyze push chains and generate
 * animation data (positions, transitions) for rendering smooth movements.
 */

import type { GridStore } from '../core/types.js';
import { isConcrete } from '../core/types.js';
import type { PushChain } from '../operations/push.js';
import type { ViewPath } from '../camera/camera-protocol.js';
import { getCellWorldPosition } from '../camera/scale-helper.js';

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
 * This function handles ALL movements including enter/exit transitions by using
 * world coordinates calculated from the appropriate view paths.
 *
 * @param store - The grid store containing all grids
 * @param chain - Push chain with position and transition metadata
 * @param previousViewPath - View path before the push (for calculating old positions)
 * @param currentViewPath - View path after the push (for calculating new positions)
 * @returns Array of movements with world coordinates
 */
export function chainToMovements(
  store: GridStore,
  chain: PushChain,
  previousViewPath: ViewPath,
  currentViewPath: ViewPath
): Movement[] {
  const movements: Movement[] = [];

  if (chain.length === 0) return movements;

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

    // Determine if this is a within-grid movement or enter/exit transition
    // We only care about the DESTINATION transition (nextEntry), not how we got to the old position
    const isWithinGrid = oldCellPos.gridId === newCellPos.gridId &&
                        nextEntry.transition !== 'enter' &&
                        nextEntry.transition !== 'exit';

    let oldPos: [number, number, number];
    let newPos: [number, number, number];

    if (isWithinGrid) {
      // Within-grid movement: use simple grid coordinate offsets (legacy behavior)
      // These are relative positions in grid space where each cell = 1 unit
      oldPos = [oldCellPos.col, 0, oldCellPos.row];
      newPos = [newCellPos.col, 0, newCellPos.row];
      console.log(`  ${cellId}: [${oldPos[0]}, ${oldPos[2]}] -> [${newPos[0]}, ${newPos[2]}] (within-grid)`);
    } else {
      // Enter/exit transition: use world coordinate transformations
      let oldWorldPos = getCellWorldPosition(store, previousViewPath, oldCellPos);
      let newWorldPos = getCellWorldPosition(store, currentViewPath, newCellPos);

      // If either position can't be calculated, try using current view for both
      // (fallback for edge cases)
      if (!oldWorldPos) {
        oldWorldPos = getCellWorldPosition(store, currentViewPath, oldCellPos);
      }
      if (!newWorldPos) {
        newWorldPos = getCellWorldPosition(store, previousViewPath, newCellPos);
      }

      if (!oldWorldPos || !newWorldPos) {
        console.log(`  [WARN] Skipping enter/exit animation for ${cellId}: could not calculate world positions`);
        console.log(`    Previous view: ${previousViewPath.join(' -> ')}, Current view: ${currentViewPath.join(' -> ')}`);
        console.log(`    Old: [${oldCellPos.gridId}](${oldCellPos.row},${oldCellPos.col}), New: [${newCellPos.gridId}](${newCellPos.row},${newCellPos.col})`);
        continue;
      }

      oldPos = [oldWorldPos.x, oldWorldPos.y, oldWorldPos.z];
      newPos = [newWorldPos.x, newWorldPos.y, newWorldPos.z];
      console.log(`  ${cellId}: [${oldPos[0].toFixed(2)}, ${oldPos[2].toFixed(2)}] -> [${newPos[0].toFixed(2)}, ${newPos[2].toFixed(2)}] (enter/exit, transition: ${nextEntry.transition})`);
    }

    movements.push({
      cellId,
      oldPos,
      newPos,
      isEnterExit: !isWithinGrid
    });
  }

  return movements;
}
