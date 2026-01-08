/**
 * Interactive isometric demo with WASD navigation.
 */

import { parseGrids } from './lib/parser/parser.js';
import type { GridStore, Grid } from './lib/core/types.js';
import type { Cell } from './lib/core/types.js';
import { Concrete, isConcrete, getGrid } from './lib/core/types.js';
import { CellPosition } from './lib/core/position.js';
import { Direction } from './lib/core/direction.js';
import { push, type PushResult, detectGridTransition } from './lib/operations/push.js';
import { createRuleSet } from './lib/operations/rules.js';
import type { PushFailure } from './lib/operations/failure.js';
import { findTaggedCell } from './lib/tagging/index.js';
import type { TagFn } from './lib/tagging/types.js';
import { analyze } from './lib/analyzer/index.js';
import { findPrimaryRef } from './lib/utils/immutable.js';
import { findHighestAncestor } from './lib/utils/hierarchy.js';
import { renderIsometric, buildIsometricScene, createParagridCamera } from './lib/renderer/isometric.js';
import { sceneToJSON, type Scene, project, Camera, Renderer, type ScreenSpace } from 'iso-render';
import type { CellNode } from './lib/analyzer/types.js';
import { getScaleAndOffset, getCellWorldPosition, calculateCameraForView, HierarchyHelper, ParentViewCameraController, AnimatedParentViewCameraController, type CameraController, type ViewPath, type ViewUpdate } from './lib/camera/index.js';
import { chainToMovements, ParagridAnimator, type Movement } from './lib/animations/index.js';

const CAMERA_ANIMATION_DURATION = 0.3; // 300ms in seconds
const RENDER_THRESHOLD = 1/64;

/**
 * Configuration options parsed from query string.
 *
 * Available query parameters:
 * - fullscreen=true: Enable fullscreen mode with burger menu
 * - scene=<name>: Select scene (swap, simple, doubleExit, etc.)
 * - hideControls=true: Hide side controls panel
 * - hideHeader=true: Hide title and description
 * - mobile=true: Enable mobile controls with diagonal arrow buttons
 *
 * Examples:
 * - demo-iso.html?fullscreen=true&hideHeader=true&hideControls=true
 * - demo-iso.html?scene=swap
 * - demo-iso.html?fullscreen=true&scene=simple
 * - demo-iso.html?mobile=true&fullscreen=true&hideHeader=true&hideControls=true
 */
interface DemoConfig {
  fullscreen: boolean;
  scene: string;
  hideControls: boolean;
  hideHeader: boolean;
  mobile: boolean;
}

/**
 * Parse query string parameters into configuration.
 */
