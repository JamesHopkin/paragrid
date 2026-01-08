/**
 * Isometric renderer for analyzed paragrid grids (CellTree).
 * Renders grids using the two-phase approach: analyze → render.
 *
 * This renderer accepts CellNode trees from the analyzer and builds
 * an isometric scene with checkerboard floors and floating cubes.
 */

import { SceneBuilder, Camera, cube, octahedron, project, Renderer, type Scene, type TransformOverrides } from 'iso-render';

/**
 * Create a camera with paragrid's standard viewing angles.
 *
 * @param center - World position to center view on
 * @param viewWidth - Horizontal span of view in world units
 * @param viewportWidth - Viewport width in pixels
 * @param viewportHeight - Viewport height in pixels
 */
export function createParagridCamera(
  center: readonly [number, number, number],
  viewWidth: number,
  viewportWidth: number,
  viewportHeight: number
) {
  return Camera.custom({
    center,
    rightEdge: [center[0] + viewWidth / 2, center[1], center[2]],
    viewportWidth,
    viewportHeight,
    yaw: 40,
    pitch: 28,
    groundScale: 1.0,
    heightScale: 1.0
  });
}
import type { CellNode, NestedNode, ConcreteNode, RefNode } from '../analyzer/types.js';
import { isNestedNode, isConcreteNode, isRefNode, isEmptyNode, isCutoffNode } from '../analyzer/types.js';
import type { CellPosition } from '../core/position.js';
import type { GridStore } from '../core/types.js';
import type { TagFn } from '../tagging/types.js';
import { Concrete, isRef, getGrid, getCell } from '../core/types.js';
import { getGridColor } from './colors.js';
import { analyze } from '../analyzer/index.js';

/**
 * Compute the layer for a cell based on its focus metadata.
 * Returns 1 for cells that should be semi-transparent (siblings with x < focused.x AND z > focused.z).
 * Returns undefined for cells that should use default layer assignment.
 *
 * @param node - Cell node with focus metadata
 * @param focusPosition - Position of the focused cell (typically player position)
 * @returns Layer number or undefined for default
 */
function computeFocusLayer(
  node: CellNode,
  focusPosition: CellPosition | undefined
): number | undefined {
  if (!focusPosition) {
    return undefined;
  }

  // Only apply to siblings of the focused grid (focusDepth === -1, i.e., parent grid)
  if (node.focusDepth !== -1 || !node.focusOffset) {
    return undefined;
  }

  const [cellCol, cellRow] = node.focusOffset;

  // For parent grid cells, focusOffset is relative to the reference position
  // Apply layer 1 if x <= 0 AND z => 0 (cell is in front of the reference in isometric view)
  if (cellCol <= 0 && cellRow >= 0) {
    return 1;
  }

  return undefined;
}

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
  transformOverrides?: TransformOverrides;
}

/**
 * Result of rendering including the scene for serialization.
 */
export interface RenderResult {
  scene: Scene;
}

/**
 * Result of building scene without rendering.
 */
export interface BuildResult {
  scene: Scene;
  camera: any;
  width: number;
  height: number;
}

/**
 * Build an isometric scene without rendering it.
 * Use this when you want to build the scene once and render it multiple times with different overrides.
 */
