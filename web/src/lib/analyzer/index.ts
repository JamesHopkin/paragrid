/**
 * Grid analyzer - builds CellTree from GridStore.
 *
 * Two-phase rendering pipeline:
 * 1. Analyze: DFS traversal with dimensional tracking → CellTree
 * 2. Render: Walk CellTree to build isometric scene
 */

export { analyze } from './analyze.js';
export type {
  CellNode,
  EmptyNode,
  CutoffNode,
  ConcreteNode,
  RefNode,
  NestedNode
} from './types.js';
export {
  isEmptyNode,
  isCutoffNode,
  isConcreteNode,
  isRefNode,
  isNestedNode
} from './types.js';
