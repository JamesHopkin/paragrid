/**
 * Simple isometric renderer for paragrid grids.
 * Renders grids directly without analyzer - shows flat checkerboard floor with cubes for concrete cells.
 *
 * Checkerboard optimization: Renders one large base square plus half as many small squares for alternating color.
 * Z-sorting: Floor squares have their center at the back corner, groups have center at cell center.
 */

import { SceneBuilder, Camera, cube, rectangle, project, Renderer, type Scene } from 'iso-render';
import type { Grid, Cell } from '../core/types.js';
import { isConcrete, isEmpty } from '../core/types.js';
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
 * Render a single grid in isometric view.
 */
export function renderGridIsometric(
  grid: Grid,
  options: RenderOptions
): RenderResult {
  const { width, height, target, highlightPosition } = options;

  const builder = new SceneBuilder();

  // Setup background and lighting
  builder
    .background({ type: 'solid', color: '#2a2a2a' })
    .light({
      direction: [1, 2, 1],
      color: '#ffffff',
      ambient: 0.5
    });

  // Create floor tiles and content objects
  // Single large square covering entire grid
  builder.object('floor-base', rectangle(grid.cols - 0.1, grid.rows - 0.1));

  // Floor square with center at back corner for z-sorting
  // Standard rectangle is centered, so we offset vertices to move origin to back-right corner
  // Top of screen = highest X, lowest Z
  const squareSize = 0.9;
  const halfSize = squareSize / 2;
  builder.object('floor-square', {
    type: 'shape',
    vertices: [
      [0, 0, 0],                    // back-right (origin)
      [-squareSize, 0, 0],          // back-left
      [-squareSize, 0, squareSize], // front-left
      [0, 0, squareSize]            // front-right
    ]
  });

  // Cube for concrete cells
  builder.object('concrete-cube', cube(0.6));
  // Small debug cube for back edge visualization
  builder.object('debug-marker', cube(0.15));

  const gridColor = getGridColor(grid.id);
  const floorLight = '#3a3a3a';
  const floorDark = '#2a2a2a';

  // Center the grid around the origin
  const offsetX = -(grid.cols - 1) / 2;
  const offsetZ = -(grid.rows - 1) / 2;

  // Add base floor - covers entire grid in one color
  // The base is centered at the grid center
  builder.instance('floor-base', {
    position: [0, 0, 0],
    color: floorDark
  });

  // Render each cell in a group
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row][col];
      const isHighlighted = highlightPosition &&
                           highlightPosition.gridId === grid.id &&
                           highlightPosition.row === row &&
                           highlightPosition.col === col;

      // Position in 3D space, centered around origin (col = X, 0 = Y, row = Z)
      const x = col + offsetX;
      const z = row + offsetZ;

      // Start a group for this cell - group center is at cell center
      builder.group(`cell-${row}-${col}`, {
        position: [x, 0, z]
      });

      // Checkerboard pattern - only render light squares on top of dark base
      const isLight = (row + col) % 2 === 0;

      if (isLight) {
        // Floor square: object origin is at back-right corner, so we offset instance to center the square over the cell
        // Square extends from -squareSize to 0 in X, and 0 to squareSize in Z
        // Center is at [-squareSize/2, 0, squareSize/2], so we offset by [+squareSize/2, 0, -squareSize/2]
        const offsetX = squareSize / 2;
        const offsetZ = -squareSize / 2;
        builder.instance('floor-square', {
          position: [offsetX, 0, offsetZ],
          color: isHighlighted ? '#ffff00' : floorLight
        });

        // Debug marker for back edge cells (row = 0)
        // Position at the object origin (back-right corner = [0, 0, 0] in floor-square local space)
        if (row === 0) {
          builder.instance('debug-marker', {
            position: [offsetX, 0.2, offsetZ],
            color: '#ff0000'  // Red debug marker
          });
        }
      } else if (isHighlighted) {
        // For dark squares that are highlighted, we still need to draw them
        const offsetX = squareSize / 2;
        const offsetZ = -squareSize / 2;
        builder.instance('floor-square', {
          position: [offsetX, 0, offsetZ],
          color: '#ffff00'
        });
      }

      // Add concrete cell as floating cube - positioned at group center
      if (isConcrete(cell)) {
        builder.instance('concrete-cube', {
          position: [0, 0.3, 0],
          color: isHighlighted ? '#ffaa00' : gridColor
        });
      }

      // End the cell group
      builder.endGroup();
    }
  }

  // Build scene
  const scene = builder.build();

  // Setup camera - position it to see the whole grid centered
  // Scale the grid to fit nicely in the viewport with some padding
  const maxDim = Math.max(grid.rows, grid.cols);
  const scale = Math.min(width, height) / (maxDim * 1.5);  // 2x zoom

  // Camera offset - adjusted for 2x zoom
  const camera = Camera.trueIsometric(scale, [
    width / 2 - 370,  // Shift left significantly
    height / 2 - 340  // Shift up significantly
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