export function buildIsometricScene(
  root: CellNode,
  options: Omit<RenderOptions, 'target'>
): BuildResult {
  const { width, height, highlightPosition, store, tagFn } = options;

  // Root must be a NestedNode
  if (!isNestedNode(root)) {
    throw new Error('Root node must be a NestedNode');
  }

  const builder = new SceneBuilder();

  // Setup background and lighting
  builder
    .background({
      type: 'gradient',
      bottomColor: '#00352D',  // Dark racing green
      topColor: '#3A7B6F'      // Lighter bluish-green
    })
    .light({
      direction: [1, 2, 1],
      color: '#ffffff',
      ambient: 0.5
    });

  // Define reusable objects
  const squareSize = 1.0;
  const halfSize = squareSize / 2;
  builder.object('floor-square', {
    type: 'shape',
    vertices: [
      [halfSize, 0, -halfSize],     // back-right
      [-halfSize, 0, -halfSize],    // back-left
      [-halfSize, 0, halfSize],     // front-left
      [halfSize, 0, halfSize]       // front-right
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
  // NOTE: We skip the root node - it will be rendered directly, not as a template
  const nodeToTemplateId = new Map<NestedNode, string>();
  const nodeToDepth = new Map<NestedNode, number>();
  let templateCounter = 0;

  function collectNodes(node: CellNode, isRoot: boolean = false, depth: number = 0): void {
    if (isNestedNode(node)) {
      // Skip adding root to template map - we'll render it directly
      if (!isRoot && !nodeToTemplateId.has(node)) {
        nodeToTemplateId.set(node, `grid-template-${templateCounter++}`);
        nodeToDepth.set(node, depth);
      }
      // Recurse into children to collect nested instances
      for (const row of node.children) {
        for (const child of row) {
          collectNodes(child, false, depth);
        }
      }
    } else if (isRefNode(node)) {
      collectNodes(node.content, false, depth + 1);
    }
  }

  collectNodes(root, true, 0);

  // PASS 2: Build templates for all unique NestedNode instances
  // CRITICAL: Build in REVERSE order so child templates exist before parents reference them
  // For a self-referencing grid, we encounter: depth-0, depth-1, depth-2, ...
  // But we must build: depth-2, depth-1, depth-0 (leaves first)
  const nodesToBuild = Array.from(nodeToTemplateId.keys());

  for (let i = nodesToBuild.length - 1; i >= 0; i--) {
    const node = nodesToBuild[i];
    const templateId = nodeToTemplateId.get(node)!;
    const depth = nodeToDepth.get(node) ?? 0;
    const floorColors = getFloorColors(node.gridId);
    buildGridTemplate(node, templateId, builder, floorColors, squareSize, nodeToTemplateId, store, tagFn, 0, depth, highlightPosition);
  }

  // Get root grid dimensions
  const rows = root.children.length;
  const cols = root.children[0]?.length || 0;

  // Create base floor
  const baseWidth = cols;
  const baseHeight = rows;
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

  // Add base floor with root grid's dark color (in layer -50)
  const rootFloorColors = getFloorColors(root.gridId);
  builder.group('base-floor-layer', { layer: -50 });
  builder.instance('floor-base', {
    position: [baseWidth / 2, 0, -baseHeight / 2],
    color: rootFloorColors.dark
  });
  builder.endGroup();

  // PASS 3: Render the root grid directly (not as a template)
  // This allows us to animate individual cells directly
  renderGridDirect(root, builder, [offsetX, 0, offsetZ], rootFloorColors, squareSize, nodeToTemplateId, store, tagFn, highlightPosition);

  // Build scene
  const scene = builder.build();

  // Setup camera
  const maxDim = Math.max(rows, cols);
  const viewWidth = maxDim * 1.2;
  const camera = createParagridCamera([0, 0, 0], viewWidth, width, height);

  return { scene, camera, width, height };
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
  const { target, transformOverrides } = options;

  // Build the scene
  const { scene, camera, width, height } = buildIsometricScene(root, options);

  // Project to screen space
  const screenSpace = project(scene, camera, width, height, { transformOverrides });

  // Render to DOM
  const renderer = new Renderer({
    target,
    backend: 'svg',
    width,
    height
  });

  // Configure layer opacity: layer 1 and layers >= 200 should be 50% transparent
  const layerConfig = (layer: number) => {
    if (layer === 1 || layer >= 200) {
      return { opacity: 0.5 };
    }
    return { opacity: 1.0 };
  };

  renderer.render(screenSpace, { layers: layerConfig });

  return { scene };
}

/**
 * Get floor colors for a grid based on its ID.
 * Returns { light, dark } for checkerboard pattern.
 * Main grid gets dark grey, others get distinct bright colors.
 * Dark colors are 33% brightness of light colors (same hue).
 */
function getFloorColors(gridId: string): { light: string; dark: string } {
  // Color palette per grid name (light colors are 30% less bright than original)
  const gridColors: Record<string, { light: string; dark: string }> = {
    'main': { light: '#292929', dark: '#0a0a0a' },     // Subdued grey
    'inner': { light: '#29553f', dark: '#13281e' },        // Teal - 33% brightness
    'a': { light: '#293f55', dark: '#131e28' },        // Blue - 33% brightness
    'b': { light: '#4a294a', dark: '#231323' },        // Purple - 33% brightness
    'c': { light: '#4a4a29', dark: '#232313' },        // Olive - 33% brightness
    'd': { light: '#552929', dark: '#281313' },        // Red - 33% brightness
    'e': { light: '#29553f', dark: '#13281e' },        // Teal - 33% brightness
    'f': { light: '#553f29', dark: '#281e13' },        // Brown - 33% brightness
    'first': { light: '#293f55', dark: '#131e28' },    // Blue - 33% brightness
    'second': { light: '#4a294a', dark: '#231323' },   // Purple - 33% brightness
    'third': { light: '#552929', dark: '#281313' },    // Red - 33% brightness
    'fourth': { light: '#29553f', dark: '#13281e' },   // Teal - 33% brightness
    'fifth': { light: '#553f29', dark: '#281e13' },    // Brown - 33% brightness
  };

  return gridColors[gridId] || { light: '#555529', dark: '#282813' };
}

/**
 * Convert RGB hex color to HSL.
 * @param hex - Hex color string (e.g., '#ff0000')
 * @returns [h, s, l] where h is 0-360, s and l are 0-1
 */
function hexToHSL(hex: string): [number, number, number] {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / delta + 2) / 6;
    } else {
      h = ((r - g) / delta + 4) / 6;
    }
  }

  return [h * 360, s, l];
}

