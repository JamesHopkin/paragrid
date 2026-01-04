/**
 * Interactive isometric demo with WASD navigation.
 */

import { parseGrids } from './lib/parser/parser.js';
import type { GridStore, Grid } from './lib/core/types.js';
import type { Cell } from './lib/core/types.js';
import { Concrete, isConcrete, getGrid } from './lib/core/types.js';
import { CellPosition } from './lib/core/position.js';
import { Direction } from './lib/core/direction.js';
import { push, type PushResult } from './lib/operations/push.js';
import { createRuleSet } from './lib/operations/rules.js';
import type { PushFailure } from './lib/operations/failure.js';
import { findTaggedCell } from './lib/tagging/index.js';
import type { TagFn } from './lib/tagging/types.js';
import { analyze } from './lib/analyzer/index.js';
import { findPrimaryRef } from './lib/utils/immutable.js';
import { findHighestAncestor } from './lib/utils/hierarchy.js';
import { renderIsometric, buildIsometricScene, createParagridCamera } from './lib/renderer/isometric.js';
import { sceneToJSON, type Scene, AnimationSystem, Easing, type AnimationClip, project, Camera, Renderer, type ScreenSpace } from 'iso-render';
import type { CellNode } from './lib/analyzer/types.js';

/**
 * Interactive demo class.
 */
class IsometricDemo {
  private store: GridStore;
  private readonly originalStore: GridStore;
  private readonly tagFn: TagFn;
  private readonly playerTag = 'player';
  private statusMessage = 'Ready. Use WASD to move.';
  private readonly canvas: HTMLElement;
  private readonly statusEl: HTMLElement;
  private currentScene: Scene | null = null;
  private currentCellTree: CellNode | null = null;
  private currentCamera: any | null = null;
  private currentRenderer: Renderer | null = null;
  private animationSystem: AnimationSystem;
  private previousPlayerPosition: CellPosition | null = null;
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private isAnimating: boolean = false;
  private readonly renderWidth = 800;
  private readonly renderHeight = 600;
  private readonly allowRapidInput = true; // Set to true to cancel animations on new input
  private undoStack: GridStore[] = []; // Stack of previous states
  private redoStack: GridStore[] = []; // Stack of undone states
  private readonly maxHistorySize = 50; // Limit to prevent memory issues
  private cameraAnimationState: {
    isAnimating: boolean;
    startTime: number;
    duration: number;
    startCamera: { center: [number, number, number]; viewWidth: number };
    endCamera: { center: [number, number, number]; viewWidth: number };
  } | null = null;

  constructor(
    store: GridStore,
    tagFn: TagFn,
    canvas: HTMLElement,
    statusEl: HTMLElement
  ) {
    this.store = store;
    this.originalStore = store;
    this.tagFn = tagFn;
    this.canvas = canvas;
    this.statusEl = statusEl;
    this.animationSystem = new AnimationSystem();

    // Store initial player position
    this.previousPlayerPosition = this.playerPosition ?? null;

    this.setupKeyboardHandlers();
    this.setupExportButton();
    this.render();
  }

  private get playerPosition(): CellPosition | null | undefined {
    return findTaggedCell(this.store, this.playerTag, this.tagFn);
  }

  private setupKeyboardHandlers(): void {
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();

      // Handle undo/redo shortcuts
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
        return;
      }

