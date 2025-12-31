/**
 * Interactive isometric demo with WASD navigation.
 */

import { parseGrids } from './lib/parser/parser.js';
import type { GridStore } from './lib/core/types.js';
import type { Cell } from './lib/core/types.js';
import { Concrete, isConcrete, getGrid } from './lib/core/types.js';
import type { CellPosition } from './lib/core/position.js';
import { Direction } from './lib/core/direction.js';
import { push } from './lib/operations/push.js';
import { createRuleSet } from './lib/operations/rules.js';
import type { PushFailure } from './lib/operations/failure.js';
import { findTaggedCell } from './lib/tagging/index.js';
import type { TagFn } from './lib/tagging/types.js';
import { analyze } from './lib/analyzer/index.js';
import { renderIsometric, buildIsometricScene } from './lib/renderer/isometric.js';
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

  private attemptPush(direction: Direction): void {
    // Prevent input during animation
    if (this.isAnimating) {
      return;
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

    // Success - snapshot positions and update store
    const oldCellPositions = this.snapshotCellPositions(playerPos.gridId);
    this.store = result;

    // Find new player position
    const newPos = this.playerPosition;
    if (newPos) {
      this.statusMessage = `✓ Pushed ${direction}! Player at [${newPos.row}, ${newPos.col}]`;

      // Check if we changed grids
      const changedGrids = playerPos.gridId !== newPos.gridId;

      if (changedGrids) {
        // Grid transition - stop any animations and force full rebuild
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
        // Same grid - detect movements and animate
        const movements = this.detectMovements(playerPos.gridId, oldCellPositions);

        if (movements.length > 0) {
          // Will animate - rebuild scene data but animation will handle rendering
          this.rebuildSceneData();
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

  private isPushFailure(result: GridStore | PushFailure): result is PushFailure {
    return 'reason' in result && 'position' in result;
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
            position: { gridId, row, col }
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

        const newPos: CellPosition = { gridId, row, col };

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
              cellKey = `concrete:${newCell.id}`;
              break;
            }
          }
        } else if (newCell.type === 'ref') {
          // For reference cells, match by gridId
          const matches = oldSnapshot.filter(s => s.cell.type === 'ref' && s.cell.gridId === newCell.gridId);
          const exactMatch = matches.find(m => m.position.row === newPos.row && m.position.col === newPos.col);

          if (exactMatch) {
            // Cell didn't move - don't animate
            continue;
          }

          // No exact match - find one that moved one square
          for (const match of matches) {
            if (this.isSingleSquareMovement(match.position, newPos)) {
              oldPos = match.position;
              cellKey = `ref:${newCell.gridId}:${newPos.row}:${newPos.col}`;
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

  private reset(): void {
    this.store = this.originalStore;
    this.statusMessage = 'Grid reset to original state';
    this.previousPlayerPosition = this.playerPosition ?? null;
    this.animationSystem.stop();
    this.isAnimating = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Force rebuild to clear any animation state
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
   * All animations play simultaneously.
   */
  private createMultipleMovementAnimations(movements: Array<{
    cellId: string;
    oldPos: CellPosition;
    newPos: CellPosition;
  }>): void {
    if (movements.length === 0) return;

    const duration = 0.3; // 300ms animation
    const animations: Array<{
      nodeId: string;
      channels: Array<{
        target: 'position' | 'rotation' | 'scale';
        interpolation: 'linear';
        keyFrames: Array<{ time: number; value: [number, number, number]; easing?: any }>;
      }>;
    }> = [];

    for (const movement of movements) {
      const { oldPos, newPos } = movement;

      // The content group is positioned at [0, 0, 0] relative to its parent cell group
      // The parent cell group is positioned at the NEW cell's world coordinates
      // To animate from the old position, we need a RELATIVE offset from new to old
      const relativeOffset: [number, number, number] = [
        oldPos.col - newPos.col,  // Difference in column
        0,
        oldPos.row - newPos.row   // Difference in row
      ];
      const targetPos: [number, number, number] = [0, 0, 0]; // End at natural position

      // The root grid is rendered directly with content group IDs: root-cell-row-col-content
      const contentGroupId = `root-cell-${newPos.row}-${newPos.col}-content`;

      animations.push({
        nodeId: contentGroupId,
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

    // Create a single animation clip with all cell animations
    const animationClip: AnimationClip = {
      id: 'push-move',
      duration,
      loop: false,
      animations
    };

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
        this.animationFrameId = null;
        this.isAnimating = false;
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
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
        this.currentRenderer.render(screenSpace);
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
    }

    statusHtml += `
      <div class="controls">
        <strong>Controls:</strong><br>
        <span class="key">W/A/S/D</span> - Move (Push)<br>
        <span class="key">R</span> - Reset<br>
        <strong style="margin-top: 0.5rem; display: inline-block;">Export:</strong><br>
        See button below for scene JSON
      </div>
    `;

    this.statusEl.innerHTML = statusHtml;
  }
}

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
  const gridDefinition = {
      main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ 2 _ _ _ _ 9|9 _ main _ _ *inner _ 9|9 _ _ _ _ _ _ _|9 1 _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
      inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'

      // main: "_ _ _|1 _ main|_ _ _"
  };
  
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