/**
 * Convert HSL to RGB hex color.
 * @param h - Hue (0-360)
 * @param s - Saturation (0-1)
 * @param l - Lightness (0-1)
 * @returns Hex color string (e.g., '#ff0000')
 */
function hslToHex(h: number, s: number, l: number): string {
  h = h / 360;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Get color for a stop block by matching the hue of the floor color
 * while preserving the brightness and saturation of the original stop color.
 * If the floor is grey (no saturation), the stop block will also be grey.
 * @param floorColor - Floor color to match hue from
 * @returns Hex color string
 */
function getStopBlockColor(floorColor: string): string {
  const stopBlockBase = '#f0a0a0'; // Original pink stop block color

  const [floorH, floorS, ] = hexToHSL(floorColor);
  const [, stopS, stopL] = hexToHSL(stopBlockBase);

  // If floor is grey (no saturation), make stop block grey too
  // Otherwise use floor's hue with stop block's saturation and lightness
  const saturation = floorS < 0.05 ? 0 : stopS;

  return hslToHex(floorH, saturation, stopL);
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
 * Render a grid directly into the scene (not as a template).
 * Used for the root grid so that cells can be animated directly.
 */
function renderGridDirect(
  node: NestedNode,
  builder: SceneBuilder,
  translation: readonly [number, number, number],
  floorColors: { light: string; dark: string },
  squareSize: number,
  nodeToTemplateId: Map<NestedNode, string>,
  store: GridStore,
  tagFn: TagFn,
  highlightPosition?: CellPosition
): void {
  const rows = node.children.length;
  const cols = node.children[0]?.length || 0;
  const grid = getGrid(store, node.gridId);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const child = node.children[row][col];

      // Determine content group ID early (needed for position override lookup)
      let contentGroupId: string;
      if (isConcreteNode(child)) {
        contentGroupId = `concrete-${child.id}`;
      } else if (isRefNode(child)) {
        const cell = grid?.cells[row]?.[col];
        if (cell && isRef(cell)) {
          const primarySuffix = cell.isPrimary === true ? 'primary' :
                                cell.isPrimary === false ? 'secondary' :
                                'auto';
          contentGroupId = `ref-${cell.gridId}-${primarySuffix}`;
        } else {
          contentGroupId = `ref-${child.gridId}-${row}-${col}`;
        }
      } else {
        contentGroupId = `empty-${row}-${col}`;
      }

      // Position in scene (with root offset applied)
      const x = translation[0] + col;
      const y = translation[1];
      const z = translation[2] + row;

      // Create a group for this cell with a predictable ID
      const cellGroupId = `root-cell-${row}-${col}`;
      builder.group(cellGroupId, {
        position: [x, y, z]
      });

      // Render floor tile
      const isLight = (row + col) % 2 === 0;

      // Always render light floor tiles (no cut-outs for references)
      if (isLight) {
        builder.group(`root-floor-${row}-${col}`, { layer: -50 });
        builder.instance('floor-square', {
          position: [0, 0, 0],
          color: floorColors.light
        });
        builder.endGroup();
      }

      // Create a content group with content-based ID for animations (ID computed above)
      // Apply focus-based layer if applicable
      const focusLayer = computeFocusLayer(child, highlightPosition);
      builder.group(contentGroupId, {
        position: [0, 0, 0],
        ...(focusLayer !== undefined && { layer: focusLayer })
      });

      // Render cell content
      if (isConcreteNode(child)) {
        // Check tags for this cell
        const cell = Concrete(child.id);
        const tags = tagFn(cell);
        const hasPlayer = tags.has('player');
        const hasStop = tags.has('stop');

        let objectType = 'concrete-cube';
        let yPos = 0.4;
        let color = getCellColor(child.id);

        if (hasStop) {
          objectType = 'stop-box';
          yPos = 0; // Bottom touching the floor
          color = getStopBlockColor(floorColors.light);
        }

        if (hasPlayer) {
          objectType = 'player-octahedron';
          yPos = 0.8 / Math.sqrt(2); // Octahedron's bottom is at -size/sqrt(2)
          color = '#F4E04D'; // Lemon yellow
        }

        // Don't add ID to instance - the parent group already has the content-based ID
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

          // No centering translation needed - template is already centered around origin
          builder.reference(nestedTemplateId, {
            scale: [scaleX, scaleY, scaleZ]
          });
        }
      }
      // Empty and Cutoff nodes don't add geometry

      builder.endGroup(); // End content group
      builder.endGroup(); // End cell group
    }
  }
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
 * @param baseLayer - Base layer for content (floor will be baseLayer - 50 + recursionDepth), defaults to 0
 * @param recursionDepth - Depth of recursion for floor layer calculation, defaults to 0
 * @param highlightPosition - Position of focused cell for layer computation
 */
