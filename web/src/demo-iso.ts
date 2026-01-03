/**
 * Interactive isometric demo with WASD navigation.
 */

import { parseGrids } from './lib/parser/parser.js';
import type { GridStore } from './lib/core/types.js';
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
import { renderIsometric, buildIsometricScene, type CellPositionOverrides } from './lib/renderer/isometric.js';
import { sceneToJSON, type Scene, AnimationSystem, Easing, type AnimationClip, project, Camera, Renderer, type ScreenSpace } from 'iso-render';
import type { CellNode } from './lib/analyzer/types.js';
import { computeExitTransformation, getEdgePosition, type ExitTransformation } from './lib/navigator/exit-transform.js';

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
  private cellPositionOverrides: CellPositionOverrides | undefined = undefined; // For direction-aware animation
  private animatingCells: Set<string> = new Set(); // Cell IDs currently animating
  private undoStack: GridStore[] = []; // Stack of previous states
  private redoStack: GridStore[] = []; // Stack of undone states
  private readonly maxHistorySize = 50; // Limit to prevent memory issues
  private readonly enableExitPreviews = false; // Enable exit preview rendering and calculation (default: false)

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
        // Grid transition (exit/enter) - no animation for these, just instant transition
        // Stop any animations and force full rebuild with the new grid as root
        this.animationSystem.stop();
        this.isAnimating = false;
        if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
        // Clear everything to force complete rebuild with new grid as root
        this.currentScene = null;
        this.currentCellTree = null;
        this.currentRenderer = null;
        this.render(true);
      } else {
        // Same grid - convert push chain to movements and animate
        const movements = this.chainToMovements(pushChain, playerPos.gridId);

        if (movements.length > 0) {
          // Create animations (this sets cellPositionOverrides)
          // Then rebuild scene with those overrides
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
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Remove animation clip to clear transform overrides
    this.animationSystem.removeClip('push-move');
    // Clear animation state
    this.cellPositionOverrides = undefined;
    this.animatingCells.clear();
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
   * Transform world coordinates to camera-space Z coordinate.
   * Higher camera-space Z means closer to camera.
   */
  private worldToCameraZ(worldX: number, worldZ: number): number {
    if (!this.currentCamera) {
      return 0; // Fallback if camera not ready
    }

    // Get camera yaw in radians (from camera config)
    const yawDegrees = this.currentCamera.yaw ?? 50;
    const yawRadians = (yawDegrees * Math.PI) / 180;

    // Apply yaw rotation to get camera-relative coordinates
    // Camera looks down the +Z axis after rotation
    const cameraX = worldX * Math.cos(yawRadians) + worldZ * Math.sin(yawRadians);
    const cameraZ = -worldX * Math.sin(yawRadians) + worldZ * Math.cos(yawRadians);

    return cameraZ;
  }

  /**
   * Determine if movement is toward the camera (increasing camera-space Z).
   */
  private isMovingTowardCamera(oldPos: CellPosition, newPos: CellPosition): boolean {
    const oldCameraZ = this.worldToCameraZ(oldPos.col, oldPos.row);
    const newCameraZ = this.worldToCameraZ(newPos.col, newPos.row);
    return newCameraZ > oldCameraZ;
  }

  /**
   * Create animations for multiple cells that moved one square.
   * Uses direction-aware animation strategy for correct z-ordering.
   */
  private createMultipleMovementAnimations(movements: Array<{
    cellId: string;
    oldPos: CellPosition;
    newPos: CellPosition;
  }>): void {
    if (movements.length === 0) return;

    const duration = 0.3; // 300ms animation

    // Split movements by direction relative to camera
    const towardCamera: typeof movements = [];
    const awayFromCamera: typeof movements = [];

    for (const movement of movements) {
      if (true) { //this.isMovingTowardCamera(movement.oldPos, movement.newPos)) {
        towardCamera.push(movement);
      } else {
        awayFromCamera.push(movement);
      }
    }

    console.log(`Movements: ${towardCamera.length} toward camera, ${awayFromCamera.length} away from camera`);

    // Remove any existing animation clip to avoid conflicts
    this.animationSystem.removeClip('push-move');

    // Track all animating cells (for floor tile rendering)
    this.animatingCells = new Set(movements.map(m => m.cellId));

    // Build cell position overrides for away-from-camera movements
    // These cells need hierarchy at OLD position for correct z-sorting
    if (awayFromCamera.length > 0) {
      this.cellPositionOverrides = new Map();
      for (const movement of awayFromCamera) {
        this.cellPositionOverrides.set(movement.cellId, {
          row: movement.oldPos.row,
          col: movement.oldPos.col
        });
      }
    } else {
      this.cellPositionOverrides = undefined;
    }

    // Build all animations
    const animations: Array<{
      nodeId: string;
      channels: Array<{
        target: 'position' | 'rotation' | 'scale';
        interpolation: 'linear';
        keyFrames: Array<{ time: number; value: [number, number, number]; easing?: any }>;
      }>;
    }> = [];

    // TOWARD CAMERA: hierarchy at NEW position, animate FROM old position (negative offset)
    for (const movement of towardCamera) {
      const relativeOffset: [number, number, number] = [
        movement.oldPos.col - movement.newPos.col,
        0,
        movement.oldPos.row - movement.newPos.row
      ];
      const targetPos: [number, number, number] = [0, 0, 0];

      console.log(`  ${movement.cellId} (toward): [${relativeOffset}] -> [${targetPos}]`);

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

    // AWAY FROM CAMERA: hierarchy at OLD position, animate TO new position (positive offset)
    for (const movement of awayFromCamera) {
      const startPos: [number, number, number] = [0, 0, 0]; // Starts at hierarchy position (OLD)
      const targetOffset: [number, number, number] = [
        movement.newPos.col - movement.oldPos.col,
        0,
        movement.newPos.row - movement.oldPos.row
      ];

      console.log(`  ${movement.cellId} (away): [${startPos}] -> [${targetOffset}]`);

      animations.push({
        nodeId: movement.cellId,
        channels: [{
          target: 'position',
          interpolation: 'linear',
          keyFrames: [
            { time: 0, value: startPos, easing: Easing.easeInQuad },
            { time: duration, value: targetOffset }
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

    // Rebuild scene with the position overrides now in place
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

      // Update animation system
      this.animationSystem.update(deltaTime);

      // Re-render with animation
      this.render();

      // Continue animation if still playing
      const state = this.animationSystem.getState();
      if (state.playing) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        // Animation complete - clean up and render final state
        this.animationFrameId = null;
        this.isAnimating = false;

        // Remove animation clip so transform overrides are cleared
        this.animationSystem.removeClip('push-move');

        // Check if we need to rebuild (either position overrides or animating cells)
        const needsRebuild = this.cellPositionOverrides !== undefined || this.animatingCells.size > 0;

        // Clear animation state
        this.animatingCells.clear();
        if (this.cellPositionOverrides) {
          this.cellPositionOverrides = undefined;
        }

        if (needsRebuild) {
          console.log('Animation complete - rebuilding scene');
          // Rebuild scene data without clearing canvas (avoids flash)
          this.rebuildSceneData();
          // Render the final state (now with no animation overrides)
          this.render(false);
        }
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Compute exit previews for all four compass directions.
   * Checks if it's possible to exit in each direction.
   * Returns array of exit transformations (may be empty).
   */
  private computeExitPreviews(): ExitTransformation[] {
    const playerPos = this.playerPosition;
    if (!playerPos) return [];

    const directions = [Direction.N, Direction.S, Direction.E, Direction.W];
    const previews: ExitTransformation[] = [];

    for (const direction of directions) {
      // Get a position on the edge for this direction
      const edgePos = getEdgePosition(this.store, playerPos.gridId, direction);
      if (!edgePos) continue;

      // Compute exit transformation
      const result = computeExitTransformation(
        this.store,
        playerPos.gridId,
        direction,
        edgePos,
        createRuleSet()
      );

      if (result) {
        previews.push(result);

        // For North and South, also preview cells horizontally adjacent to the exit cell in parent
        if ((direction === Direction.N || direction === Direction.S) && result.targetGridId && result.currentRefPosition) {
          const targetGrid = getGrid(this.store, result.targetGridId);
          if (targetGrid) {
            // Preview cell to the east of the exit cell
            const eastCol = result.exitPosition.col + 1;
            if (eastCol < targetGrid.cols) {
              const eastPreview: ExitTransformation = {
                targetGridId: result.targetGridId,
                exitPosition: new CellPosition(result.targetGridId, result.exitPosition.row, eastCol),
                scale: result.scale,
                currentRefPosition: result.currentRefPosition,
                direction: direction  // Inherit direction from main exit
              };
              previews.push(eastPreview);
            }

            // Preview cell to the west of the exit cell
            const westCol = result.exitPosition.col - 1;
            if (westCol >= 0) {
              const westPreview: ExitTransformation = {
                targetGridId: result.targetGridId,
                exitPosition: new CellPosition(result.targetGridId, result.exitPosition.row, westCol),
                scale: result.scale,
                currentRefPosition: result.currentRefPosition,
                direction: direction  // Inherit direction from main exit
              };
              previews.push(westPreview);
            }
          }
        }
      }
    }

    return previews;
  }

  /**
   * Get layer configuration for rendering.
   * Layers >= 200 should be 50% transparent.
   */
  private getLayerConfig(): (layer: number) => { opacity: number } {
    return (layer: number) => {
      if (layer >= 200) {
        return { opacity: 0.5 };
      }
      return { opacity: 1.0 };
    };
  }

  /**
   * Rebuild scene data (analyze + build scene) without rendering.
   * Used when we want to prepare for animation.
   */
  private rebuildSceneData(): void {
    const playerPos = this.playerPosition;
    if (!playerPos) return;

    const grid = getGrid(this.store, playerPos.gridId);
    if (!grid) return;

    // Phase 1: Analyze grid to build CellTree (from player's current grid as root)
    this.currentCellTree = analyze(this.store, playerPos.gridId, grid.cols, grid.rows);

    // Compute exit previews for all directions (only if enabled)
    const exitPreviews = this.enableExitPreviews ? this.computeExitPreviews() : [];

    // Phase 2: Build scene from CellTree (without rendering)
    const result = buildIsometricScene(this.currentCellTree, {
      width: this.renderWidth,
      height: this.renderHeight,
      highlightPosition: playerPos,
      store: this.store,
      tagFn: this.tagFn,
      cellPositionOverrides: this.cellPositionOverrides,
      animatingCells: this.animatingCells,
      exitPreviews: exitPreviews,
      enableExitPreviews: this.enableExitPreviews
    });

    this.currentScene = result.scene;
    this.currentCamera = result.camera;

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

  private render(forceRebuild: boolean = false): void {
    const playerPos = this.playerPosition;

    if (!playerPos) {
      this.canvas.innerHTML = '<div style="color: red; padding: 20px;">Error: No player cell found!</div>';
      this.updateStatus();
      return;
    }

    // Get the grid containing the player (this is the root for visualization)
    const grid = getGrid(this.store, playerPos.gridId);

    if (!grid) {
      this.canvas.innerHTML = `<div style="color: red; padding: 20px;">Error: Player grid not found!</div>`;
      this.updateStatus();
      return;
    }

    try {
      // Rebuild scene only when necessary (store changed, or first render)
      if (forceRebuild || !this.currentScene || !this.currentCellTree || !this.currentRenderer) {
        // Clear canvas - this detaches any existing SVG, so we must recreate the renderer
        this.canvas.innerHTML = '';
        this.currentRenderer = null;

        // Phase 1: Analyze grid to build CellTree (from player's current grid as root)
        this.currentCellTree = analyze(this.store, playerPos.gridId, grid.cols, grid.rows);

        // Compute exit previews for all directions (only if enabled)
        const exitPreviews = this.enableExitPreviews ? this.computeExitPreviews() : [];

        // Phase 2: Build scene from CellTree (without rendering yet)
        const result = buildIsometricScene(this.currentCellTree, {
          width: this.renderWidth,
          height: this.renderHeight,
          highlightPosition: playerPos,
          store: this.store,
          tagFn: this.tagFn,
          cellPositionOverrides: this.cellPositionOverrides,
          animatingCells: this.animatingCells,
          exitPreviews: exitPreviews,
          enableExitPreviews: this.enableExitPreviews
        });

        this.currentScene = result.scene;
        this.currentCamera = result.camera;

        // Create new renderer after clearing canvas
        this.currentRenderer = new Renderer({
          target: this.canvas,
          backend: 'svg',
          width: this.renderWidth,
          height: this.renderHeight
        });

        // Now render the scene once
        const screenSpace = project(
          this.currentScene,
          this.currentCamera,
          this.renderWidth,
          this.renderHeight
        );

        this.currentRenderer.render(screenSpace, { layers: this.getLayerConfig() });
      } else {
        // During animation: only update transform overrides and re-render
        const transformOverrides = this.animationSystem.evaluateTransforms();

        // Re-project with animation overrides
        const screenSpace = project(
          this.currentScene,
          this.currentCamera,
          this.renderWidth,
          this.renderHeight,
          { transformOverrides }
        );

        // Re-render using the SAME renderer instance (it clears and re-renders automatically)
        this.currentRenderer.render(screenSpace, { layers: this.getLayerConfig() });
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
    main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ _ _ 2 _ 9|9 _ main *inner _ _ _ 9|9 1 _ _ _ _ _ _|9 _ _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
    inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'
  },
  simple: { main: '1 _ _|_ 9 _|_ _ 2' },
  doubleExit: {
    main: '_ _ _|_ 2 _|_ a _',
    a: '_ b _|_ _ _|_ _ _',
    b: '_ 1 _|_ _ _|_ _ _' },

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
  const gridDefinition = GRIDS.swapEdited;
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
