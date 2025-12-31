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
import { getGridColor } from './colors.js';

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

  builder.object('concrete-cube', cube(0.6));

  const floorLight = '#3a3a3a';
  const floorDark = '#2a2a2a';

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
    buildGridTemplate(node, templateId, builder, floorLight, squareSize, nodeToTemplateId);
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

  // Add base floor
  builder.instance('floor-base', {
    position: [baseWidth / 2, 0, -baseHeight / 2],
    color: floorDark
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
 * Get color for a concrete cell based on its ID.
 * Uses distinct colors to highlight the fractal structure.
 */
function getCellColor(cellId: string): string {
  const colors: Record<string, string> = {
    '1': '#ff6b6b', // Red
    '2': '#4ecdc4', // Cyan
    '3': '#ffe66d', // Yellow
    '4': '#a8e6cf', // Mint
    '5': '#ff8b94', // Pink
    '6': '#c7ceea', // Lavender
    '7': '#ffd3b6', // Peach
    '8': '#dcedc1', // Light green
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
 * @param floorLight - Light floor color
 * @param squareSize - Size of floor squares
 * @param nodeToTemplateId - Map from NestedNode instances to their template IDs
 */
function buildGridTemplate(
  node: NestedNode,
  templateId: string,
  builder: SceneBuilder,
  floorLight: string,
  squareSize: number,
  nodeToTemplateId: Map<NestedNode, string>
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

      // Render cell content
      if (isConcreteNode(child)) {
        builder.instance('concrete-cube', {
          position: [0, 0.3, 0],
          color: getCellColor(child.id)
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