function buildGridTemplate(
  node: NestedNode,
  templateId: string,
  builder: SceneBuilder,
  floorColors: { light: string; dark: string },
  squareSize: number,
  nodeToTemplateId: Map<NestedNode, string>,
  store: GridStore,
  tagFn: TagFn,
  baseLayer: number = 0,
  recursionDepth: number = 0,
  highlightPosition?: CellPosition
): void {
  builder.template(templateId);

  // Render grid contents at origin (no offset)
  const rows = node.children.length;
  const cols = node.children[0]?.length || 0;

  // Create and render base floor for this grid template
  const baseWidth = cols;
  const baseHeight = rows;
  const baseOffsetX = baseWidth / 2;
  const baseOffsetZ = -baseHeight / 2;

  builder.object(`${templateId}-floor-base`, {
    type: 'shape',
    vertices: [
      [0, 0, 0],
      [-baseWidth, 0, 0],
      [-baseWidth, 0, baseHeight],
      [0, 0, baseHeight]
    ]
  });

  const floorLayer = baseLayer - 50 + recursionDepth;
  builder.group(`${templateId}-base-floor-layer`, { layer: floorLayer });
  builder.instance(`${templateId}-floor-base`, {
    position: [baseOffsetX, 0, baseOffsetZ],
    color: floorColors.dark
  });
  builder.endGroup();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const child = node.children[row][col];

      // Position relative to grid center (centered around origin)
      // This eliminates the need for centering translation on references
      const x = col - (cols - 1) / 2;
      const z = row - (rows - 1) / 2;

      // Start a group for this cell
      builder.group(`${templateId}-cell-${row}-${col}`, {
        position: [x, 0, z]
      });

      // Render floor (checkerboard pattern)
      const isLight = (row + col) % 2 === 0;

      // Always render light floor tiles (no cut-outs for references)
      if (isLight) {
        builder.group(`${templateId}-floor-${row}-${col}`, { layer: floorLayer });
        builder.instance('floor-square', {
          position: [0, 0, 0],  // floor-square is now centered at origin
          color: floorColors.light
        });
        builder.endGroup();
      }

      // Render cell content
      if (isConcreteNode(child)) {
        // Check tags for this cell
        const cell = Concrete(child.id);
        const tags = tagFn(cell);
        const hasPlayer = tags.has('player');
        const hasStop = tags.has('stop');

        let objectType = 'concrete-cube';
        let yPos = 0.4;
        let color = getCellColor(child.id);

        if (hasStop) {
          objectType = 'stop-box';
          yPos = 0; // Bottom touching the floor
          color = getStopBlockColor(floorColors.light);
        }

        if (hasPlayer) {
          objectType = 'player-octahedron';
          yPos = 0.8 / Math.sqrt(2); // Octahedron's bottom is at -size/sqrt(2)
          color = '#F4E04D'; // Lemon yellow
        }

        // Create content group with ID (matching root grid structure)
        // This ensures ts-poly can target this group for animations
        // Apply focus-based layer if applicable, otherwise use baseLayer
        const focusLayer = computeFocusLayer(child, highlightPosition);
        const effectiveLayer = focusLayer !== undefined ? focusLayer : baseLayer;
        builder.group(`concrete-${child.id}`, {
          position: [0, 0, 0],
          layer: effectiveLayer
        });

        builder.instance(objectType, {
          position: [0, yPos, 0],
          color: color
        });

        builder.endGroup(); // End content group
      } else if (isRefNode(child) && isNestedNode(child.content)) {
        // Reference the SPECIFIC nested instance's template
        const nestedTemplateId = nodeToTemplateId.get(child.content);
        if (!nestedTemplateId) {
          console.error(`Template not found for nested grid: ${child.content.gridId}`);
        } else {
          // Look up the actual cell to get isPrimary information
          const grid = getGrid(store, node.gridId);
          const cell = grid?.cells[row]?.[col];

          // Create content group with ID (matching root grid structure)
          // This ensures animations can target this group
          let contentGroupId: string;
          if (cell && isRef(cell)) {
            const primarySuffix = cell.isPrimary === true ? 'primary' :
                                  cell.isPrimary === false ? 'secondary' :
                                  'auto';
            contentGroupId = `ref-${cell.gridId}-${primarySuffix}`;
          } else {
            contentGroupId = `ref-${child.gridId}-${row}-${col}`;
          }

          // Apply focus-based layer if applicable, otherwise use baseLayer
          const focusLayer = computeFocusLayer(child, highlightPosition);
          const effectiveLayer = focusLayer !== undefined ? focusLayer : baseLayer;

          builder.group(contentGroupId, {
            position: [0, 0, 0],
            layer: effectiveLayer
          });

          const refRows = child.content.children.length;
          const refCols = child.content.children[0]?.length || 0;

          // The referenced grid should fill the current cell (which is 1x1 in local space)
          const scaleX = 1 / refCols;
          const scaleZ = 1 / refRows;
          // Y-scale is the reciprocal of max dimension to keep cubes cubic
          const scaleY = 1 / Math.max(refCols, refRows);

          // No centering translation needed - template is already centered around origin
          builder.reference(nestedTemplateId, {
            scale: [scaleX, scaleY, scaleZ]
          });

          builder.endGroup(); // End content group
        }
      }
      // Empty and Cutoff nodes don't add geometry

      builder.endGroup();
    }
  }

  builder.endTemplate();
}

