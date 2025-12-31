/**
 * Isometric renderer for analyzed paragrid grids (CellTree).
 * Renders grids using the two-phase approach: analyze → render.
 *
 * This renderer accepts CellNode trees from the analyzer and builds
 * an isometric scene with checkerboard floors and floating cubes.
 */

import { SceneBuilder, Camera, cube, octahedron, project, Renderer, type Scene } from 'iso-render';
import type { CellNode, NestedNode, ConcreteNode, RefNode } from '../analyzer/types.js';
import { isNestedNode, isConcreteNode, isRefNode, isEmptyNode, isCutoffNode } from '../analyzer/types.js';
import type { CellPosition } from '../core/position.js';
import type { GridStore } from '../core/types.js';
import type { TagFn } from '../tagging/types.js';
import { Concrete } from '../core/types.js';
import { getGridColor } from './colors.js';

/**
 * Render options for the isometric renderer.
 */
export interface RenderOptions {
  width: number;
  height: number;
  target: HTMLElement;
  highlightPosition?: CellPosition;
  store: GridStore;
  tagFn: TagFn;
}

/**
 * Result of rendering including the scene for serialization.
 */
export interface RenderResult {
  scene: Scene;
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
  const { width, height, target, highlightPosition, store, tagFn } = options;

  // Root must be a NestedNode
  if (!isNestedNode(root)) {
    throw new Error('Root node must be a NestedNode');
  }

  const builder = new SceneBuilder();

  // Setup background and lighting
  builder
    .background({ type: 'solid', color: '#20a0e0' })
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

  builder.object('concrete-cube', cube(0.8));
  builder.object('player-octahedron', octahedron(0.8));

  // Half-height box for 'stop' tagged cells (broader than regular cubes)
  const halfHeight = 0.3;
  const boxSize = 0.9;
  const half = boxSize / 2;
  builder.object('stop-box', {
    type: 'solid',
    faces: [
      // Bottom
      { vertices: [[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]] },
      // Top
      { vertices: [[-half, halfHeight, -half], [-half, halfHeight, half], [half, halfHeight, half], [half, halfHeight, -half]] },
      // Front
      { vertices: [[half, 0, half], [half, halfHeight, half], [-half, halfHeight, half], [-half, 0, half]] },
      // Back
      { vertices: [[-half, 0, -half], [-half, halfHeight, -half], [half, halfHeight, -half], [half, 0, -half]] },
      // Left
      { vertices: [[-half, 0, half], [-half, halfHeight, half], [-half, halfHeight, -half], [-half, 0, -half]] },
      // Right
      { vertices: [[half, 0, -half], [half, halfHeight, -half], [half, halfHeight, half], [half, 0, half]] }
    ]
  });

  // PASS 1: Collect all unique NestedNode instances by object identity
  // This is critical for cycles: each depth level is a different instance
  const nodeToTemplateId = new Map<NestedNode, string>();
  let templateCounter = 0;

  function collectNodes(node: CellNode): void {
    if (isNestedNode(node)) {
      if (!nodeToTemplateId.has(node)) {
        nodeToTemplateId.set(node, `grid-template-${templateCounter++}`);
      }
      // Recurse into children to collect nested instances
      for (const row of node.children) {
        for (const child of row) {
          collectNodes(child);
        }
      }
    } else if (isRefNode(node)) {
      collectNodes(node.content);
    }
  }

  collectNodes(root);

  // PASS 2: Build templates for all unique NestedNode instances
  // CRITICAL: Build in REVERSE order so child templates exist before parents reference them
  // For a self-referencing grid, we encounter: depth-0, depth-1, depth-2, ...
  // But we must build: depth-2, depth-1, depth-0 (leaves first)
  const nodesToBuild = Array.from(nodeToTemplateId.keys());

  for (let i = nodesToBuild.length - 1; i >= 0; i--) {
    const node = nodesToBuild[i];
    const templateId = nodeToTemplateId.get(node)!;
    const floorColors = getFloorColors(node.gridId);
    buildGridTemplate(node, templateId, builder, floorColors, squareSize, nodeToTemplateId, store, tagFn);
  }

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

  // Add base floor with root grid's dark color
  const rootFloorColors = getFloorColors(root.gridId);
  builder.instance('floor-base', {
    position: [baseWidth / 2, 0, -baseHeight / 2],
    color: rootFloorColors.dark
  });

  // PASS 3: Render the root grid using template reference
  const rootTemplateId = nodeToTemplateId.get(root);
  if (!rootTemplateId) {
    throw new Error('Root template not found');
  }

  builder.reference(rootTemplateId, {
    translation: [offsetX, 0, offsetZ],
    scale: [1, 1, 1]
  });

  // Build scene
  const scene = builder.build();

  // Setup camera
  const maxDim = Math.max(rows, cols);
  const scale = Math.min(width, height) / (maxDim * 1.2);

