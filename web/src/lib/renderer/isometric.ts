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
 * Render a CellTree in isometric view using the three-pass reference approach.
 *
 * Pass 1: Collect all unique grids
 * Pass 2: Build geometry once per unique grid
 * Pass 3: Instantiate grids using references
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

  const floorLight = '#3a3a3a';
  const floorDark = '#2a2a2a';

  // PASS 1: Collect all unique grids
  const uniqueGrids = new Set<string>();
  collectUniqueGrids(root, uniqueGrids);

  // PASS 2: Build geometry once per unique grid
  const geometryGroups = new Map<string, string>();

  // We need to walk the tree to find NestedNodes and build their geometry
  function buildAllGeometry(node: CellNode): void {
    if (isNestedNode(node)) {
      buildGridGeometry(node, builder, floorLight, squareSize, geometryGroups);
      // Recursively build geometry for children
      for (const row of node.children) {
        for (const child of row) {
          buildAllGeometry(child);
        }
      }
    } else if (isRefNode(node)) {
      buildAllGeometry(node.content);
    }
  }

  buildAllGeometry(root);

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

  // PASS 3: Render grid contents recursively using old approach for now
  // TODO: Eventually this should use references everywhere, but for now we
  // keep the old rendering and add ref support incrementally
  renderNestedNode(root, builder, offsetX, offsetZ, floorLight, squareSize, highlightPosition, geometryGroups);

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
  highlightPosition: CellPosition | undefined,
  geometryGroups: Map<string, string>
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
      } else if (isHighlighted) {
        builder.instance('floor-square', {
          position: [floorOffsetX, 0, floorOffsetZ],
          color: '#ffff00'
        });
      }

      // Render cell content
      renderCellNode(child, builder, gridColor, isHighlighted, geometryGroups);

      builder.endGroup();
    }
  }
}

/**
 * Collect all unique grid IDs from the cell tree.
 * This is the first pass of the three-pass reference rendering approach.
 *
 * @param node - Root node to collect from
 * @param grids - Set to accumulate unique grid IDs
 */
function collectUniqueGrids(node: CellNode, grids: Set<string>): void {
  if (isNestedNode(node)) {
    grids.add(node.gridId);
    for (const row of node.children) {
      for (const child of row) {
        collectUniqueGrids(child, grids);
      }
    }
  } else if (isRefNode(node)) {
    collectUniqueGrids(node.content, grids);
  }
}

/**
 * Build geometry for a single grid at the origin.
 * This geometry will be reused via references for all instances of this grid.
 *
 * @param node - NestedNode representing the grid
 * @param builder - Scene builder
 * @param floorLight - Light floor color
 * @param squareSize - Size of floor squares
 * @param geometryGroups - Map tracking built geometry
 * @returns The group ID for this grid's geometry
 */
function buildGridGeometry(
  node: NestedNode,
  builder: SceneBuilder,
  floorLight: string,
  squareSize: number,
  geometryGroups: Map<string, string>
): string {
  // Check if already built
  if (geometryGroups.has(node.gridId)) {
    return geometryGroups.get(node.gridId)!;
  }

  const groupId = `grid-geom-${node.gridId}`;
  const gridColor = getGridColor(node.gridId);

  builder.group(groupId, { position: [0, 0, 0] });

  // Render grid contents at origin (no offset)
  const rows = node.children.length;
  const cols = node.children[0]?.length || 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const child = node.children[row][col];

      // Position relative to grid origin
      const x = col;
      const z = row;

      // Start a group for this cell
      builder.group(`${groupId}-cell-${row}-${col}`, {
        position: [x, 0, z]
      });

      // Render floor (checkerboard pattern)
      const isLight = (row + col) % 2 === 0;
      const floorOffsetX = squareSize / 2;
      const floorOffsetZ = -squareSize / 2;

      if (isLight) {
        builder.instance('floor-square', {
          position: [floorOffsetX, 0, floorOffsetZ],
          color: floorLight
        });
      }

      // Render cell content (concrete cells only for now - refs handled in instantiation)
      if (isConcreteNode(child)) {
        builder.instance('concrete-cube', {
          position: [0, 0.3, 0],
          color: gridColor
        });
      }
      // Empty, Cutoff, and Ref nodes don't add geometry here
      // Refs will be instantiated in the third pass

      builder.endGroup();
    }
  }

  builder.endGroup();
  geometryGroups.set(node.gridId, groupId);
  return groupId;
}

/**
 * Render an individual cell node using ts-poly references for RefNodes.
 *
 * CRITICAL: RefNodes MUST use ts-poly's Reference system - NEVER duplicate geometry.
 */
function renderCellNode(
  node: CellNode,
  builder: SceneBuilder,
  gridColor: string,
  isHighlighted: boolean | undefined,
  geometryGroups: Map<string, string>
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
    // CRITICAL: Use ts-poly's Reference system to instantiate the referenced grid
    const targetGeomId = geometryGroups.get(node.refTarget);
    if (!targetGeomId) {
      console.error(`Geometry not built for referenced grid: ${node.refTarget}`);
      return;
    }

    // Get dimensions of the referenced grid from its content
    if (isNestedNode(node.content)) {
      const refRows = node.content.children.length;
      const refCols = node.content.children[0]?.length || 0;

      // The referenced grid should fill the current cell (which is 1x1 in local space)
      // We need to center it within the cell and scale it to fit
      const scaleX = 1 / refCols;
      const scaleZ = 1 / refRows;

      // Center the grid within the cell
      const offsetX = -(refCols - 1) / 2 * scaleX;
      const offsetZ = -(refRows - 1) / 2 * scaleZ;

      // Create a reference to the pre-built geometry
      builder.reference(targetGeomId, {
        translation: [offsetX, 0, offsetZ],
        scale: [scaleX, 1, scaleZ]
      });
    } else if (isCutoffNode(node.content)) {
      // Reference was cut off - don't render anything
    }
  } else if (isNestedNode(node)) {
    // This shouldn't happen in normal traversal
    console.warn('Unexpected NestedNode in cell position');
  }
}
