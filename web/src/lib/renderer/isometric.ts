/**
 * Isometric renderer for analyzed paragrid grids (CellTree).
 * Renders grids using the two-phase approach: analyze → render.
 *
 * This renderer accepts CellNode trees from the analyzer and builds
 * an isometric scene with checkerboard floors and floating cubes.
 */

import { SceneBuilder, Camera, cube, project, Renderer, type Scene } from 'iso-render';
import type { CellNode, NestedNode, ConcreteNode, RefNode } from '../analyzer/types.js';
import { isNestedNode, isConcreteNode, isRefNode, isEmptyNode, isCutoffNode } from '../analyzer/types.js';
import type { CellPosition } from '../core/position.js';

/**
 * Render options for the isometric renderer.
 */
export interface RenderOptions {
  width: number;
  height: number;
  target: HTMLElement;
  highlightPosition?: CellPosition;
}

/**
 * Result of rendering including the scene for serialization.
 */
export interface RenderResult {
  scene: Scene;
}

/**
 * Get a color for a grid based on its ID.
 */
function getGridColor(gridId: string): string {
  // Simple hash-based color generation
  let hash = 0;
  for (let i = 0; i < gridId.length; i++) {
    hash = gridId.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Render a CellTree in isometric view.
 *
 * @param root - Root CellNode from analyzer
 * @param options - Rendering options (dimensions, target element, highlight)
 * @returns RenderResult with scene for serialization
 */
export function renderIsometric(
  root: CellNode,
  options: RenderOptions
): RenderResult {
  const { width, height, target, highlightPosition } = options;

  // Root must be a NestedNode
  if (!isNestedNode(root)) {
    throw new Error('Root node must be a NestedNode');
  }

  const builder = new SceneBuilder();

  // Setup background and lighting
  builder
    .background({ type: 'solid', color: '#2a2a2a' })
    .light({
      direction: [1, 2, 1],
      color: '#ffffff',
      ambient: 0.5
    });

  // Define reusable objects
  const squareSize = 0.9;
  builder.object('floor-square', {
    type: 'shape',
    vertices: [
      [0, 0, 0],                    // back-right (origin)
      [-squareSize, 0, 0],          // back-left
      [-squareSize, 0, squareSize], // front-left
      [0, 0, squareSize]            // front-right
    ]
  });

  builder.object('concrete-cube', cube(0.6));
  builder.object('debug-marker', cube(0.15));

  const floorLight = '#3a3a3a';
  const floorDark = '#2a2a2a';

  // Get root grid dimensions
  const rows = root.children.length;
  const cols = root.children[0]?.length || 0;

  // Create base floor
  const baseWidth = cols - 0.1;
  const baseHeight = rows - 0.1;
  builder.object('floor-base', {
    type: 'shape',
    vertices: [
      [0, 0, 0],
      [-baseWidth, 0, 0],
      [-baseWidth, 0, baseHeight],
      [0, 0, baseHeight]
    ]
  });

  // Center the grid around the origin
  const offsetX = -(cols - 1) / 2;
  const offsetZ = -(rows - 1) / 2;

  // Add base floor
  builder.instance('floor-base', {
    position: [baseWidth / 2, 0, -baseHeight / 2],
    color: floorDark
  });

  // Render grid contents recursively
  renderNestedNode(root, builder, offsetX, offsetZ, floorLight, squareSize, highlightPosition);

  // Build scene
  const scene = builder.build();

  // Setup camera
  const maxDim = Math.max(rows, cols);
  const scale = Math.min(width, height) / (maxDim * 1.5);

  const camera = Camera.trueIsometric(scale, [
    width / 2 - 370,
    height / 2 - 340
  ]);

  // Project to screen space
  const screenSpace = project(scene, camera, width, height);

  // Render to DOM
  const renderer = new Renderer({
    target,
    backend: 'svg',
    width,
    height
  });

  renderer.render(screenSpace);

  return { scene };
}

/**
 * Render a NestedNode's children.
 */
function renderNestedNode(
  node: NestedNode,
  builder: SceneBuilder,
  offsetX: number,
  offsetZ: number,
  floorLight: string,
  squareSize: number,
  highlightPosition?: CellPosition
): void {
  const gridColor = getGridColor(node.gridId);

  for (let row = 0; row < node.children.length; row++) {
    for (let col = 0; col < node.children[row].length; col++) {
      const child = node.children[row][col];
      const isHighlighted = highlightPosition &&
                           highlightPosition.gridId === node.gridId &&
                           highlightPosition.row === row &&
                           highlightPosition.col === col;

      // Position in 3D space
      const x = col + offsetX;
      const z = row + offsetZ;

      // Start a group for this cell
      builder.group(`cell-${node.gridId}-${row}-${col}`, {
        position: [x, 0, z]
      });

      // Render floor (checkerboard pattern)
      const isLight = (row + col) % 2 === 0;
      const floorOffsetX = squareSize / 2;
      const floorOffsetZ = -squareSize / 2;

      if (isLight) {
        builder.instance('floor-square', {
          position: [floorOffsetX, 0, floorOffsetZ],
          color: isHighlighted ? '#ffff00' : floorLight
        });

        // Debug marker for back edge cells (row = 0)
        if (row === 0) {
          builder.instance('debug-marker', {
            position: [floorOffsetX, 0.2, floorOffsetZ],
            color: '#ff0000'  // Red debug marker
          });
        }
      } else if (isHighlighted) {
        builder.instance('floor-square', {
          position: [floorOffsetX, 0, floorOffsetZ],
          color: '#ffff00'
        });
      }

      // Render cell content
      renderCellNode(child, builder, gridColor, isHighlighted);

      builder.endGroup();
    }
  }
}

/**
 * Render an individual cell node.
 */
function renderCellNode(
  node: CellNode,
  builder: SceneBuilder,
  gridColor: string,
  isHighlighted: boolean | undefined
): void {
  if (isConcreteNode(node)) {
    // Render concrete cell as cube
    builder.instance('concrete-cube', {
      position: [0, 0.3, 0],
      color: isHighlighted === true ? '#ffaa00' : gridColor
    });
  } else if (isEmptyNode(node)) {
    // Empty - no content to render
  } else if (isCutoffNode(node)) {
    // Cutoff - render nothing for now
    // TODO: Could add a small marker or different floor color
  } else if (isRefNode(node)) {
    // TODO: Phase 3 - implement reference rendering
    // For now, just skip refs
    console.warn('RefNode rendering not yet implemented');
  } else if (isNestedNode(node)) {
    // This shouldn't happen in normal traversal
    console.warn('Unexpected NestedNode in cell position');
  }
}