  const camera = Camera.custom({ 
    yaw: 50, pitch: 30, groundScale: 1.0, heightScale: 1.0, scale,
    offset: [width / 2 - 370, height / 2 - 340]
  });

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
 * Get floor colors for a grid based on its ID.
 * Returns { light, dark } for checkerboard pattern.
 * Main grid gets dark grey, others get distinct bright colors with strong tints.
 */
function getFloorColors(gridId: string): { light: string; dark: string } {
  // Color palette per grid name
  const gridColors: Record<string, { light: string; dark: string }> = {
    'main': { light: '#3a3a3a', dark: '#0a0a0a' },     // Subdued grey
    'inner': { light: '#3a5a7a', dark: '#051020' },    // Dark blue - strong blue tint
    'a': { light: '#3a5a7a', dark: '#051020' },        // Dark blue - strong blue tint
    'b': { light: '#6a3a6a', dark: '#100510' },        // Dark purple - strong purple tint
    'c': { light: '#6a6a3a', dark: '#101005' },        // Dark olive - strong olive tint
    'd': { light: '#7a3a3a', dark: '#200505' },        // Dark red - strong red tint
    'e': { light: '#3a7a5a', dark: '#052010' },        // Dark teal - strong teal tint
    'f': { light: '#7a5a3a', dark: '#201005' },        // Dark brown - strong brown tint
  };

  return gridColors[gridId] || { light: '#7a7a3a', dark: '#202005' };
}

/**
 * Get color for a concrete cell based on its ID.
 * Uses light pastel colors for objects.
 */
function getCellColor(cellId: string): string {
  const colors: Record<string, string> = {
    '1': '#ffb3ba', // Light red/pink
    '2': '#bae1ff', // Light blue
    '3': '#ffffba', // Light yellow
    '4': '#baffc9', // Light mint
    '5': '#ffdfba', // Light peach
    '6': '#e0bfff', // Light lavender
    '7': '#ffd4e5', // Light rose
    '8': '#d4f4dd', // Light green
  };
  return colors[cellId] || getGridColor(cellId);
}

/**
 * Build a template for a unique NestedNode instance.
 * Uses ts-poly's template system to create reusable geometry that's not in the visible scene graph.
 *
 * CRITICAL: Each NestedNode instance (by object identity) gets its own template.
 * For cycles, this means depth 0, depth 1, depth 2, etc. each get separate templates
 * that reference each other, with no actual cycles in the template system.
 *
 * @param node - NestedNode instance to build template for
 * @param templateId - Unique ID for this template
 * @param builder - Scene builder
 * @param floorColors - Floor colors for this grid's checkerboard (light and dark)
 * @param squareSize - Size of floor squares
 * @param nodeToTemplateId - Map from NestedNode instances to their template IDs
 * @param store - Grid store for looking up cells
 * @param tagFn - Tag function to check cell tags
 */
function buildGridTemplate(
  node: NestedNode,
  templateId: string,
  builder: SceneBuilder,
  floorColors: { light: string; dark: string },
  squareSize: number,
  nodeToTemplateId: Map<NestedNode, string>,
  store: GridStore,
  tagFn: TagFn
): void {
  builder.template(templateId);

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
      builder.group(`${templateId}-cell-${row}-${col}`, {
        position: [x, 0, z]
      });

      // Render floor (checkerboard pattern) - skip for RefNodes
      const isLight = (row + col) % 2 === 0;
      const floorOffsetX = squareSize / 2;
      const floorOffsetZ = -squareSize / 2;

      // Don't render floor tile if this cell contains a reference
      if (isLight && !isRefNode(child)) {
        builder.instance('floor-square', {
          position: [floorOffsetX, 0, floorOffsetZ],
          color: floorColors.light
        });
      }

      // Render cell content
      if (isConcreteNode(child)) {
        // Check tags for this cell
        const cell = Concrete(child.id);
        const tags = tagFn(cell);
        const hasPlayer = tags.has('player');
        const hasStop = tags.has('stop');

        let objectType = 'concrete-cube';
        let yPos = 0.3;
        let color = getCellColor(child.id);

        if (hasStop) {
          objectType = 'stop-box';
          yPos = 0; // Bottom touching the floor
          color = '#4a3a5a'; // Purple-ish dark grey
        }

        if (hasPlayer) {
          objectType = 'player-octahedron';
          yPos = 0.3;
          // Keep the cell's normal color
        }

        builder.instance(objectType, {
          position: [0, yPos, 0],
          color: color
        });
      } else if (isRefNode(child) && isNestedNode(child.content)) {
        // Reference the SPECIFIC nested instance's template
        const nestedTemplateId = nodeToTemplateId.get(child.content);
        if (!nestedTemplateId) {
          console.error(`Template not found for nested grid: ${child.content.gridId}`);
        } else {
          const refRows = child.content.children.length;
          const refCols = child.content.children[0]?.length || 0;

          // The referenced grid should fill the current cell (which is 1x1 in local space)
          const scaleX = 1 / refCols;
          const scaleZ = 1 / refRows;
          // Y-scale is the reciprocal of max dimension to keep cubes cubic
          const scaleY = 1 / Math.max(refCols, refRows);

          // Center the grid within the cell
          const offsetX = -(refCols - 1) / 2 * scaleX;
          const offsetZ = -(refRows - 1) / 2 * scaleZ;

          builder.reference(nestedTemplateId, {
            translation: [offsetX, 0, offsetZ],
            scale: [scaleX, scaleY, scaleZ]
          });
        }
      }
      // Empty and Cutoff nodes don't add geometry

      builder.endGroup();
    }
  }

  builder.endTemplate();
}