      // Handle Ctrl+Y for redo (Windows convention)
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }

      // Prevent default for WASD to avoid scrolling
      if (['w', 'a', 's', 'd', 'r'].includes(key)) {
        e.preventDefault();
      }

      switch (key) {
        case 'w':
          this.attemptPush(Direction.N);
          break;
        case 's':
          this.attemptPush(Direction.S);
          break;
        case 'a':
          this.attemptPush(Direction.W);
          break;
        case 'd':
          this.attemptPush(Direction.E);
          break;
        case 'r':
          this.reset();
          break;
      }
    });
  }

  private setupExportButton(): void {
    const exportButton = document.getElementById('export-scene');
    if (exportButton) {
      exportButton.addEventListener('click', () => {
        this.exportScene();
      });
    }

    const exportSvgButton = document.getElementById('export-svg');
    if (exportSvgButton) {
      exportSvgButton.addEventListener('click', () => {
        this.exportSceneSVG();
      });
    }
  }

  private exportScene(): void {
    if (!this.currentScene) {
      console.warn('No scene available to export');
      return;
    }

    const json = sceneToJSON(this.currentScene);
    console.log('Scene JSON:');
    console.log(json);
  }

  private exportSceneSVG(): void {
    if (!this.currentRenderer) {
      console.warn('No renderer available to export SVG');
      return;
    }

    // Get the SVG element from the canvas
    const svgElement = this.canvas.querySelector('svg');
    if (!svgElement) {
      console.warn('No SVG element found in canvas');
      return;
    }

    // Serialize the SVG to a string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);

    // Create a Blob and download link
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paragrid-scene.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('SVG exported successfully');
  }

  private attemptPush(direction: Direction): void {
    // Handle input during animation based on allowRapidInput setting
    if (this.isAnimating) {
      if (this.allowRapidInput) {
        // Cancel current animation and proceed with new input
        this.cancelCurrentAnimation();
      } else {
        // Block input during animation
        return;
      }
    }

    const playerPos = this.playerPosition;

    if (!playerPos) {
      this.statusMessage = '❌ Error: No player found!';
      this.render();
      return;
    }

    const result = push(
      this.store,
      playerPos,
      direction,
      createRuleSet(),
      this.tagFn
    );

    if (this.isPushFailure(result)) {
      // Push failed - just update status and render
      this.statusMessage = `❌ Push ${direction} failed: ${result.reason}`;
      if (result.details) {
        this.statusMessage += ` (${result.details})`;
      }
      this.render(true);
      this.updateStatus();
      return;
    }

    // Success - save current state to undo stack before updating
    this.undoStack.push(this.store);
    // Limit history size
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift(); // Remove oldest entry
    }
    // Clear redo stack since we're performing a new action
    this.redoStack = [];

    // Update store and get push chain
    this.store = result.store;
    const pushChain = result.chain;

    // DEBUG: Log the full push chain
    console.log('=== PUSH CHAIN ===');
    for (const entry of pushChain) {
      const pos = entry.position;
      const cell = entry.cell;
      const cellType = cell.type === 'concrete' ? `Concrete(${cell.id})` :
                       cell.type === 'ref' ? `Ref(${cell.gridId})` :
                       cell.type === 'empty' ? 'Empty' : 'Unknown';
      console.log(`  [${pos.gridId}:${pos.row},${pos.col}] ${cellType} - transition: ${entry.transition}`);
    }

    // Find new player position
    const newPos = this.playerPosition;
    if (newPos) {
      this.statusMessage = `✓ Pushed ${direction}! Player at [${newPos.row}, ${newPos.col}]`;

      // Check if we changed grids (enter/exit transitions)
      const changedGrids = playerPos.gridId !== newPos.gridId;

      if (changedGrids) {
        // Grid transition (exit/enter) - add camera animation
        // Detect transition type and start camera animation
        const transition = this.detectGridTransition(pushChain, playerPos.gridId, newPos.gridId);

        if (transition) {
          // Calculate camera animation parameters
          const cameraTransition = this.calculateCameraTransition(
            transition.type,
            playerPos,
            newPos
          );

          if (cameraTransition) {
            // Rebuild scene immediately with new player position
            // But DON'T cancel the animation state - we'll animate the camera
            this.animationSystem.stop();
            this.isAnimating = true; // Keep animating for camera
            if (this.animationFrameId !== null) {
              cancelAnimationFrame(this.animationFrameId);
              this.animationFrameId = null;
            }
            // Clear scene to force rebuild with new grid
            this.currentScene = null;
            this.currentCellTree = null;
            this.currentRenderer = null;

            // Start camera animation
            this.startCameraAnimation(cameraTransition.start, cameraTransition.end);

            // Rebuild scene with new player position, then start animation loop
            this.render(true);
            this.startAnimationLoop();
          } else {
            // No camera animation - rebuild immediately
            this.rebuildSceneForGridTransition();
          }
        } else {
          // No transition detected - rebuild immediately
          this.rebuildSceneForGridTransition();
        }
      } else {
        // Same grid - convert push chain to movements and animate
        const movements = this.chainToMovements(pushChain, playerPos.gridId);

        if (movements.length > 0) {
          // Create animations for all movements
          this.createMultipleMovementAnimations(movements);
        } else {
          // No animation - render immediately
          this.render(true);
        }
      }

      // Update previous position for next movement
      this.previousPlayerPosition = newPos;
    } else {
      this.statusMessage = '✓ Push succeeded but player lost!';
      this.render(true);
    }
  }

  private isPushFailure(result: PushResult | PushFailure): result is PushFailure {
    return 'reason' in result && 'position' in result;
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
   * IMPORTANT: This function only creates animations for simple single-square movements
   * within the same grid. Exit/enter transitions are NOT animated.
   *
   * The transition metadata on each entry describes HOW we arrived at that position.
   * To determine if a movement should be animated, we check the DESTINATION's transition.
   */
  private chainToMovements(chain: import('./lib/operations/push.js').PushChain, targetGridId: string): Array<{
    cellId: string;
    oldPos: CellPosition;
    newPos: CellPosition;
  }> {
    const movements: Array<{ cellId: string; oldPos: CellPosition; newPos: CellPosition }> = [];

    if (chain.length === 0) return movements;

    // For each cell in the chain, determine its movement
    // Cell at position[i] moves to position[i+1] (with wraparound in the FULL chain)
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      const cell = entry.cell;
      const oldPos = entry.position;

      // Only process entries in the target grid
      if (oldPos.gridId !== targetGridId) continue;

      // Find the next position in the FULL chain (with wraparound)
      const nextIndex = (i + 1) % chain.length;
      const nextEntry = chain[nextIndex];
      const newPos = nextEntry.position;

      // Only animate if BOTH source and destination are in the target grid
      if (newPos.gridId !== targetGridId) {
        console.log(`  Skipping animation for cell at ${oldPos}: destination ${newPos} is in different grid`);
        continue;
      }

      // Only animate non-empty cells
      if (cell.type === 'empty') continue;

      // Skip if cell didn't actually move (same position)
      if (oldPos.equals(newPos)) continue;

      // Check the DESTINATION's transition to see what kind of movement this is
      // Skip animations for enter/exit transitions - we only animate simple moves
      if (nextEntry.transition === 'enter' || nextEntry.transition === 'exit') {
        console.log(`  Skipping animation for cell at ${oldPos} -> ${newPos}: destination transition is ${nextEntry.transition}`);
        continue;
      }

      // Only animate single-square movements
      if (!this.isSingleSquareMovement(oldPos, newPos)) continue;

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

      movements.push({ cellId, oldPos, newPos });
    }

    return movements;
  }

  /**
   * Snapshot all concrete and reference cell positions in a grid.
   * Returns array of {cell, position} for tracking.
   */
  private snapshotCellPositions(gridId: string): Array<{ cell: Cell; position: CellPosition }> {
    const snapshot: Array<{ cell: Cell; position: CellPosition }> = [];
    const grid = getGrid(this.store, gridId);
    if (!grid) return snapshot;

    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const cell = grid.cells[row]?.[col];
        if (cell && (isConcrete(cell) || cell.type === 'ref')) {
          snapshot.push({
            cell,
            position: new CellPosition(gridId, row, col)
          });
        }
      }
    }

    return snapshot;
  }

  /**
   * Detect which cells moved one square within the same grid.
   * Returns an array of {cellId, oldPos, newPos} for cells that moved exactly one square.
   */
  private detectMovements(gridId: string, oldSnapshot: Array<{ cell: Cell; position: CellPosition }>): Array<{
    cellId: string;
    oldPos: CellPosition;
    newPos: CellPosition;
  }> {
    const movements: Array<{ cellId: string; oldPos: CellPosition; newPos: CellPosition }> = [];
    const grid = getGrid(this.store, gridId);
    if (!grid) return movements;

    // Check all cells in the new state
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const newCell = grid.cells[row]?.[col];
        if (!newCell) continue;

        const newPos = new CellPosition(gridId, row, col);

        // Find matching cell in old snapshot
        let oldPos: CellPosition | null = null;
        let cellKey: string | null = null;

        if (isConcrete(newCell)) {
          // For concrete cells, match by ID
          // First check if there's an exact position match (cell didn't move)
          const matches = oldSnapshot.filter(s => isConcrete(s.cell) && s.cell.id === newCell.id);
          const exactMatch = matches.find(m => m.position.row === newPos.row && m.position.col === newPos.col);

          if (exactMatch) {
            // Cell didn't move - don't animate
            continue;
          }

          // No exact match - find the cell that moved here (one square away)
          for (const match of matches) {
            if (this.isSingleSquareMovement(match.position, newPos)) {
              oldPos = match.position;
              cellKey = `concrete-${newCell.id}`;
              break;
            }
          }
        } else if (newCell.type === 'ref') {
          // For reference cells, match by gridId AND isPrimary
          // This ensures we distinguish between multiple refs to the same grid
          const matches = oldSnapshot.filter(s =>
            s.cell.type === 'ref' &&
            s.cell.gridId === newCell.gridId &&
            s.cell.isPrimary === newCell.isPrimary
          );
          const exactMatch = matches.find(m => m.position.row === newPos.row && m.position.col === newPos.col);

          if (exactMatch) {
            // Cell didn't move - don't animate
            continue;
          }

          // No exact match - find one that moved one square
          for (const match of matches) {
            if (this.isSingleSquareMovement(match.position, newPos)) {
              oldPos = match.position;
              const primarySuffix = newCell.isPrimary === true ? 'primary' :
                                    newCell.isPrimary === false ? 'secondary' :
                                    'auto';
              cellKey = `ref-${newCell.gridId}-${primarySuffix}`;
              break;
            }
          }
        }

        // If we found a match, add it to movements
        if (oldPos && cellKey) {
          movements.push({ cellId: cellKey, oldPos, newPos });
        }
      }
    }

    return movements;
  }

  /**
   * Cancel any currently running animation.
   */
  private cancelCurrentAnimation(): void {
    this.animationSystem.stop();
    this.isAnimating = false;
    this.cameraAnimationState = null; // Cancel camera animation
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Remove animation clip to clear transform overrides
    this.animationSystem.removeClip('push-move');
    // Force render to show the final state
    this.render(true);
  }

  private reset(): void {
    this.store = this.originalStore;
    this.statusMessage = 'Grid reset to original state';
    this.previousPlayerPosition = this.playerPosition ?? null;
    this.cancelCurrentAnimation();
    // Clear both stacks when resetting
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  private undo(): void {
    if (this.undoStack.length === 0) {
      this.statusMessage = '⚠️ Nothing to undo';
      this.updateStatus();
      return;
    }

    // Cancel any ongoing animation
    this.cancelCurrentAnimation();

    // Save current state to redo stack
    this.redoStack.push(this.store);

    // Pop previous state from undo stack
    const previousState = this.undoStack.pop()!;
    this.store = previousState;

    // Update player position tracking
    this.previousPlayerPosition = this.playerPosition ?? null;

    // Full scene rebuild needed
    this.currentScene = null;
    this.currentCellTree = null;
    this.currentRenderer = null;

    this.statusMessage = '↶ Undo successful';
    this.render(true);
  }

  private redo(): void {
    if (this.redoStack.length === 0) {
      this.statusMessage = '⚠️ Nothing to redo';
      this.updateStatus();
      return;
    }

    // Cancel any ongoing animation
    this.cancelCurrentAnimation();

    // Save current state to undo stack
    this.undoStack.push(this.store);
    // Limit history size
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    // Pop state from redo stack
    const nextState = this.redoStack.pop()!;
    this.store = nextState;

    // Update player position tracking
    this.previousPlayerPosition = this.playerPosition ?? null;

    // Full scene rebuild needed
    this.currentScene = null;
    this.currentCellTree = null;
    this.currentRenderer = null;

    this.statusMessage = '↷ Redo successful';
    this.render(true);
  }

  /**
   * Check if movement is exactly one square within the same grid
   */
  private isSingleSquareMovement(oldPos: CellPosition, newPos: CellPosition): boolean {
    // Must be in the same grid
    if (oldPos.gridId !== newPos.gridId) {
      return false;
    }

    // Calculate the movement distance
    const rowDiff = Math.abs(newPos.row - oldPos.row);
    const colDiff = Math.abs(newPos.col - oldPos.col);

    // Must move exactly one square in one direction only
    return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
  }

  /**
   * Create animations for multiple cells that moved one square.
   */
  private createMultipleMovementAnimations(movements: Array<{
    cellId: string;
    oldPos: CellPosition;
    newPos: CellPosition;
  }>): void {
    if (movements.length === 0) return;

    const duration = 0.3; // 300ms animation

    // Remove any existing animation clip to avoid conflicts
    this.animationSystem.removeClip('push-move');

    // Build animations for all movements
    // Hierarchy is at NEW position, animate FROM old position (negative offset)
    const animations: Array<{
      nodeId: string;
      channels: Array<{
        target: 'position' | 'rotation' | 'scale';
        interpolation: 'linear';
        keyFrames: Array<{ time: number; value: [number, number, number]; easing?: any }>;
      }>;
    }> = [];

    for (const movement of movements) {
      const relativeOffset: [number, number, number] = [
        movement.oldPos.col - movement.newPos.col,
        0,
        movement.oldPos.row - movement.newPos.row
      ];
      const targetPos: [number, number, number] = [0, 0, 0];

      console.log(`  ${movement.cellId}: [${relativeOffset}] -> [${targetPos}]`);

      animations.push({
        nodeId: movement.cellId,
        channels: [{
          target: 'position',
          interpolation: 'linear',
          keyFrames: [
            { time: 0, value: relativeOffset, easing: Easing.easeInQuad },
            { time: duration, value: targetPos }
          ]
        }]
      });
    }

    // Create animation clip
    const animationClip: AnimationClip = {
      id: 'push-move',
      duration,
      loop: false,
      animations
    };

    // Rebuild scene data
    this.rebuildSceneData();

    // Add and play the animation
    this.animationSystem.addClip(animationClip);
    this.animationSystem.play('push-move');

    // Set animation flag
    this.isAnimating = true;

    // Start the animation loop
    this.startAnimationLoop();
  }

  /**
   * Start the animation loop using requestAnimationFrame
   */
  private startAnimationLoop(): void {
    if (this.animationFrameId !== null) {
      return; // Already running
    }

    this.lastFrameTime = performance.now();

    const animate = (currentTime: number): void => {
      const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
      this.lastFrameTime = currentTime;

      // Update cell animation system
      this.animationSystem.update(deltaTime);

      // Update camera animation if active
      let cameraOverride: { center: [number, number, number]; viewWidth: number } | undefined = undefined;
      if (this.cameraAnimationState?.isAnimating) {
        const elapsed = currentTime - this.cameraAnimationState.startTime;
        const progress = Math.min(elapsed / this.cameraAnimationState.duration, 1.0);
        const easedProgress = Easing.easeInQuad(progress);

        // Interpolate camera parameters
        cameraOverride = this.interpolateCamera(
          this.cameraAnimationState.startCamera,
          this.cameraAnimationState.endCamera,
          easedProgress
        );

        if (progress >= 1.0) {
          // Camera animation complete
          this.cameraAnimationState = null;
        }
      }

      // Re-render with camera override if present
      this.render(false, cameraOverride);

      // Continue if either animation is active
      const cellAnimating = this.animationSystem.getState().playing;
      const cameraAnimating = this.cameraAnimationState?.isAnimating ?? false;

      if (cellAnimating || cameraAnimating) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        // All animations complete - clean up and render final state
        this.animationFrameId = null;
        this.isAnimating = false;

        // Remove animation clip so transform overrides are cleared
        this.animationSystem.removeClip('push-move');
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Detect if a push chain contains a grid transition (enter or exit).
   */
  private detectGridTransition(
    chain: ReadonlyArray<{ readonly position: CellPosition; readonly transition: 'enter' | 'exit' | 'move' | null }>,
    oldGridId: string,
    newGridId: string
  ): { type: 'enter' | 'exit'; refGridId: string } | null {
    // Check if grid changed
    if (oldGridId === newGridId) return null;

    // Scan chain for 'enter' or 'exit' transition
    for (const entry of chain) {
      if (entry.transition === 'enter') {
        return { type: 'enter', refGridId: entry.position.gridId };
      }
      if (entry.transition === 'exit') {
        return { type: 'exit', refGridId: oldGridId };
      }
    }
    return null;
  }

  /**
   * Calculate camera start and end states for grid transition animation.
   */
  private calculateCameraTransition(
    transitionType: 'enter' | 'exit',
    oldPlayerPos: CellPosition,
    newPlayerPos: CellPosition
  ): { start: { center: [number, number, number]; viewWidth: number }; end: { center: [number, number, number]; viewWidth: number } } | null {
    if (transitionType === 'enter') {
      // Entering a referenced grid
      // Start: Normal camera view of parent grid
      // End: Zoomed camera view of reference cell in parent grid

      const oldGrid = getGrid(this.store, oldPlayerPos.gridId);
      if (!oldGrid) return null;

      const oldMaxDim = Math.max(oldGrid.rows, oldGrid.cols);
      const oldViewWidth = oldMaxDim * 1.2;
      const startCamera = {
        center: [0, 0, 0] as [number, number, number],
        viewWidth: oldViewWidth
      };

      // Find where the reference cell is in the parent grid
      const primaryRef = findPrimaryRef(this.store, newPlayerPos.gridId);
      if (!primaryRef) return null;

      const [parentGridId, refRow, refCol] = primaryRef;
      if (parentGridId !== oldPlayerPos.gridId) return null; // Safety check

      const parentGrid = getGrid(this.store, parentGridId);
      if (!parentGrid) return null;

      // Calculate world position of reference cell
      const centerX = (parentGrid.cols - 1) / 2;
      const centerZ = (parentGrid.rows - 1) / 2;
      const refX = refCol - centerX;
      const refZ = refRow - centerZ;

      const endCamera = {
        center: [refX, 0, refZ] as [number, number, number],
        viewWidth: 1.2
      };

      return { start: startCamera, end: endCamera };
    } else {
      // Exiting a referenced grid
      // Start: Zoomed camera view of reference cell in parent grid
      // End: Normal camera view of target grid

      const primaryRef = findPrimaryRef(this.store, oldPlayerPos.gridId);
      if (!primaryRef) return null;

      const [parentGridId, refRow, refCol] = primaryRef;
      const parentGrid = getGrid(this.store, parentGridId);
      if (!parentGrid) return null;

      // Calculate world position of reference cell
      const centerX = (parentGrid.cols - 1) / 2;
      const centerZ = (parentGrid.rows - 1) / 2;
      const refX = refCol - centerX;
      const refZ = refRow - centerZ;

      const startCamera = {
        center: [refX, 0, refZ] as [number, number, number],
        viewWidth: 1.2
      };

      const newGrid = getGrid(this.store, newPlayerPos.gridId);
      if (!newGrid) return null;

      const newMaxDim = Math.max(newGrid.rows, newGrid.cols);
      const newViewWidth = newMaxDim * 1.2;
      const endCamera = {
        center: [0, 0, 0] as [number, number, number],
        viewWidth: newViewWidth
      };

      return { start: startCamera, end: endCamera };
    }
  }

  /**
   * Interpolate between two camera states.
   */
  private interpolateCamera(
    start: { center: [number, number, number]; viewWidth: number },
    end: { center: [number, number, number]; viewWidth: number },
    progress: number
  ): { center: [number, number, number]; viewWidth: number } {
    return {
      center: [
        start.center[0] + (end.center[0] - start.center[0]) * progress,
        start.center[1] + (end.center[1] - start.center[1]) * progress,
        start.center[2] + (end.center[2] - start.center[2]) * progress
      ],
      viewWidth: start.viewWidth + (end.viewWidth - start.viewWidth) * progress
    };
  }

  /**
   * Start a camera animation with the given start and end states.
   */
  private startCameraAnimation(
    start: { center: [number, number, number]; viewWidth: number },
    end: { center: [number, number, number]; viewWidth: number }
  ): void {
    this.cameraAnimationState = {
      isAnimating: true,
      startTime: performance.now(),
      duration: 300, // Match push animation duration
      startCamera: start,
      endCamera: end
    };
  }

  /**
   * Rebuild scene after grid transition (helper method)
   */
  private rebuildSceneForGridTransition(): void {
    this.animationSystem.stop();
    this.isAnimating = false;
    this.cameraAnimationState = null;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Clear everything to force complete rebuild with new grid as root
    this.currentScene = null;
    this.currentCellTree = null;
    this.currentRenderer = null;
    this.render(true);
  }

  /**
   * Determine which grid to render and camera scale adjustment.
   * Returns highest ancestor from exit destinations if available,
   * otherwise parent grid, otherwise current grid.
   */
  private getRenderGridInfo(playerPos: CellPosition): {
    gridId: string;
    grid: Grid;
    currentGridMaxDim: number;
    refPosition: { row: number; col: number } | null;
    refPositionPath?: Array<{ gridId: string; row: number; col: number }>;
  } {
    const currentGrid = getGrid(this.store, playerPos.gridId);
    if (!currentGrid) {
      throw new Error(`Player grid ${playerPos.gridId} not found`);
    }

    const currentMaxDim = Math.max(currentGrid.rows, currentGrid.cols);

    // Step 1: Find immediate parent via primary ref
    const primaryRef = findPrimaryRef(this.store, playerPos.gridId);

    // Step 2: NEW - Find highest ancestor from exit destinations
    const highestAncestorId = findHighestAncestor(
      this.store,
      playerPos
    );

    console.log('getRenderGridInfo:', {
      playerGridId: playerPos.gridId,
      primaryRef: primaryRef,
      hasParent: !!primaryRef,
      highestAncestor: highestAncestorId
    });

    // Step 3: Choose which grid to render based on priority
    let renderGridId: string;
    let renderRefPosition: { row: number; col: number } | null = null;

    if (highestAncestorId) {
      // Use highest ancestor if found (grandparent or higher)
      renderGridId = highestAncestorId;

      // Build path from render grid down to current grid
      // This allows the camera to compute the correct nested world position
      // Each entry shows where the next grid is located in the current grid
      const path: Array<{ gridId: string; row: number; col: number }> = [];
      let currentGridInPath = playerPos.gridId;

      // Walk up from current grid to render grid, collecting positions
      while (currentGridInPath !== renderGridId) {
        const ref = findPrimaryRef(this.store, currentGridInPath);
        if (!ref) break; // Shouldn't happen if highestAncestorId is valid

        const [parentGridId, refRow, refCol] = ref;
        // Prepend to path so it goes from render grid downward
        // This entry shows where currentGridInPath is located in parentGridId
        path.unshift({ gridId: parentGridId, row: refRow, col: refCol });
        currentGridInPath = parentGridId;
      }

      // For backward compatibility, set refPosition to the first step (immediate parent in ancestor)
      if (path.length >= 1) {
        renderRefPosition = { row: path[0].row, col: path[0].col };
      }

      console.log('  -> Using highest ancestor:', {
        ancestorGridId: renderGridId,
        refPosition: renderRefPosition,
        refPositionPath: path
      });

      const renderGrid = getGrid(this.store, renderGridId);
      if (!renderGrid) {
        console.log('  -> Render grid not found in store, fallback to current');
        return {
          gridId: playerPos.gridId,
          grid: currentGrid,
          currentGridMaxDim: currentMaxDim,
          refPosition: null
        };
      }

      return {
        gridId: renderGridId,
        grid: renderGrid,
        currentGridMaxDim: currentMaxDim,
        refPosition: renderRefPosition,
        refPositionPath: path
      };
    } else if (primaryRef) {
      // Fall back to immediate parent
      const [parentGridId, refRow, refCol] = primaryRef;
      const parentGrid = getGrid(this.store, parentGridId);

      if (!parentGrid) {
        // Parent not found - fallback to current grid
        console.log('  -> Parent grid not found in store, fallback to current');
        return {
          gridId: playerPos.gridId,
          grid: currentGrid,
          currentGridMaxDim: currentMaxDim,
          refPosition: null
        };
      }

      renderGridId = parentGridId;
      renderRefPosition = { row: refRow, col: refCol };

      console.log('  -> Using immediate parent:', {
        parentGridId,
        refPosition: renderRefPosition
      });
    } else {
      // No parent - render current grid normally
      console.log('  -> No parent found, rendering current grid');
      return {
        gridId: playerPos.gridId,
        grid: currentGrid,
        currentGridMaxDim: currentMaxDim,
        refPosition: null
      };
    }

    // Get the render grid
    const renderGrid = getGrid(this.store, renderGridId);
    if (!renderGrid) {
      // Render grid not found - fallback to current grid
      console.log('  -> Render grid not found in store, fallback to current');
      return {
        gridId: playerPos.gridId,
        grid: currentGrid,
        currentGridMaxDim: currentMaxDim,
        refPosition: null
      };
    }

    // Render ancestor/parent grid, but keep the view width based on current grid
    // This maintains the same zoom level as if we were rendering current grid alone
    console.log('  -> Rendering ancestor/parent grid:', {
      renderGridId,
      renderDims: `${renderGrid.rows}x${renderGrid.cols}`,
      currentDims: `${currentGrid.rows}x${currentGrid.cols}`,
      currentGridMaxDim: currentMaxDim,
      refPosition: renderRefPosition
    });

    return {
      gridId: renderGridId,
      grid: renderGrid,
      currentGridMaxDim: currentMaxDim,
      refPosition: renderRefPosition
    };
  }

  /**
   * Rebuild scene data (analyze + build scene) without rendering.
   * Used when we want to prepare for animation.
   */
  private rebuildSceneData(): void {
    const playerPos = this.playerPosition;
    if (!playerPos) return;

    // Get render grid info (current or parent)
    const { gridId, grid, currentGridMaxDim, refPosition, refPositionPath } = this.getRenderGridInfo(playerPos);

    // Phase 1: Analyze grid to build CellTree
    this.currentCellTree = analyze(this.store, gridId, grid.cols, grid.rows);

    // Phase 2: Build scene from CellTree (without rendering)
    const result = buildIsometricScene(this.currentCellTree, {
      width: this.renderWidth,
      height: this.renderHeight,
      highlightPosition: playerPos,
      store: this.store,
      tagFn: this.tagFn
    });

    this.currentScene = result.scene;
    this.currentCamera = result.camera;

    // Adjust camera for parent/ancestor grid rendering
    if (refPosition) {
      console.log('Adjusting camera (rebuildSceneData) for parent/ancestor grid');

      let refX: number;
      let refZ: number;
      let viewWidth: number;

      if (refPositionPath && refPositionPath.length > 0) {
        // Compute world position by walking through the hierarchy
        let worldX = 0;
        let worldZ = 0;
        let scale = 1;

        // Walk through path, composing transforms
        for (let i = 0; i < refPositionPath.length; i++) {
          const step = refPositionPath[i];
          const stepGrid = getGrid(this.store, step.gridId);
          if (!stepGrid) continue;

          // Position in this grid's local coordinate system
          const localCenterX = (stepGrid.cols - 1) / 2;
          const localCenterZ = (stepGrid.rows - 1) / 2;
          const localX = step.col - localCenterX;
          const localZ = step.row - localCenterZ;

          // Add to world position at current scale
          worldX += localX * scale;
          worldZ += localZ * scale;

          // Get the child grid at this position to compute scale for next level
          // For the last step, the child is the player's grid
          const nextStepGridId = i < refPositionPath.length - 1
            ? refPositionPath[i + 1].gridId
            : playerPos.gridId;
          const nextGrid = getGrid(this.store, nextStepGridId);
          if (nextGrid) {
            const nextGridMaxDim = Math.max(nextGrid.rows, nextGrid.cols);
            scale /= nextGridMaxDim;
          }
        }

        refX = worldX;
        refZ = worldZ;

        // View width: scale tells us how large the current grid appears in ancestor coordinates
        viewWidth = currentGridMaxDim * scale * 1.2;

        console.log('Camera adjustment (path-based):', {
          refPositionPath,
          worldCenter: [refX, 0, refZ],
          pathLength: refPositionPath.length,
          scale,
          viewWidth
        });
      } else {
        // Single-level: calculate world position of reference cell
        const centerX = (grid.cols - 1) / 2;
        const centerZ = (grid.rows - 1) / 2;
        refX = refPosition.col - centerX;
        refZ = refPosition.row - centerZ;

        // View width: show approximately 1 parent cell (the reference cell)
        viewWidth = 1.2;

        console.log('Camera adjustment (single-level):', {
          refPosition,
          worldCenter: [refX, 0, refZ],
          currentGridMaxDim,
          viewWidth
        });
      }

      // Create camera centered on computed world position
      this.currentCamera = createParagridCamera(
        [refX, 0, refZ],
        viewWidth,
        this.renderWidth,
        this.renderHeight
      );

      console.log('Camera created with createParagridCamera');
    }

    // Ensure renderer is ready (create once, reuse for all renders)
    if (!this.currentRenderer) {
      this.currentRenderer = new Renderer({
        target: this.canvas,
        backend: 'svg',
        width: this.renderWidth,
        height: this.renderHeight
      });
    }
  }

  private render(
    forceRebuild: boolean = false,
    cameraOverride?: { center: [number, number, number]; viewWidth: number }
  ): void {
    const playerPos = this.playerPosition;

    if (!playerPos) {
      this.canvas.innerHTML = '<div style="color: red; padding: 20px;">Error: No player cell found!</div>';
      this.updateStatus();
      return;
    }

    try {
      // Rebuild scene only when necessary (store changed, or first render)
      if (forceRebuild || !this.currentScene || !this.currentCellTree || !this.currentRenderer) {
        // Clear canvas - this detaches any existing SVG, so we must recreate the renderer
        this.canvas.innerHTML = '';
        this.currentRenderer = null;

        // Get render grid info (current or parent)
        const { gridId, grid, currentGridMaxDim, refPosition, refPositionPath } = this.getRenderGridInfo(playerPos);

        // Phase 1: Analyze grid to build CellTree
        this.currentCellTree = analyze(this.store, gridId, grid.cols, grid.rows);

        // Phase 2: Build scene from CellTree (without rendering yet)
        const result = buildIsometricScene(this.currentCellTree, {
          width: this.renderWidth,
          height: this.renderHeight,
          highlightPosition: playerPos,
          store: this.store,
          tagFn: this.tagFn
        });

        this.currentScene = result.scene;
        this.currentCamera = result.camera;

        // Adjust camera for parent/ancestor grid rendering
        if (refPosition) {
          console.log('Adjusting camera (render) for parent/ancestor grid');

          let refX: number;
          let refZ: number;
          let viewWidth: number;

          if (refPositionPath && refPositionPath.length > 0) {
            // Compute world position by walking through the hierarchy
            let worldX = 0;
            let worldZ = 0;
            let scale = 1;

            // Walk through path, composing transforms
            for (let i = 0; i < refPositionPath.length; i++) {
              const step = refPositionPath[i];
              const stepGrid = getGrid(this.store, step.gridId);
              if (!stepGrid) continue;

              // Position in this grid's local coordinate system
              const localCenterX = (stepGrid.cols - 1) / 2;
              const localCenterZ = (stepGrid.rows - 1) / 2;
              const localX = step.col - localCenterX;
              const localZ = step.row - localCenterZ;

              // Add to world position at current scale
              worldX += localX * scale;
              worldZ += localZ * scale;

              // Get the child grid at this position to compute scale for next level
              // For the last step, the child is the player's grid
              const nextStepGridId = i < refPositionPath.length - 1
                ? refPositionPath[i + 1].gridId
                : playerPos.gridId;
              const nextGrid = getGrid(this.store, nextStepGridId);
              if (nextGrid) {
                const nextGridMaxDim = Math.max(nextGrid.rows, nextGrid.cols);
                scale /= nextGridMaxDim;
              }
            }

            refX = worldX;
            refZ = worldZ;

            // View width: scale tells us how large the current grid appears in ancestor coordinates
            viewWidth = currentGridMaxDim * scale * 1.2;

            console.log('Camera adjustment (path-based):', {
              refPositionPath,
              worldCenter: [refX, 0, refZ],
              pathLength: refPositionPath.length,
              scale,
              viewWidth
            });
          } else {
            // Single-level: calculate world position of reference cell
            const centerX = (grid.cols - 1) / 2;
            const centerZ = (grid.rows - 1) / 2;
            refX = refPosition.col - centerX;
            refZ = refPosition.row - centerZ;

            // View width: show approximately 1 parent cell (the reference cell)
            viewWidth = 1.2;

            console.log('Camera adjustment (single-level):', {
              refPosition,
              worldCenter: [refX, 0, refZ],
              currentGridMaxDim,
              viewWidth
            });
          }

          // Create camera centered on computed world position
          this.currentCamera = createParagridCamera(
            [refX, 0, refZ],
            viewWidth,
            this.renderWidth,
            this.renderHeight
          );

          console.log('Camera created with createParagridCamera');
        }

        // Create new renderer after clearing canvas
        this.currentRenderer = new Renderer({
          target: this.canvas,
          backend: 'svg',
          width: this.renderWidth,
          height: this.renderHeight
        });

        // Use override camera if provided, otherwise use current camera
        const activeCamera = cameraOverride ?
          createParagridCamera(
            cameraOverride.center,
            cameraOverride.viewWidth,
            this.renderWidth,
            this.renderHeight
          ) :
          this.currentCamera;

        // Now render the scene once
        const screenSpace = project(
          this.currentScene,
          activeCamera,
          this.renderWidth,
          this.renderHeight
        );

        this.currentRenderer.render(screenSpace);
      } else {
        // During animation: only update transform overrides and re-render
        const transformOverrides = this.animationSystem.evaluateTransforms();

        // Use override camera if provided, otherwise use current camera
        const activeCamera = cameraOverride ?
          createParagridCamera(
            cameraOverride.center,
            cameraOverride.viewWidth,
            this.renderWidth,
            this.renderHeight
          ) :
          this.currentCamera;

        // Re-project with animation overrides
        const screenSpace = project(
          this.currentScene,
          activeCamera,
          this.renderWidth,
          this.renderHeight,
          { transformOverrides }
        );

        // Re-render using the SAME renderer instance (it clears and re-renders automatically)
        this.currentRenderer.render(screenSpace);
      }
    } catch (error) {
      console.error('Render error:', error);
      this.canvas.innerHTML = `<div style="color: red; padding: 20px;">Render error: ${error}</div>`;
    }

    this.updateStatus();
  }

  private updateStatus(): void {
    const playerPos = this.playerPosition;

    let statusHtml = `
      <div class="status-line"><strong>Status:</strong> ${this.statusMessage}</div>
    `;

    if (playerPos) {
      statusHtml += `
        <div class="status-line"><strong>Player Position:</strong> ${playerPos.gridId}[${playerPos.row}, ${playerPos.col}]</div>
      `;

      const grid = getGrid(this.store, playerPos.gridId);
      const cell = grid?.cells[playerPos.row]?.[playerPos.col];
      if (cell && isConcrete(cell)) {
        statusHtml += `
          <div class="status-line"><strong>Cell:</strong> Concrete(${cell.id})</div>
        `;
      }

      // Show which grid is being rendered (visual root)
      const renderInfo = this.getRenderGridInfo(playerPos);
      statusHtml += `
        <div class="status-line"><strong>Visual Root:</strong> ${renderInfo.gridId}</div>
      `;
    }

    statusHtml += `
      <div class="controls">
        <strong>Controls:</strong><br>
        <span class="key">W/A/S/D</span> - Move (Push)<br>
        <span class="key">R</span> - Reset<br>
        <span class="key">Ctrl+Z</span> - Undo (${this.undoStack.length} available)<br>
        <span class="key">Ctrl+Shift+Z</span> or <span class="key">Ctrl+Y</span> - Redo (${this.redoStack.length} available)<br>
        <strong style="margin-top: 0.5rem; display: inline-block;">Export:</strong><br>
        See buttons below for scene JSON and SVG
      </div>
    `;

    this.statusEl.innerHTML = statusHtml;
  }
}

const GRIDS = {
  swap: {
    main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ 1 _ 2 _ 9|9 _ main _ _ *inner _ 9|9 _ _ _ _ _ _ _|9 _ _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
    inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'
  },
  swapEdited: {
    main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ _ _ 2 _ 9|9 _ main *inner _ _ _ 9|9 _ _ _ _ _ _ _|9 1 _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
    inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'
  },
  simple: { main: '1 _ _|_ 9 _|_ _ 2' },
  doubleExit: {
    main: '_ _ _|_ 2 _|a _ _',
    a: 'b _ _|_ 1 _|_ _ _',
    b: '_ _ _|_ _ _|_ _ _' },

  exitEnter: {
    main: '_ _ 9|_ a b|1 _ _',
    a: '_ b|_ _', b: '2 _|_ _'
  },

  tricky: {
    main: '9 9 9 9 9 9 9|9 _ _ _ _ _ 9|9 _ a _ b _ 9|9 _ _ _ _ _ 9|' +
              '9 _ c _ 1 _ 9|9 _ _ _ _ _ 9|9 9 9 9 9 9 9',
    a: '_ 9 _|_ _ _|_ _ _',
    b: '9 9 9 9 9|9 9 9 _ _' + '|9 9 9 9 9'.repeat(3),
    c: '9 ' + '_ '.repeat(10) + '9|' +
        '_ '.repeat(11) + '9|' + 
        ('9 ' + '_ '.repeat(10) + '9|').repeat(9) +
        '9 ' + '_ '.repeat(10) + '9'
  },
  transparency: {
   main: '_ _ _|_ a _|2 _ _',
   a: '_ _ _|_ 1 _|_ _ _'
  },
};

// Initialize the demo when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Test 4x4 with self-reference and inner reference
  // main:  [9, 9, 9, 9]
  //        [9, 1, main, 9]    <- player and self-reference
  //        [9, *inner, 2, 9]  <- inner reference
  //        [9, 9, 9, 9]
  //
  // inner: [9, _, 9]          <- gap at top middle
  //        [9, _, 9]
  //        [9, 9, 9]
  const gridDefinition = GRIDS.doubleExit;
      // main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ 1 _ 2 _ 9|9 _ main _ _ *inner _ 9|9 _ _ _ _ _ _ _|9 _ _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
      // inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'

      // main: '_ _ 9|_ a b|1 _ _',
      // a: '_ b|_ _', b: '2 _|_ _'
 
     // main: "9 9 9|1 _ main|_ _ _"
  
// main: '9 9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ _ 9|9 _ *first _ _ _ third _ 9|9 _ _ _ _ _ _ _ 9|' +
//                         '9 _ 1 _ second _ _ _ 9|9 _ _ _ _ _ _ _ 9|9 _ fourth _ _ _ ~first _ 9|' +
//                         '9 _ _ _ _ _ _ _ 9|9 9 9 9 9 9 9 9 9',
// first: '_ _ _|_ 2 _|_ _ _',
// second: '_ _ _|_ 3 _|_ _ _',
// third: '_ _ _|_ 4 _|_ _ _',
// fourth: '_ _ _|_ 5 _|_ _ _'


  const store = parseGrids(gridDefinition);

  // Tag function: cell '1' is the player
  const tagFn: TagFn = (cell: Cell) => {
    if (isConcrete(cell)) {
      if (cell.id === '1') {
        return new Set(['player']);
      }
      if (cell.id === '9') {
        return new Set(['stop']);
      }
    }
    return new Set();
  };

  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');

  if (!canvas || !status) {
    console.error('Required elements not found!');
    return;
  }

  new IsometricDemo(store, tagFn, canvas, status);
});
