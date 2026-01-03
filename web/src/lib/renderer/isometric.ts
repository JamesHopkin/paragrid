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
import type { ExitTransformation } from '../navigator/exit-transform.js';
import { Direction } from '../core/direction.js';
import { analyze } from '../analyzer/index.js';

/**
 * Cell position override for scene building.
 * Maps cell group ID to [row, col] position to use instead of store position.
 */
export type CellPositionOverrides = Map<string, { row: number; col: number }>;

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
  cellPositionOverrides?: CellPositionOverrides;
  exitPreviews?: ExitTransformation[]; // Optional exit previews to render
  enableExitPreviews?: boolean; // Enable exit preview rendering (default: false)
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
  const { width, height, highlightPosition, store, tagFn, cellPositionOverrides, exitPreviews, enableExitPreviews = false } = options;

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

  // Septagonal prism for 'stop' tagged cells
  const halfHeight = 0.3;
  const radius = 0.25;
  const numSides = 7;

  // Generate vertices for bottom and top septagon
  const bottomVerts: [number, number, number][] = [];
  const topVerts: [number, number, number][] = [];

  for (let i = 0; i < numSides; i++) {
    const angle = (i * 2 * Math.PI) / numSides; // Rotated so flat edge faces forward
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    bottomVerts.push([x, 0, z]);
    topVerts.push([x, halfHeight, z]);
  }

  // Build faces for septagonal prism
  const septagonFaces: { vertices: [number, number, number][] }[] = [];

  // Bottom face (viewed from below, counter-clockwise winding)
  septagonFaces.push({ vertices: [...bottomVerts] });

  // Top face (viewed from above, counter-clockwise winding)
  septagonFaces.push({ vertices: [...topVerts].reverse() });

  // Side faces (counter-clockwise winding when viewed from outside)
  for (let i = 0; i < numSides; i++) {
    const next = (i + 1) % numSides;
    septagonFaces.push({
      vertices: [
        bottomVerts[i],
        topVerts[i],
        topVerts[next],
        bottomVerts[next]
      ]
    });
  }

  builder.object('stop-box', {
    type: 'solid',
    faces: septagonFaces
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
    buildGridTemplate(node, templateId, builder, floorColors, squareSize, nodeToTemplateId, store, tagFn, 0, depth);
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
  renderGridDirect(root, builder, [offsetX, 0, offsetZ], rootFloorColors, squareSize, nodeToTemplateId, store, tagFn, cellPositionOverrides);

  // PASS 4: Render exit previews if enabled and provided
  if (enableExitPreviews && exitPreviews && exitPreviews.length > 0) {
    for (let i = 0; i < exitPreviews.length; i++) {
      renderExitPreview(exitPreviews[i], builder, [offsetX, 0, offsetZ], cols, rows, store, tagFn, nodeToTemplateId, i);
    }
  }

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

  // Configure layer opacity: layers >= 200 should be 50% transparent
  const layerConfig = (layer: number) => {
    if (layer >= 200) {
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
    'inner': { light: '#293f55', dark: '#131e28' },    // Blue - 33% brightness
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
  cellPositionOverrides?: CellPositionOverrides
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

      // Check for position override (for direction-aware animation)
      const posOverride = cellPositionOverrides?.get(contentGroupId);
      const effectiveRow = posOverride?.row ?? row;
      const effectiveCol = posOverride?.col ?? col;

      // Position in scene (with root offset applied, using effective position)
      const x = translation[0] + effectiveCol;
      const y = translation[1];
      const z = translation[2] + effectiveRow;

      // Create a group for this cell with a predictable ID
      const cellGroupId = `root-cell-${row}-${col}`;
      builder.group(cellGroupId, {
        position: [x, y, z]
      });

      // Render floor at ACTUAL grid position (not overridden position)
      // Floor should stay put even when content hierarchy is moved for z-sorting
      const isLight = (row + col) % 2 === 0;

      // Always render light floor tiles (no cut-outs for references)
      if (isLight) {
        // Calculate offset from effective position back to actual position
        // floor-square is now centered at origin, so no additional offset needed
        const floorXOffset = (col - effectiveCol);
        const floorZOffset = (row - effectiveRow);

        builder.group(`root-floor-${row}-${col}`, { layer: -50 });
        builder.instance('floor-square', {
          position: [floorXOffset, 0, floorZOffset],
          color: floorColors.light
        });
        builder.endGroup();
      }

      // Create a content group with content-based ID for animations (ID computed above)
      builder.group(contentGroupId, {
        position: [0, 0, 0]
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
          color = '#4a3a5a'; // Purple-ish dark grey
        }

        if (hasPlayer) {
          objectType = 'player-octahedron';
          yPos = 0.8 / Math.sqrt(2); // Octahedron's bottom is at -size/sqrt(2)
          // Keep the cell's normal color
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
  recursionDepth: number = 0
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
          color = '#4a3a5a'; // Purple-ish dark grey
        }

        if (hasPlayer) {
          objectType = 'player-octahedron';
          yPos = 0.8 / Math.sqrt(2); // Octahedron's bottom is at -size/sqrt(2)
          // Keep the cell's normal color
        }

        // Create content group with ID (matching root grid structure)
        // This ensures ts-poly can target this group for animations
        builder.group(`concrete-${child.id}`, {
          position: [0, 0, 0],
          layer: baseLayer
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

          builder.group(contentGroupId, {
            position: [0, 0, 0],
            layer: baseLayer
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

/**
 * Render exit preview cell to the east of the current grid.
 * Shows the cell content at correct scale and position.
 *
 * POSITIONING SUMMARY:
 * - Current grid: 8x8 cells (for example), each cell is 1.0 units in world space
 * - Current grid is INSIDE a reference cell in the parent grid at position (refCol, refRow)
 * - Exit cell is at position (exitCol, exitRow) in the parent grid
 * - Scale: The entire current grid (8x8) fits into ONE parent cell, so scale = 8
 * - Goal: Show the exit cell (which is scale×scale units large) at the correct position
 *
 * Example: If current ref is at parent (2, 3) and exit is at parent (3, 3):
 * - They're 1 parent-cell apart horizontally
 * - In current grid's coordinates: 1 parent-cell = 8 current-cells
 * - But we want to position the CENTER of the exit cell, not its edge
 * - So offset = (1 - 0.5) * 8 = 4.0 units from the east edge
 */
function renderExitPreview(
  exitPreview: ExitTransformation,
  builder: SceneBuilder,
  rootTranslation: readonly [number, number, number],
  rootCols: number,
  rootRows: number,
  store: GridStore,
  tagFn: TagFn,
  nodeToTemplateId: Map<NestedNode, string>,
  index: number = 0
): void {
  const { exitPosition, scale, currentRefPosition, targetGridId, direction } = exitPreview;

  // Determine layers based on direction
  // S and W directions: content at layer 200, floor at layer 150
  // Other directions (N, E, null): content at layer -200, floor at layer -250
  const isSouthOrWest = direction === Direction.S || direction === Direction.W;
  const contentLayer = isSouthOrWest ? 200 : -200;
  const floorLayer = isSouthOrWest ? 150 : -250;

  // Get the cell at the exit position
  const targetGrid = getGrid(store, targetGridId);
  if (!targetGrid) return;

  const cell = getCell(targetGrid, exitPosition.row, exitPosition.col);
  if (!cell) return;

  // Calculate position in world space
  // The exit cell is in the parent grid coordinate system
  // We need to map it relative to the current grid's position
  if (!currentRefPosition) return;

  // Current grid occupies position [currentRefPosition.row, currentRefPosition.col] in parent
  // Exit cell is at [exitPosition.row, exitPosition.col] in parent
  // Each parent cell = scale units in current grid's coordinate system

  // Offset from current grid's ref position to exit position (in parent cells)
  const parentColDiff = exitPosition.col - currentRefPosition.col;
  const parentRowDiff = exitPosition.row - currentRefPosition.row;

  // Convert to current grid's coordinate system
  // Current grid cell [0,0] center is at rootTranslation
  // Current grid cell [0,0] top-left corner is at rootTranslation - [0.5, 0.5]
  // Parent cell's top-left corner aligns with current grid's top-left corner
  // Exit cell is offset by parentColDiff * scale from parent cell's corner
  // Exit cell's center is at an additional (scale - 1) / 2 from its corner
  const xOffset = parentColDiff * scale + (scale - 1) / 2;
  const zOffset = parentRowDiff * scale + (scale - 1) / 2;

  // Position in scene (current grid origin is at rootTranslation)
  const x = rootTranslation[0] + xOffset;
  const y = rootTranslation[1];
  const z = rootTranslation[2] + zOffset;

  // Create group for exit preview cell (no layer on parent)
  builder.group(`exit-preview-cell-${index}`, {
    position: [x, y, z]
  });

  // Render floor for the exit preview cell
  // Use the target grid's floor colors
  const targetFloorColors = getFloorColors(targetGridId);
  const isLight = (exitPosition.row + exitPosition.col) % 2 === 0;

  // Always render floor tile for exit previews (except for references)
  // Use light color for light squares, dark color for dark squares
  if (cell.type !== 'ref') {
    // Render a scaled floor square for the exit preview
    // The floor should be centered at the origin of this group
    const floorSize = scale * 1.0; // Match the squareSize used elsewhere
    const floorHalfSize = floorSize / 2;
    const floorColor = isLight ? targetFloorColors.light : targetFloorColors.dark;

    builder.group(`exit-preview-floor-${index}`, { layer: floorLayer });
    builder.object(`exit-floor-square-${index}`, {
      type: 'shape',
      vertices: [
        [floorHalfSize, 0, -floorHalfSize],
        [-floorHalfSize, 0, -floorHalfSize],
        [-floorHalfSize, 0, floorHalfSize],
        [floorHalfSize, 0, floorHalfSize]
      ]
    });
    builder.instance(`exit-floor-square-${index}`, {
      position: [0, 0, 0],  // floor square is now centered at origin
      color: floorColor
    });
    builder.endGroup();
  }

  // Render cell content based on type (wrapped in content layer group)
  builder.group(`exit-preview-content-${index}`, { layer: contentLayer });
  if (cell.type === 'concrete') {
    // Render concrete cell
    const tags = tagFn(cell);
    const hasPlayer = tags.has('player');
    const hasStop = tags.has('stop');

    let objectType = 'concrete-cube';
    let yPos = 0.4 * scale; // Scale the height
    let color = getCellColor(cell.id);

    if (hasStop) {
      objectType = 'stop-box';
      yPos = 0;
      color = '#4a3a5a';
    }

    if (hasPlayer) {
      objectType = 'player-octahedron';
      yPos = (0.8 / Math.sqrt(2)) * scale; // Octahedron's bottom is at -size/sqrt(2), scaled
      // Keep the cell's normal color
    }

    builder.instance(objectType, {
      position: [0, yPos, 0],
      scale: [scale, scale, scale],
      color: color
    });
  } else if (isRef(cell)) {
    // For reference cells, render the entire referenced grid at scale
    const refGridId = cell.gridId;
    const refGrid = getGrid(store, refGridId);

    if (refGrid) {
      // Analyze the referenced grid to get its cell tree
      const refCellTree = analyze(store, refGridId, refGrid.cols, refGrid.rows);

      if (isNestedNode(refCellTree)) {
        // Try to find existing template for this reference
        let refTemplateId = nodeToTemplateId.get(refCellTree);

        // If template doesn't exist, we need to build it on-demand
        if (!refTemplateId) {
          // Create a unique template ID for this exit preview reference
          refTemplateId = `exit-preview-grid-${index}-${refGridId}`;

          // Build the template for this grid with preview layers
          const floorColors = getFloorColors(refGridId);
          buildGridTemplate(refCellTree, refTemplateId, builder, floorColors, 0.9, nodeToTemplateId, store, tagFn, contentLayer, 0);

          // Don't add to nodeToTemplateId map since it's only for this exit preview
        }

        // Use the template
        const refRows = refCellTree.children.length;
        const refCols = refCellTree.children[0]?.length || 0;

        // The referenced grid should fill the exit preview cell (which is scale×scale in size)
        const scaleX = scale / refCols;
        const scaleZ = scale / refRows;
        const scaleY = scale / Math.max(refCols, refRows);

        builder.reference(refTemplateId, {
          scale: [scaleX, scaleY, scaleZ]
        });
      }
    }
  }
  // Empty cells render nothing
  builder.endGroup(); // End content layer group

  builder.endGroup(); // End exit-preview-cell group
}

