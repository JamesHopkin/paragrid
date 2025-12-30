/**
 * Simple isometric renderer for paragrid grids.
 * Renders grids directly without analyzer - shows flat checkerboard floor with cubes for concrete cells.
 */

import { SceneBuilder, Camera, cube, rectangle, project, Renderer } from 'iso-render';
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
): void {
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

  // Create checkerboard floor tiles
  builder.object('floor-light', rectangle(0.9, 0.9));
  builder.object('floor-dark', rectangle(0.9, 0.9));

  // Create cube for concrete cells
  builder.object('concrete-cube', cube(0.6));

  const gridColor = getGridColor(grid.id);
  const floorLight = '#3a3a3a';
  const floorDark = '#2a2a2a';

  // Center the grid around the origin
  const offsetX = -(grid.cols - 1) / 2;
  const offsetZ = -(grid.rows - 1) / 2;

  // Render each cell
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

      // Checkerboard pattern
      const isLight = (row + col) % 2 === 0;
      const floorObject = isLight ? 'floor-light' : 'floor-dark';
      const floorColor = isLight ? floorLight : floorDark;

      // Add floor tile
      builder.instance(floorObject, {
        position: [x, 0, z],
        color: isHighlighted ? '#ffff00' : floorColor
      });

      // Add concrete cell as floating cube
      if (isConcrete(cell)) {
        builder.instance('concrete-cube', {
          position: [x, 0.3, z],
          color: isHighlighted ? '#ffaa00' : gridColor
        });
      }
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
}