function parseConfig(): DemoConfig {
  const params = new URLSearchParams(window.location.search);
  return {
    fullscreen: params.get('fullscreen') === 'true',
    scene: params.get('scene') || 'indirectSelfRef',
    hideControls: params.get('hideControls') === 'true',
    hideHeader: params.get('hideHeader') === 'true',
    mobile: params.get('mobile') === 'true',
  };
}

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
  private animator: ParagridAnimator;
  private previousPlayerPosition: CellPosition | null = null;
  private renderWidth = 800;
  private renderHeight = 600;
  private readonly allowRapidInput = true; // Set to true to cancel animations on new input
  private readonly isFullscreen: boolean;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimeout: number | null = null;
  private undoStack: GridStore[] = []; // Stack of previous states
  private redoStack: GridStore[] = []; // Stack of undone states
  private readonly maxHistorySize = 50; // Limit to prevent memory issues
  private manualViewPath: string[] | null = null; // Manual view path (grid names)
  private manualViewInputEl: HTMLInputElement | null = null;
  private manualViewStatusEl: HTMLElement | null = null;
  private zoomSliderEl: HTMLInputElement | null = null;
  private zoomValueEl: HTMLElement | null = null;
  private zoomMultiplier: number = 1.0; // Exponential zoom multiplier (2^sliderValue)
  private hierarchyHelper: HierarchyHelper; // Hierarchy helper for camera
  private cameraController: CameraController; // Camera protocol implementation
  private currentViewPath: ViewPath | null = null; // Current automatic view path
  private cameraControllerSelectEl: HTMLSelectElement | null = null; // Camera controller dropdown
  private trackObjectAnimations: boolean = false; // Whether camera should track object animations

  constructor(
    store: GridStore,
    tagFn: TagFn,
    canvas: HTMLElement,
    statusEl: HTMLElement,
    isFullscreen: boolean = false
  ) {
    this.store = store;
    this.originalStore = store;
    this.tagFn = tagFn;
    this.canvas = canvas;
    this.statusEl = statusEl;
    this.isFullscreen = isFullscreen;
    this.animator = new ParagridAnimator({
      movementDuration: 0.3,
      cameraDuration: CAMERA_ANIMATION_DURATION
    });

    // Set initial dimensions
    this.updateDimensions();

    // Initialize hierarchy helper and camera controller
    this.hierarchyHelper = new HierarchyHelper(this.store);
    this.cameraController = new AnimatedParentViewCameraController(this.hierarchyHelper);

    // Store initial player position
    this.previousPlayerPosition = this.playerPosition ?? null;

    // Get initial view from camera controller
    const playerPos = this.playerPosition;
    if (playerPos) {
      const initialView = this.cameraController.getInitialView(playerPos.gridId);
      this.currentViewPath = initialView.targetView;
    }

    this.setupKeyboardHandlers();
    this.setupExportButton();
    this.setupManualViewControls();
    this.setupAnimationStatusPanel();
    this.setupResizeHandler();
    this.render();
  }

  private get playerPosition(): CellPosition | null | undefined {
    return findTaggedCell(this.store, this.playerTag, this.tagFn);
  }

  /**
   * Update render dimensions based on canvas size.
   */
  private updateDimensions(): void {
    if (this.isFullscreen) {
      // Use actual canvas client dimensions
      const rect = this.canvas.getBoundingClientRect();
      this.renderWidth = rect.width;
      this.renderHeight = rect.height;
    } else {
      // Use fixed dimensions for standard mode
      this.renderWidth = 800;
      this.renderHeight = 600;
    }
  }

  /**
   * Setup resize handler for fullscreen mode.
   */
  private setupResizeHandler(): void {
    if (!this.isFullscreen) {
      return;
    }

    // Use ResizeObserver for more accurate size tracking
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
    this.resizeObserver.observe(this.canvas);

    // Also listen to window resize as fallback
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  /**
   * Handle window/canvas resize events with debouncing.
   */
  private handleResize(): void {
    // Debounce resize to avoid excessive re-renders
    if (this.resizeTimeout !== null) {
      window.clearTimeout(this.resizeTimeout);
    }

    this.resizeTimeout = window.setTimeout(() => {
      const oldWidth = this.renderWidth;
      const oldHeight = this.renderHeight;

      this.updateDimensions();

      // Only re-render if dimensions actually changed
      if (this.renderWidth !== oldWidth || this.renderHeight !== oldHeight) {
        // Force rebuild to recreate renderer with new dimensions
        this.render(true);
      }

      this.resizeTimeout = null;
    }, 100); // 100ms debounce
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
    this.cameraControllerSelectEl = document.getElementById('camera-controller-select') as HTMLSelectElement;

    // Setup camera controller selector
    if (this.cameraControllerSelectEl) {
      this.cameraControllerSelectEl.addEventListener('change', () => {
        this.switchCameraController();
      });
    }

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

  private setupAnimationStatusPanel(): void {
    const animationStatusContent = document.getElementById('animation-status-content');
    if (!animationStatusContent) return;

    // Poll animation status every 100ms
    setInterval(() => {
      const isAnimating = this.animator.isAnimating();
      const cellState = (this.animator as any).animationSystem.getState();
      const cameraState = (this.animator as any).cameraAnimationSystem.getState();

      if (!isAnimating && !cellState.playing && !cameraState.playing) {
        animationStatusContent.innerHTML = '<span style="color: #666;">No animations active</span>';
        return;
      }

      const lines: string[] = [];

      if (cellState.playing) {
        const clipIds = Object.keys((this.animator as any).animationSystem.clips || {});
        lines.push(`<span style="color: #4fc3f7;">Cell Animations:</span> ${clipIds.join(', ')}`);
      }

      if (cameraState.playing) {
        const clipIds = Object.keys((this.animator as any).cameraAnimationSystem.clips || {});
        lines.push(`<span style="color: #4fc3f7;">Camera Animations:</span> ${clipIds.join(', ')}`);
      }

      animationStatusContent.innerHTML = lines.join('<br>') || '<span style="color: #666;">No animations active</span>';
    }, 100);
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

    // Cancel any ongoing animation before rebuilding
    if (this.animator.isAnimating()) {
      this.cancelCurrentAnimation();
    }

    // Force re-render to apply new zoom
    this.currentScene = null;
    this.currentCellTree = null;
    this.currentRenderer = null;
    this.render(true);
  }

  /**
   * Switch between camera controller implementations.
   */
  private switchCameraController(): void {
    if (!this.cameraControllerSelectEl) return;

    const selectedValue = this.cameraControllerSelectEl.value;

    // Create new camera controller based on selection
    if (selectedValue === 'animated') {
      this.cameraController = new AnimatedParentViewCameraController(this.hierarchyHelper);
    } else {
      this.cameraController = new ParentViewCameraController(this.hierarchyHelper);
    }

    // Update current view to match new controller
    const playerPos = this.playerPosition;
    if (playerPos) {
      const view = this.cameraController.getInitialView(playerPos.gridId);
      this.currentViewPath = view.targetView;
    }

    // Force rebuild with new controller
    this.currentScene = null;
    this.currentCellTree = null;
    this.currentRenderer = null;
    this.render(true);
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
    if (this.animator.isAnimating()) {
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
    this.hierarchyHelper.setStore(this.store); // Update helper with new store
    const pushChain = result.chain;

    // Find new player position
    const newPos = this.playerPosition;
    if (newPos) {
      // Update previous position for next movement
      this.previousPlayerPosition = newPos;

      this.statusMessage = `✓ Pushed ${direction}! Player at [${newPos.row}, ${newPos.col}]`;

      // Skip camera controller updates if manual view is active
      if (this.manualViewPath) {
        // Just animate the movements without camera updates
        const movements = chainToMovements(this.store, pushChain, this.hierarchyHelper);
        if (movements.length > 0) {
          this.createMultipleMovementAnimations(movements);
        } else {
          this.render(true);
        }
        return;
      }

      // Check if we changed grids (enter/exit transitions)
      let viewUpdate: ViewUpdate | null = null;
      if (pushChain.length > 1) {
        if (pushChain[1].transition === 'enter') {
          viewUpdate = this.cameraController.onPlayerEnter(
            playerPos.gridId,
            newPos.gridId
          );
        } else if (pushChain[1].transition === 'exit') {
          viewUpdate = this.cameraController.onPlayerExit(
            playerPos.gridId,
            newPos.gridId
          );
        }
      }

        // otherwise fall back to movement below
      if (viewUpdate) {


        // Update current view
        const oldViewPath = this.currentViewPath;
        const newViewPath = viewUpdate.targetView;
        this.currentViewPath = newViewPath;
        this.trackObjectAnimations = viewUpdate.trackObjectAnimations ?? false;

        // Convert push chain to movements using hierarchy helper
        const movements = chainToMovements(this.store, pushChain, this.hierarchyHelper);

        // Handle camera and object animation
        if (viewUpdate.animationStartView && oldViewPath) {
          // Animate camera with optional object movements
          this.createAnimationWithCamera(movements, viewUpdate.animationStartView, viewUpdate.targetView);
        } else {
          // No animation - rebuild immediately
          this.animator.stop();
          // Clear everything to force complete rebuild with new view
          this.currentScene = null;
          this.currentCellTree = null;
          this.currentRenderer = null;
          this.render(true);
        }

        return;
      }

      // No player enter/exit - update view and animate movements
      viewUpdate = this.cameraController.onPlayerMove(playerPos.gridId);
      const newViewPath = viewUpdate.targetView;
      this.currentViewPath = newViewPath;
      this.trackObjectAnimations = viewUpdate.trackObjectAnimations ?? false;

      // Convert push chain to movements and animate
      const movements = chainToMovements(this.store, pushChain, this.hierarchyHelper);

      if (movements.length > 0) {
        // Create animations for all movements
        this.createMultipleMovementAnimations(movements);
      } else {
        // No animation - render immediately
        this.render(true);
      }
    } else {
      this.statusMessage = '✓ Push succeeded but player lost!';
      this.render(true);
    }
  }

  private isPushFailure(result: PushResult | PushFailure): result is PushFailure {
    return 'reason' in result && 'position' in result;
  }

  /**
   * Cancel any currently running animation.
   */
  private cancelCurrentAnimation(): void {
    this.animator.stop();
    // Remove animation clips to clear transform overrides
    this.animator.clear();
    // Force render to show the final state
    this.render(true);
  }

  private reset(): void {
    this.store = this.originalStore;
    this.hierarchyHelper.setStore(this.store); // Update helper with reset store
    this.statusMessage = 'Grid reset to original state';
    this.previousPlayerPosition = this.playerPosition ?? null;

    // Update camera view (only if not in manual view mode)
    if (!this.manualViewPath) {
      const playerPos = this.playerPosition;
      if (playerPos) {
        const view = this.cameraController.getInitialView(playerPos.gridId);
        this.currentViewPath = view.targetView;
      }
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
    this.hierarchyHelper.setStore(this.store); // Update helper with previous store

    // Update player position tracking
    this.previousPlayerPosition = this.playerPosition ?? null;

    // Update camera view for new player position (only if not in manual view mode)
    if (!this.manualViewPath) {
      const playerPos = this.playerPosition;
      if (playerPos) {
        const view = this.cameraController.getInitialView(playerPos.gridId);
        this.currentViewPath = view.targetView;
      }
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
    this.hierarchyHelper.setStore(this.store); // Update helper with next store

    // Update player position tracking
    this.previousPlayerPosition = this.playerPosition ?? null;

    // Update camera view for new player position (only if not in manual view mode)
    if (!this.manualViewPath) {
      const playerPos = this.playerPosition;
      if (playerPos) {
        const view = this.cameraController.getInitialView(playerPos.gridId);
        this.currentViewPath = view.targetView;
      }
    }

    // Full scene rebuild needed
    this.currentScene = null;
    this.currentCellTree = null;
    this.currentRenderer = null;

    this.statusMessage = '↷ Redo successful';
    this.render(true);
  }

  /**
   * Create animations for multiple cells that moved (world coordinates).
   */
  private createMultipleMovementAnimations(movements: Movement[]): void {
    if (movements.length === 0) return;

    // Rebuild scene data
    this.rebuildSceneData();

    // Check if we need to track the focused grid's movement with the camera
    let cameraTransition = undefined;
    if (this.trackObjectAnimations && this.currentViewPath && this.currentViewPath.length > 0) {
      const focusedGridId = this.currentViewPath[this.currentViewPath.length - 1];

      // Find the movement for the reference cell containing the focused grid
      // The cellId for a ref is "ref-${gridId}-${primary|secondary|auto}"
      const focusedMovement = movements.find(m =>
        m.cellId.startsWith(`ref-${focusedGridId}-`)
      );
      if (focusedMovement) {
        // console.log(`Tracking camera for focused grid '${focusedGridId}', movement:`, focusedMovement);
        // Calculate camera start and end positions based on the grid's movement
        const scaleResult = getScaleAndOffset(this.store, this.currentViewPath);
        if (scaleResult) {
          const grid = getGrid(this.store, this.currentViewPath[0]);
          if (grid) {
            const refX = scaleResult.centerX - grid.cols / 2;
            const refZ = scaleResult.centerY - grid.rows / 2;
            const diagonal = Math.sqrt(scaleResult.width ** 2 + scaleResult.height ** 2);
            const viewWidth = diagonal * this.zoomMultiplier;

            // Camera starts at old position (with object's old offset)
            const oldOffset = [
              focusedMovement.oldPos[0] - focusedMovement.newPos[0],
              focusedMovement.oldPos[1] - focusedMovement.newPos[1],
              focusedMovement.oldPos[2] - focusedMovement.newPos[2]
            ] as [number, number, number];

            cameraTransition = {
              start: {
                position: [refX + oldOffset[0], oldOffset[1], refZ + oldOffset[2]] as [number, number, number],
                viewWidth
              },
              end: {
                position: [refX, 0, refZ] as [number, number, number],
                viewWidth
              }
            };
          }
        }
      }
    }

    // Create and play animation using animator (with optional camera transition)
    this.animator.animate(movements, cameraTransition);

    // Start the animation loop
    this.startAnimationLoop();
  }

  /**
   * Start the animation loop using requestAnimationFrame
   */
  private startAnimationLoop(): void {
    this.animator.start(() => {
      // Re-render each frame (camera animation will be applied in render method)
      this.render(false);
    });
  }

  /**
   * Create animation with camera transition and optional object movements.
   * Animates both the camera (zoom) and objects (position) simultaneously.
   * Pass empty movements array for camera-only animation.
   */
  private createAnimationWithCamera(
    movements: Movement[],
    startViewPath: ViewPath,
    endViewPath: ViewPath
  ): void {
    // Calculate camera parameters for both views
    const startCameraParams = calculateCameraForView(this.store, startViewPath, this.zoomMultiplier);
    const endCameraParams = calculateCameraForView(this.store, endViewPath, this.zoomMultiplier);

    if (!startCameraParams || !endCameraParams) {
      console.warn('Failed to calculate camera positions for animation, falling back to instant transition');
      this.currentScene = null;
      this.currentCellTree = null;
      this.currentRenderer = null;
      this.render(true);
      return;
    }

    // Stop any existing animations
    this.animator.stop();

    // Rebuild scene at END view (target)
    this.currentScene = null;
    this.currentCellTree = null;
    this.currentRenderer = null;

    // Build scene at target view
    const playerPos = this.playerPosition;
    if (!playerPos) return;

    const gridId = endViewPath[0];
    const grid = getGrid(this.store, gridId);
    if (!grid) return;

    // Use endViewPath as focus path for focus metadata computation
    this.currentCellTree = analyze(
      this.store,
      gridId,
      grid.cols,
      grid.rows,
      RENDER_THRESHOLD,
      new Set(), // primaryRefs
      endViewPath // focusPath
    );
    const result = buildIsometricScene(this.currentCellTree, {
      width: this.renderWidth,
      height: this.renderHeight,
      highlightPosition: playerPos,
      store: this.store,
      tagFn: this.tagFn
    });
    this.currentScene = result.scene;

    // Create END camera
    const endCamera = createParagridCamera(
      endCameraParams.position,
      endCameraParams.viewWidth,
      this.renderWidth,
      this.renderHeight
    );
    this.currentCamera = endCamera;

    // Create renderer if needed
    if (!this.currentRenderer) {
      this.canvas.innerHTML = '';
      this.currentRenderer = new Renderer({
        target: this.canvas,
        backend: 'svg',
        width: this.renderWidth,
        height: this.renderHeight
      });
    }

    // Create and play combined animation using unified animator method
    this.animator.animate(movements, {
      start: startCameraParams,
      end: endCameraParams
    });

    // Render initial frame with transforms at t=0 before starting animation loop
    this.render(false);

    // Start animation loop
    this.startAnimationLoop();
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
    // Use viewPath as focus path for focus metadata computation
    this.currentCellTree = analyze(
      this.store,
      gridId,
      grid.cols,
      grid.rows,
      /*threshold = */ RENDER_THRESHOLD,
      new Set(), // primaryRefs
      viewPath // focusPath
    );

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

    let screenSpace: ScreenSpace;
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

        // Phase 1: Analyze grid to build CellTree
        // Use viewPath as focus path for focus metadata computation
        this.currentCellTree = analyze(
          this.store,
          gridId,
          grid.cols,
          grid.rows,
          /*threshold = */ RENDER_THRESHOLD,
          new Set(), // primaryRefs
          viewPath // focusPath
        );

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

        // Create new renderer after clearing canvas
        this.currentRenderer = new Renderer({
          target: this.canvas,
          backend: 'svg',
          width: this.renderWidth,
          height: this.renderHeight
        });

        // Apply camera animation if active
        let activeCamera = this.animator.evaluateCamera(this.currentCamera);

        // Now render the scene once
        screenSpace = project(
          this.currentScene,
          activeCamera,
          this.renderWidth,
          this.renderHeight
        );
      } else {
        // During animation: only update transform overrides and re-render
        const transformOverrides = this.animator.evaluateTransforms();

        // Apply camera animation if active (handles tracking via camera animation system)
        const activeCamera = this.animator.evaluateCamera(this.currentCamera);

        // Re-project with animation overrides
        screenSpace = project(
          this.currentScene,
          activeCamera,
          this.renderWidth,
          this.renderHeight,
          { transformOverrides }
        );
      }

      // the actual render!
      this.currentRenderer.render(screenSpace, { layers: (layerNum: number) => {
        return layerNum >= 1 ? { opacity: 0.5 } : { opacity: 1.0 };
      }});

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
    main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ 1 _ 2 _ 9|9 _ main _ _ *inner _ 9|' + 
          '9 _ _ _ _ _ _ _|9 _ _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
    inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9',
  },
  swapEdited: {
    main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ r_ 9|9 _ _ _ _ 2 _ 9|9 _ main _ _ *inner _ 9|' + 
          '9 _ _ _ _ _ _ _|9 _ _ _ _ _ a 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
    inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9',
    a: 'b _ _|_ _ _|_ 9 _',
    b: '1 _ _|_ _ _|_ 9 _'
  },

  indirectSelfRef: {
    main: '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ _ _ 2 a 9|9 _ _ _ _ *inner _ 9|' + 
          '9 _ _ _ _ _ _ _|9 _ _ _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
    inner: '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9',
    a: '~b _ _|*b 9 main|_ _ 9',
    b: '_ _ _|_ 1 _|_ _ 9'
  },

  simple: { main: '1 _ _|_ 9 _|_ _ 2' },
  doubleExit: {
    main: '_ _ _|a 2 1|_ _ _',
    a: 'b _ _|_ _ _|_ _ _',
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
   main: '_ _ _|_ a _|_ 2 _',
   a: '_ _ _|_ 1 _|_ _ _'
  },
};

/**
 * Apply UI configuration based on config.
 */
function applyUIConfig(config: DemoConfig): void {
  const container = document.querySelector('.container') as HTMLElement;
  const header = document.querySelector('h1') as HTMLElement;
  const description = document.querySelector('.description') as HTMLElement;
  const manualView = document.getElementById('manual-view');
  const animationStatus = document.getElementById('animation-status');
  const statusPanel = document.getElementById('status');
  const exportButtons = document.querySelector('.container > div:last-child') as HTMLElement;
  const canvas = document.getElementById('canvas') as HTMLElement;
  const demoArea = document.querySelector('.demo-area') as HTMLElement;

  // Apply fullscreen mode
  if (config.fullscreen) {
    document.body.style.padding = '0';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    if (container) {
      container.style.maxWidth = '100%';
      container.style.width = '100vw';
      container.style.height = '100vh';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.padding = '0';
    }
    if (canvas) {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.maxWidth = 'none';
      canvas.style.maxHeight = 'none';
      canvas.style.flex = '1';
      canvas.style.minHeight = '0';
    }
    if (demoArea) {
      demoArea.style.flex = '1';
      demoArea.style.marginTop = '0';
      demoArea.style.width = '100%';
      demoArea.style.minHeight = '0';
      demoArea.style.display = 'flex';
      demoArea.style.gap = '0';
    }
  }

  // Hide header if requested
  if (config.hideHeader) {
    if (header) header.style.display = 'none';
    if (description) description.style.display = 'none';
  }

  // Hide controls if requested
  if (config.hideControls) {
    if (manualView) manualView.style.display = 'none';
    if (animationStatus) animationStatus.style.display = 'none';
    if (statusPanel) statusPanel.style.display = 'none';
    if (exportButtons) exportButtons.style.display = 'none';
  }

  // Add burger menu for fullscreen mode
  if (config.fullscreen) {
    createBurgerMenu(config);
  }
}

/**
 * Create mobile control buttons with diagonal arrows.
 */
function createMobileControls(demo: IsometricDemo): void {
  const buttonSize = '80px';
  const buttonPadding = '1rem';

  const buttonStyle = `
    width: ${buttonSize};
    height: ${buttonSize};
    background: rgba(79, 195, 247, 0.8);
    color: #1a1a1a;
    border: 2px solid rgba(79, 195, 247, 1);
    border-radius: 12px;
    font-size: 2rem;
    cursor: pointer;
    z-index: 900;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  `;

  // Define buttons with their directions and arrows
  const buttons = [
    { id: 'mobile-north', direction: Direction.N, arrow: '↖', label: 'N' },
    { id: 'mobile-south', direction: Direction.S, arrow: '↘', label: 'S' },
    { id: 'mobile-west', direction: Direction.W, arrow: '↙', label: 'W' },
    { id: 'mobile-east', direction: Direction.E, arrow: '↗', label: 'E' },
  ];

  const mobileControlsContainer = document.createElement('div');
  mobileControlsContainer.id = 'mobile-controls';

  buttons.forEach(({ id, direction, arrow, label }) => {
    const button = document.createElement('button');
    button.id = id;
    button.innerHTML = arrow;
    button.setAttribute('aria-label', `Move ${label}`);
    button.style.cssText = buttonStyle + 'position: fixed;';

    // Add touch and click handlers
    const handlePress = (e: Event) => {
      e.preventDefault();
      (demo as any).attemptPush(direction);
    };

    button.addEventListener('touchstart', handlePress);
    button.addEventListener('click', handlePress);

    // Hover effect for desktop
    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(129, 212, 250, 0.9)';
      button.style.transform = 'scale(1.05)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(79, 195, 247, 0.8)';
      button.style.transform = 'scale(1)';
    });

    // Touch feedback
    button.addEventListener('touchstart', () => {
      button.style.background = 'rgba(41, 182, 246, 0.9)';
      button.style.transform = 'scale(0.95)';
    });
    button.addEventListener('touchend', () => {
      button.style.background = 'rgba(79, 195, 247, 0.8)';
      button.style.transform = 'scale(1)';
    });

    mobileControlsContainer.appendChild(button);
  });

  // Add container to body
  document.body.appendChild(mobileControlsContainer);

  // Apply positioning based on screen size
  updateMobileControlsPosition();

  // Update on resize
  window.addEventListener('resize', updateMobileControlsPosition);

  function updateMobileControlsPosition() {
    const northBtn = document.getElementById('mobile-north')!;
    const southBtn = document.getElementById('mobile-south')!;
    const westBtn = document.getElementById('mobile-west')!;
    const eastBtn = document.getElementById('mobile-east')!;

    // Detect if phone or tablet based on screen width
    const isPhone = window.innerWidth < 768; // Phone: < 768px, Tablet: >= 768px

    if (isPhone) {
      // Phone: One button in each corner
      // Bottom-left: West (↙ southwest)
      westBtn.style.bottom = buttonPadding;
      westBtn.style.left = buttonPadding;
      westBtn.style.top = 'auto';
      westBtn.style.right = 'auto';

      // Bottom-right: South (↘ southeast)
      southBtn.style.bottom = buttonPadding;
      southBtn.style.right = buttonPadding;
      southBtn.style.top = 'auto';
      southBtn.style.left = 'auto';

      // Top-left: North (↖ northwest)
      northBtn.style.top = buttonPadding;
      northBtn.style.left = buttonPadding;
      northBtn.style.bottom = 'auto';
      northBtn.style.right = 'auto';

      // Top-right: East (↗ northeast)
      eastBtn.style.top = buttonPadding;
      eastBtn.style.right = buttonPadding;
      eastBtn.style.bottom = 'auto';
      eastBtn.style.left = 'auto';
    } else {
      // Tablet: All four buttons clustered in bottom-left
      const spacing = '0.5rem';

      // West: bottom-left corner
      westBtn.style.bottom = buttonPadding;
      westBtn.style.left = buttonPadding;
      westBtn.style.top = 'auto';
      westBtn.style.right = 'auto';

      // East: to the right of West
      eastBtn.style.bottom = buttonPadding;
      eastBtn.style.left = `calc(${buttonPadding} + ${buttonSize} + ${spacing})`;
      eastBtn.style.top = 'auto';
      eastBtn.style.right = 'auto';

      // North: above West
      northBtn.style.bottom = `calc(${buttonPadding} + ${buttonSize} + ${spacing})`;
      northBtn.style.left = buttonPadding;
      northBtn.style.top = 'auto';
      northBtn.style.right = 'auto';

      // South: above East (top-right of the cluster)
      southBtn.style.bottom = `calc(${buttonPadding} + ${buttonSize} + ${spacing})`;
      southBtn.style.left = `calc(${buttonPadding} + ${buttonSize} + ${spacing})`;
      southBtn.style.top = 'auto';
      southBtn.style.right = 'auto';
    }
  }
}

/**
 * Create burger menu for fullscreen mode.
 */
function createBurgerMenu(config: DemoConfig): void {
  const burgerButton = document.createElement('button');
  burgerButton.id = 'burger-menu';
  burgerButton.innerHTML = '☰';
  burgerButton.style.cssText = `
    position: fixed;
    top: 1rem;
    right: 1rem;
    width: 3rem;
    height: 3rem;
    background: #4fc3f7;
    color: #1a1a1a;
    border: none;
    border-radius: 8px;
    font-size: 1.5rem;
    cursor: pointer;
    z-index: 1000;
    transition: background 0.2s;
  `;
  burgerButton.onmouseenter = () => burgerButton.style.background = '#81d4fa';
  burgerButton.onmouseleave = () => burgerButton.style.background = '#4fc3f7';

  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 999;
    align-items: center;
    justify-content: center;
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: #2a2a2a;
    border: 2px solid #444;
    border-radius: 8px;
    padding: 2rem;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    color: #e0e0e0;
  `;

  // Clone the controls into the modal
  const manualView = document.getElementById('manual-view');
  const animationStatus = document.getElementById('animation-status');
  const status = document.getElementById('status');
  const exportButtons = document.querySelector('.container > div:last-child');

  if (manualView) modalContent.appendChild(manualView.cloneNode(true));
  if (animationStatus) modalContent.appendChild(animationStatus.cloneNode(true));
  if (status) {
    const statusClone = status.cloneNode(true) as HTMLElement;
    statusClone.style.marginBottom = '1rem';
    modalContent.appendChild(statusClone);
  }
  if (exportButtons) modalContent.appendChild(exportButtons.cloneNode(true));

  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.className = 'export-button';
  closeButton.style.marginTop = '1rem';
  closeButton.onclick = () => modal.style.display = 'none';
  modalContent.appendChild(closeButton);

  modal.appendChild(modalContent);
  document.body.appendChild(burgerButton);
  document.body.appendChild(modal);

  burgerButton.onclick = () => {
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
  };

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };
}

// Initialize the demo when the page loads
document.addEventListener('DOMContentLoaded', () => {
  const config = parseConfig();

  // Select the scene based on config
  const sceneData = (GRIDS as any)[config.scene] || GRIDS.indirectSelfRef;
  const store = parseGrids(sceneData);

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

  // Apply UI configuration
  applyUIConfig(config);

  const demo = new IsometricDemo(store, tagFn, canvas, status, config.fullscreen);

  // Create mobile controls if enabled
  if (config.mobile) {
    createMobileControls(demo);
  }
});
