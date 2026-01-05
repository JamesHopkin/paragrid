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
import { sceneToJSON, type Scene, AnimationSystem, CameraAnimationSystem, Easing, type AnimationClip, type CameraAnimationClip, project, Camera, Renderer, type ScreenSpace } from 'iso-render';
import type { CellNode } from './lib/analyzer/types.js';
import { getScaleAndOffset, ParentViewCameraController, type CameraController, type ViewPath } from './lib/camera/index.js';

const CAMERA_ANIMATION_DURATION = 0.3; // 300ms in seconds
const RENDER_THRESHOLD = 1/64;

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
  private cameraAnimationSystem: CameraAnimationSystem;
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
  private manualViewPath: string[] | null = null; // Manual view path (grid names)
  private manualViewInputEl: HTMLInputElement | null = null;
  private manualViewStatusEl: HTMLElement | null = null;
  private zoomSliderEl: HTMLInputElement | null = null;
  private zoomValueEl: HTMLElement | null = null;
  private zoomMultiplier: number = 1.0; // Exponential zoom multiplier (2^sliderValue)
  private cameraController: CameraController; // Camera protocol implementation
  private currentViewPath: ViewPath | null = null; // Current automatic view path

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
    this.cameraAnimationSystem = new CameraAnimationSystem();

    // Initialize camera controller
    this.cameraController = new ParentViewCameraController();

    // Store initial player position
    this.previousPlayerPosition = this.playerPosition ?? null;

    // Get initial view from camera controller
    const playerPos = this.playerPosition;
    if (playerPos) {
      const initialView = this.cameraController.getInitialView(this.store, playerPos.gridId);
      this.currentViewPath = initialView.targetView;
    }

    this.setupKeyboardHandlers();
    this.setupExportButton();
    this.setupManualViewControls();
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

      // Ignore player input keys if manual view input is focused
      if (this.manualViewInputEl && document.activeElement === this.manualViewInputEl) {
        return; // Let the input handle the key
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

  private setupManualViewControls(): void {
    this.manualViewInputEl = document.getElementById('manual-view-input') as HTMLInputElement;
    this.manualViewStatusEl = document.getElementById('manual-view-status');
    this.zoomSliderEl = document.getElementById('zoom-slider') as HTMLInputElement;
    this.zoomValueEl = document.getElementById('zoom-value');

    if (!this.manualViewInputEl) return;

    // Listen for input changes
    this.manualViewInputEl.addEventListener('input', () => {
      this.updateManualView();
    });

    // Also listen for Enter key
    this.manualViewInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.updateManualView();
      }
    });

    // Setup zoom slider
    if (this.zoomSliderEl) {
      this.zoomSliderEl.addEventListener('input', () => {
        this.updateZoom();
      });

      // Double-click to reset zoom to 1x
      this.zoomSliderEl.addEventListener('dblclick', () => {
        this.zoomSliderEl!.value = '0';
        this.updateZoom();
      });
    }
  }

  private updateManualView(): void {
    if (!this.manualViewInputEl || !this.manualViewStatusEl) return;

    const input = this.manualViewInputEl.value.trim();

    if (input === '') {
      // Empty input - disable manual view
      this.manualViewPath = null;
      this.manualViewStatusEl.textContent = 'Enter grid path to override camera (empty = auto)';
      this.manualViewStatusEl.className = 'manual-view-status';

      // Force rebuild to revert to automatic camera
      this.currentScene = null;
      this.currentCellTree = null;
      this.currentRenderer = null;
      this.render(true);
      return;
    }

    // Parse the input (e.g., "m.i" -> ["main", "inner"])
    const parsed = this.parseManualViewInput(input);

    if (parsed.success) {
      this.manualViewPath = parsed.path;
      this.manualViewStatusEl.textContent = `✓ View: ${parsed.path.join(' → ')}`;
      this.manualViewStatusEl.className = 'manual-view-status active';

      // Force rebuild with new manual view
      this.currentScene = null;
      this.currentCellTree = null;
      this.currentRenderer = null;
      this.render(true);
    } else {
      this.manualViewPath = null;
      this.manualViewStatusEl.textContent = `✗ ${parsed.error}`;
      this.manualViewStatusEl.className = 'manual-view-status error';
    }
  }

  /**
   * Parse manual view input format (e.g., "m.i" -> ["main", "inner"]).
   * Letters are case-insensitive first letters of grid names.
   */
  private parseManualViewInput(input: string):
    | { success: true; path: string[] }
    | { success: false; error: string } {
    const letters = input.toLowerCase().split('.');
    const path: string[] = [];

    // Get all grid IDs from store
    const gridIds = Object.keys(this.store);

    for (const letter of letters) {
      if (letter.length === 0) {
        return { success: false, error: 'Empty segment in path' };
      }

      // Find grid(s) starting with this letter (case-insensitive)
      const matches = gridIds.filter(id =>
        id.toLowerCase().startsWith(letter.toLowerCase())
      );

      if (matches.length === 0) {
        return { success: false, error: `No grid found starting with '${letter}'` };
      }

      if (matches.length > 1) {
        return {
          success: false,
          error: `Ambiguous: '${letter}' matches ${matches.join(', ')}`
        };
      }

      path.push(matches[0]);
    }

    // Validate the path is valid (each grid references the next)
    const scaleResult = getScaleAndOffset(this.store, path);
    if (!scaleResult) {
      return {
        success: false,
        error: 'Invalid path: grids don\'t reference each other correctly'
      };
    }

    return { success: true, path };
  }

  /**
   * Update zoom multiplier based on slider value.
   * Slider range: -3 to 3 (maps to 1/8x to 8x exponentially)
   */
  private updateZoom(): void {
    if (!this.zoomSliderEl || !this.zoomValueEl) return;

    const sliderValue = parseFloat(this.zoomSliderEl.value);
    // Convert slider value to exponential scale: 2^sliderValue
    // slider = -3 → 2^-3 = 1/8 = 0.125
    // slider = 0 → 2^0 = 1
    // slider = 3 → 2^3 = 8
    this.zoomMultiplier = Math.pow(2, sliderValue);

    // Update display
    this.zoomValueEl.textContent = `${this.zoomMultiplier.toFixed(2)}×`;

    // Force re-render if manual view is active
    if (this.manualViewPath) {
      this.currentScene = null;
      this.currentCellTree = null;
      this.currentRenderer = null;
      this.render(true);
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
        // Grid transition - update view using camera controller
        const transition = this.detectGridTransition(pushChain, playerPos.gridId, newPos.gridId);

        let viewUpdate;
        if (transition?.type === 'enter') {
          viewUpdate = this.cameraController.onPlayerEnter(
            this.store,
            playerPos.gridId,
            newPos.gridId
          );
        } else if (transition?.type === 'exit') {
          viewUpdate = this.cameraController.onPlayerExit(
            this.store,
            playerPos.gridId,
            newPos.gridId
          );
        } else {
          // Fallback - treat as move
          viewUpdate = this.cameraController.onPlayerMove(this.store, newPos.gridId);
        }

        // Update current view
        const oldViewPath = this.currentViewPath;
        this.currentViewPath = viewUpdate.targetView;

        // For now, rebuild immediately without animation
        // TODO: Handle animationStartView for smooth transitions
        this.animationSystem.stop();
        this.cameraAnimationSystem.stop();
        this.isAnimating = false;
        if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
        // Clear everything to force complete rebuild with new view
        this.currentScene = null;
        this.currentCellTree = null;
        this.currentRenderer = null;
        this.render(true);
      } else {
        // Same grid - update view and animate movements
        const viewUpdate = this.cameraController.onPlayerMove(this.store, playerPos.gridId);
        this.currentViewPath = viewUpdate.targetView;

        // Convert push chain to movements and animate
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
    this.cameraAnimationSystem.stop();
    this.isAnimating = false;
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

    // Update camera view
    const playerPos = this.playerPosition;
    if (playerPos) {
      const view = this.cameraController.getInitialView(this.store, playerPos.gridId);
      this.currentViewPath = view.targetView;
    }

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

    // Update camera view for new player position
    const playerPos = this.playerPosition;
    if (playerPos) {
      const view = this.cameraController.getInitialView(this.store, playerPos.gridId);
      this.currentViewPath = view.targetView;
    }

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

    // Update camera view for new player position
    const playerPos = this.playerPosition;
    if (playerPos) {
      const view = this.cameraController.getInitialView(this.store, playerPos.gridId);
      this.currentViewPath = view.targetView;
    }

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

      // Update both animation systems
      this.animationSystem.update(deltaTime);
      this.cameraAnimationSystem.update(deltaTime);

      // Re-render (camera animation will be applied in render method)
      this.render(false);

      // Continue if either animation is active
      const cellAnimating = this.animationSystem.getState().playing;
      const cameraAnimating = this.cameraAnimationSystem.getState().playing;

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
   * Rebuild scene data (analyze + build scene) without rendering.
   * Used when we want to prepare for animation.
   */
  private rebuildSceneData(): void {
    const playerPos = this.playerPosition;
    if (!playerPos) return;

    // Use current view path (automatic or manual)
    const viewPath = this.manualViewPath ?? this.currentViewPath;
    if (!viewPath || viewPath.length === 0) {
      console.error('No view path available for rebuild');
      return;
    }

    // Get the root grid (first in path)
    const gridId = viewPath[0];
    const grid = getGrid(this.store, gridId);
    if (!grid) {
      console.error(`Rebuild: Grid '${gridId}' not found`);
      return;
    }

    // Calculate camera position using scale helper
    const scaleResult = getScaleAndOffset(this.store, viewPath);
    if (!scaleResult) {
      console.error(`Rebuild: Invalid path ${viewPath.join(' → ')}`);
      return;
    }

    // Convert to world coordinates
    const refX = scaleResult.centerX - grid.cols / 2;
    const refZ = scaleResult.centerY - grid.rows / 2;
    const diagonal = Math.sqrt(scaleResult.width ** 2 + scaleResult.height ** 2);
    const viewWidth = diagonal * this.zoomMultiplier;

    // Phase 1: Analyze grid to build CellTree
    this.currentCellTree = analyze(this.store, gridId, grid.cols, grid.rows, /*threshold = */RENDER_THRESHOLD);

    // Phase 2: Build scene from CellTree
    const result = buildIsometricScene(this.currentCellTree, {
      width: this.renderWidth,
      height: this.renderHeight,
      highlightPosition: playerPos,
      store: this.store,
      tagFn: this.tagFn
    });

    this.currentScene = result.scene;

    // Create camera with calculated position
    this.currentCamera = createParagridCamera(
      [refX, 0, refZ],
      viewWidth,
      this.renderWidth,
      this.renderHeight
    );

    // Ensure renderer is ready
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
    forceRebuild: boolean = false
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

        // Determine which view path to use (manual or automatic)
        const viewPath = this.manualViewPath ?? this.currentViewPath;
        if (!viewPath || viewPath.length === 0) {
          throw new Error('No view path available');
        }

        console.log('Using view path:', viewPath);

        // Get the root grid (first in path)
        const gridId = viewPath[0];
        const grid = getGrid(this.store, gridId);
        if (!grid) {
          throw new Error(`View path: Grid '${gridId}' not found`);
        }

        // Use camera helpers to calculate view
        const scaleResult = getScaleAndOffset(this.store, viewPath);
        if (!scaleResult) {
          throw new Error(`View path: Invalid path ${viewPath.join(' → ')}`);
        }

        // Calculate camera center and view width
        // The scale helper returns center and dimensions in a coordinate system where
        // path[0] cells have width/height 1
        // We need to convert this to world coordinates for the renderer

        // Convert from scaleResult coordinates to world coordinates
        // scaleResult uses [0, cols] x [0, rows] space with center at (cols/2, rows/2)
        // World coordinates have grid center at (0, 0)
        const refX = scaleResult.centerX - grid.cols / 2;
        const refZ = scaleResult.centerY - grid.rows / 2;

        // Calculate diagonal size of the focused grid
        const diagonal = Math.sqrt(scaleResult.width ** 2 + scaleResult.height ** 2);

        // Apply zoom multiplier (only in manual mode, or always?)
        const viewWidth = diagonal * this.zoomMultiplier;

        console.log('Camera view:', {
          path: viewPath,
          center: [refX, 0, refZ],
          viewWidth,
          scaleResult
        });

        // Phase 1: Analyze grid to build CellTree
        this.currentCellTree = analyze(this.store, gridId, grid.cols, grid.rows, /*threshold = */RENDER_THRESHOLD);

        // Phase 2: Build scene from CellTree (without rendering yet)
        const result = buildIsometricScene(this.currentCellTree, {
          width: this.renderWidth,
          height: this.renderHeight,
          highlightPosition: playerPos,
          store: this.store,
          tagFn: this.tagFn
        });

        this.currentScene = result.scene;

        // Create camera using calculated position and view width
        this.currentCamera = createParagridCamera(
          [refX, 0, refZ],
          viewWidth,
          this.renderWidth,
          this.renderHeight
        );

        console.log('Camera created with createParagridCamera');

        // Create new renderer after clearing canvas
        this.currentRenderer = new Renderer({
          target: this.canvas,
          backend: 'svg',
          width: this.renderWidth,
          height: this.renderHeight
        });

        // Apply camera animation if active
        const activeCamera = this.cameraAnimationSystem.evaluateCamera(this.currentCamera);

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

        // Apply camera animation if active
        const activeCamera = this.cameraAnimationSystem.evaluateCamera(this.currentCamera);

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

      // Show current view path
      const viewPath = this.manualViewPath ?? this.currentViewPath;
      if (viewPath && viewPath.length > 0) {
        statusHtml += `
          <div class="status-line"><strong>View Path:</strong> ${viewPath.join(' → ')}</div>
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
    main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ _ _ 2 _ 9|9 _ _ _ _ _ _ 9|9 _ _ _ _ _ _ _|9 _ _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
    inner: '9 9 1 9 9|9 _ *inner _ 9|9 _ main _ 9|9 _ _ _ 9|9 9 9 9 9'
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
    b: '9 9 9 9|9 9 _ _|9 9 9 9|9 9 9 9',
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
