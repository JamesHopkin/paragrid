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
import { renderIsometric } from './lib/renderer/isometric.js';
import { sceneToJSON, type Scene } from 'iso-render';

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
    const playerPos = this.playerPosition;

    if (!playerPos) {
      this.statusMessage = '❌ Error: No player found!';
      this.render();
      return;
    }

    console.log(`Attempting push ${direction} from ${playerPos.gridId}[${playerPos.row}, ${playerPos.col}]`);

    const result = push(
      this.store,
      playerPos,
      direction,
      createRuleSet(),
      this.tagFn
    );

    if (this.isPushFailure(result)) {
      // Push failed
      console.log('Push failed:', result);
      this.statusMessage = `❌ Push ${direction} failed: ${result.reason}`;
      if (result.details) {
        this.statusMessage += ` (${result.details})`;
      }
    } else {
      // Success - update store
      this.store = result;

      // Find new player position
      const newPos = this.playerPosition;
      if (newPos) {
        console.log(`Push succeeded! New position: ${newPos.gridId}[${newPos.row}, ${newPos.col}]`);
        this.statusMessage = `✓ Pushed ${direction}! Player at [${newPos.row}, ${newPos.col}]`;
      } else {
        this.statusMessage = '✓ Push succeeded but player lost!';
      }
    }

    this.render();
  }

  private isPushFailure(result: GridStore | PushFailure): result is PushFailure {
    return 'reason' in result && 'position' in result;
  }

  private reset(): void {
    this.store = this.originalStore;
    this.statusMessage = 'Grid reset to original state';
    this.render();
  }

  private render(): void {
    // Clear canvas
    this.canvas.innerHTML = '';

    const playerPos = this.playerPosition;

    if (!playerPos) {
      this.canvas.innerHTML = '<div style="color: red; padding: 20px;">Error: No player cell found!</div>';
      this.updateStatus();
      return;
    }

    // Get the grid containing the player
    const grid = getGrid(this.store, playerPos.gridId);

    if (!grid) {
      this.canvas.innerHTML = `<div style="color: red; padding: 20px;">Error: Player grid not found!</div>`;
      this.updateStatus();
      return;
    }

    // Analyze and render the grid
    try {
      // Phase 1: Analyze grid to build CellTree
      const cellTree = analyze(this.store, playerPos.gridId, grid.cols, grid.rows);

      // Phase 2: Render CellTree to isometric scene
      const result = renderIsometric(cellTree, {
        width: 800,
        height: 600,
        target: this.canvas,
        highlightPosition: playerPos,
        store: this.store,
        tagFn: this.tagFn
      });
      this.currentScene = result.scene;
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
      main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ 2 _ _ _ _ 9|9 _ main _ _ *inner _ 9|9 _ _ _ _ _ _ _|9 _ 1 _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
      inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'
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
