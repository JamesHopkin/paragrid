/**
 * Cell tree node types - result of analyze phase.
 *
 * The analyzer performs a DFS traversal of the grid structure, tracking dimensions
 * and building a recursive tree representation. This tree is then used by the
 * renderer to build the isometric scene.
 */

/**
 * An analyzed empty cell.
 */
export interface EmptyNode {
  readonly type: 'empty';
}

/**
 * Cell below recursion threshold (had more content but was cut off).
 * Represents content that was too small to render (dimensions < threshold).
 */
export interface CutoffNode {
  readonly type: 'cutoff';
  readonly gridId: string; // Which grid this cutoff belongs to
}

/**
 * An analyzed concrete cell with its source grid.
 */
export interface ConcreteNode {
  readonly type: 'concrete';
  readonly id: string;      // Concrete cell identifier
  readonly gridId: string;  // Which grid this cell belongs to
}

/**
 * A reference to another grid with analyzed content.
 * Wraps the analyzed content of the referenced grid.
 */
export interface RefNode {
  readonly type: 'ref';
  readonly gridId: string;      // Grid this ref cell belongs to
  readonly refTarget: string;   // Grid being referenced
  readonly isPrimary: boolean;  // Whether this is the primary reference
  readonly content: CellNode;   // Analyzed content of referenced grid
}

/**
 * An analyzed nested grid containing child cells.
 */
export interface NestedNode {
  readonly type: 'nested';
  readonly gridId: string;
  readonly children: ReadonlyArray<ReadonlyArray<CellNode>>;
}

/**
 * Union type for all cell node variants.
 */
export type CellNode = EmptyNode | CutoffNode | ConcreteNode | RefNode | NestedNode;

// Type guard functions

export function isEmptyNode(node: CellNode): node is EmptyNode {
  return node.type === 'empty';
}

export function isCutoffNode(node: CellNode): node is CutoffNode {
  return node.type === 'cutoff';
}

export function isConcreteNode(node: CellNode): node is ConcreteNode {
  return node.type === 'concrete';
}

export function isRefNode(node: CellNode): node is RefNode {
  return node.type === 'ref';
}

export function isNestedNode(node: CellNode): node is NestedNode {
  return node.type === 'nested';
}
