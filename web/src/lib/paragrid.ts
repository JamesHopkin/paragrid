/**
 * Recursive grid structure with cycle-aware visualization.
 * Two-phase algorithm: analyze (builds CellTree) -> render (output).
 */

// =============================================================================
// Data Structures: Grid Definition
// =============================================================================

export class Empty {
  readonly _tag = 'Empty' as const;
}

export class Concrete {
  readonly _tag = 'Concrete' as const;
  constructor(public readonly id: string) {}
}

export class Ref {
  readonly _tag = 'Ref' as const;
  constructor(
    public readonly gridId: string,
    public readonly isPrimary: boolean | null = null
  ) {}
}

export type Cell = Empty | Concrete | Ref;

export class Grid {
  constructor(
    public readonly id: string,
    public readonly cells: readonly(readonly Cell[])[]
  ) {}

  get rows(): number {
    return this.cells.length;
  }

  get cols(): number {
    return this.cells.length > 0 ? this.cells[0].length : 0;
  }
}

export type GridStore = Map<string, Grid>;

/**
 * Parse grid definitions from a compact string format.
 *
 * Format:
 * - Rows separated by |
 * - Cells separated by spaces
 * - Cell type determined by FIRST CHARACTER (allows multi-character content/refs):
 *   * First char is digit (0-9): Concrete cell with entire string as content
 *     Examples: "1" -> Concrete("1"), "123abc" -> Concrete("123abc")
 *   * First char is letter (a-zA-Z): Ref cell with entire string as grid_id (auto-determined primary)
 *     Examples: "A" -> Ref("A"), "Main" -> Ref("Main"), "Grid2" -> Ref("Grid2")
 *   * First char is '*': Primary ref, remainder is grid_id (must have at least 1 char after *)
 *     Examples: "*A" -> Ref("A", true), "*Main" -> Ref("Main", true)
 *   * First char is '~': Secondary ref, remainder is grid_id (must have at least 1 char after ~)
 *     Examples: "~A" -> Ref("A", false), "~Grid2" -> Ref("Grid2", false)
 *   * Underscore only (_): Empty cell
 *   * Empty string (from multiple adjacent spaces): Empty cell
 */
export function parseGrids(definitions: Record<string, string>): GridStore {
  const store: GridStore = new Map();

  for (const [gridId, definition] of Object.entries(definitions)) {
    // Split into rows
    const rowStrings = definition.split('|');
    const rows: Cell[][] = [];

    for (const [rowIdx, rowStr] of rowStrings.entries()) {
      // Split by single space to get individual cells
      const cellStrings = rowStr.split(' ');
      const cells: Cell[] = [];

      for (const [colIdx, cellStr] of cellStrings.entries()) {
        if (!cellStr) {
          // Empty string from split = Empty cell
          cells.push(new Empty());
        } else if (cellStr === '_') {
          // Explicit empty marker
          cells.push(new Empty());
        } else if (/^\d/.test(cellStr)) {
          // First char is digit = Concrete
          cells.push(new Concrete(cellStr));
        } else if (/^[a-zA-Z]/.test(cellStr)) {
          // First char is letter = Ref (auto-determined)
          cells.push(new Ref(cellStr, null));
        } else if (cellStr.startsWith('*') && cellStr.length >= 2) {
          // *... = Primary ref (rest is grid_id)
          cells.push(new Ref(cellStr.slice(1), true));
        } else if (cellStr.startsWith('~') && cellStr.length >= 2) {
          // ~... = Secondary ref (rest is grid_id)
          cells.push(new Ref(cellStr.slice(1), false));
        } else {
          // Provide detailed error information
          const errorMsg = [
            `Invalid cell string: '${cellStr}'`,
            `  Grid: '${gridId}'`,
            `  Row ${rowIdx}: "${rowStr}"`,
            `  Position: column ${colIdx}`,
            `  Valid formats:`,
            `    - Digit start (0-9...): Concrete cell (e.g., '1', '123abc')`,
            `    - Letter start (a-zA-Z...): Ref cell (e.g., 'A', 'Main')`,
            `    - '*' prefix: Primary ref (e.g., '*A', '*Main')`,
            `    - '~' prefix: Secondary ref (e.g., '~A', '~Main')`,
            `    - '_': Empty cell`,
            `    - Empty string (multiple spaces): Empty cell`,
          ].join('\n');
          throw new Error(errorMsg);
        }
      }

      rows.push(cells);
    }

    // Validate all rows have same length
    if (rows.length > 0) {
      const cols = rows[0].length;
      const mismatched: [number, number][] = [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].length !== cols) {
          mismatched.push([i, rows[i].length]);
        }
      }
      if (mismatched.length > 0) {
        let errorMsg = `Inconsistent row lengths in grid '${gridId}'\n`;
        errorMsg += `  Expected: ${cols} columns (from row 0)\n`;
        errorMsg += `  Mismatched rows:\n`;
        for (const [rowIdx, actualCols] of mismatched) {
          errorMsg += `    Row ${rowIdx}: ${actualCols} columns - "${rowStrings[rowIdx]}"\n`;
        }
        errorMsg += `  All rows must have the same number of cells`;
        throw new Error(errorMsg);
      }
    }

    // Create Grid
    const grid = new Grid(gridId, rows);
    store.set(gridId, grid);
  }

  return store;
}

// =============================================================================
// Data Structures: Analysis Result (CellTree)
// =============================================================================

export class EmptyNode {
  readonly _tag = 'EmptyNode' as const;
}

export class CutoffNode {
  readonly _tag = 'CutoffNode' as const;
}

export class ConcreteNode {
  readonly _tag = 'ConcreteNode' as const;
  constructor(
    public readonly id: string,
    public readonly gridId: string
  ) {}
}

export class NestedNode {
  readonly _tag = 'NestedNode' as const;
  constructor(
    public readonly gridId: string,
    public readonly children: readonly(readonly CellNode[])[]
  ) {}
}

export class RefNode {
  readonly _tag = 'RefNode' as const;
  constructor(
    public readonly gridId: string,
    public readonly refTarget: string,
    public readonly isPrimary: boolean,
    public readonly content: CellNode
  ) {}
}

export type CellNode = EmptyNode | CutoffNode | ConcreteNode | NestedNode | RefNode;

// =============================================================================
// Fraction Implementation (for rational arithmetic)
// =============================================================================

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

export class Fraction {
  readonly numerator: number;
  readonly denominator: number;

  constructor(numerator: number, denominator: number = 1) {
    if (denominator === 0) {
      throw new Error('Denominator cannot be zero');
    }
    const g = gcd(numerator, denominator);
    // Ensure denominator is always positive
    const sign = denominator < 0 ? -1 : 1;
    this.numerator = (sign * numerator) / g;
    this.denominator = (sign * denominator) / g;
  }

  add(other: Fraction): Fraction {
    const num = this.numerator * other.denominator + other.numerator * this.denominator;
    const den = this.denominator * other.denominator;
    return new Fraction(num, den);
  }

  sub(other: Fraction): Fraction {
    const num = this.numerator * other.denominator - other.numerator * this.denominator;
    const den = this.denominator * other.denominator;
    return new Fraction(num, den);
  }

  mul(other: Fraction): Fraction {
    return new Fraction(
      this.numerator * other.numerator,
      this.denominator * other.denominator
    );
  }

  div(other: Fraction): Fraction {
    return new Fraction(
      this.numerator * other.denominator,
      this.denominator * other.numerator
    );
  }

  lt(other: Fraction): boolean {
    return this.numerator * other.denominator < other.numerator * this.denominator;
  }

  eq(other: Fraction): boolean {
    return (
      this.numerator === other.numerator && this.denominator === other.denominator
    );
  }

  toNumber(): number {
    return this.numerator / this.denominator;
  }
}

// =============================================================================
// Phase 1: Analyze
// =============================================================================

export function analyze(
  store: GridStore,
  gridId: string,
  width: Fraction,
  height: Fraction,
  threshold: Fraction = new Fraction(1, 10),
  primaryRefs: Set<string> = new Set()
): CellNode {
  if (width.lt(threshold) || height.lt(threshold)) {
    return new CutoffNode();
  }

  const grid = store.get(gridId);
  if (!grid) {
    throw new Error(`Grid "${gridId}" not found in store`);
  }

  const cellWidth = width.div(new Fraction(grid.cols));
  const cellHeight = height.div(new Fraction(grid.rows));

  const rows: CellNode[][] = [];
  for (const row of grid.cells) {
    const cols: CellNode[] = [];
    for (const cell of row) {
      if (cell._tag === 'Empty') {
        cols.push(new EmptyNode());
      } else if (cell._tag === 'Concrete') {
        cols.push(new ConcreteNode(cell.id, gridId));
      } else if (cell._tag === 'Ref') {
        // Check if this is the primary reference
        let isPrimary: boolean;
        if (cell.isPrimary === true) {
          // Explicitly marked as primary
          isPrimary = true;
          primaryRefs.add(cell.gridId);
        } else if (cell.isPrimary === false) {
          // Explicitly marked as non-primary
          isPrimary = false;
        } else {
          // Auto-determine: first ref to this grid is primary
          isPrimary = !primaryRefs.has(cell.gridId);
          if (isPrimary) {
            primaryRefs.add(cell.gridId);
          }
        }

        // Analyze the referenced grid
        const content = analyze(store, cell.gridId, cellWidth, cellHeight, threshold, primaryRefs);

        // Wrap in RefNode
        cols.push(new RefNode(gridId, cell.gridId, isPrimary, content));
      }
    }
    rows.push(cols);
  }

  return new NestedNode(gridId, rows);
}

// =============================================================================
// Traversal
// =============================================================================

export enum Direction {
  N = 'N', // Up (decreasing row)
  S = 'S', // Down (increasing row)
  E = 'E', // Right (increasing col)
  W = 'W', // Left (decreasing col)
}

export enum TerminationReason {
  EDGE_REACHED = 'edge_reached',
  ENTRY_CYCLE_DETECTED = 'entry_cycle_detected',
  EXIT_CYCLE_DETECTED = 'exit_cycle_detected',
  PATH_CYCLE_DETECTED = 'path_cycle_detected',
  ENTRY_DENIED = 'entry_denied',
  MAX_DEPTH_REACHED = 'max_depth_reached',
  STOP_TAG = 'stop_tag',
}

export class CellPosition {
  constructor(
    public readonly gridId: string,
    public readonly row: number,
    public readonly col: number
  ) {}

  equals(other: CellPosition): boolean {
    return this.gridId === other.gridId && this.row === other.row && this.col === other.col;
  }

  toKey(): string {
    return `${this.gridId}:${this.row}:${this.col}`;
  }
}

export type TryEnter = (gridId: string, direction: Direction) => CellPosition | null;
export type TagFn = (cell: Cell) => Set<string>;

export class TraversalResult implements Iterable<CellPosition> {
  terminationReason: TerminationReason | null = null;

  constructor(private readonly generator: Generator<CellPosition>) {}

  [Symbol.iterator](): Iterator<CellPosition> {
    return this.generator;
  }
}

export function findPrimaryRef(
  store: GridStore,
  targetGridId: string
): [string, number, number] | null {
  // First pass: look for explicitly marked primary
  for (const grid of store.values()) {
    for (let r = 0; r < grid.cells.length; r++) {
      for (let c = 0; c < grid.cells[r].length; c++) {
        const cell = grid.cells[r][c];
        if (cell._tag === 'Ref' && cell.gridId === targetGridId && cell.isPrimary === true) {
          return [grid.id, r, c];
        }
      }
    }
  }

  // Second pass: fall back to first ref found
  for (const grid of store.values()) {
    for (let r = 0; r < grid.cells.length; r++) {
      for (let c = 0; c < grid.cells[r].length; c++) {
        const cell = grid.cells[r][c];
        if (cell._tag === 'Ref' && cell.gridId === targetGridId) {
          return [grid.id, r, c];
        }
      }
    }
  }
  return null;
}

function followEnterChain(
  store: GridStore,
  entry: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  maxDepth: number
): [CellPosition | null, boolean] {
  const visited = new Set<string>();
  let current = entry;
  let depth = 0;

  while (depth < maxDepth) {
    // Check for cycle
    const key = current.toKey();
    if (visited.has(key)) {
      return [current, true];
    }
    visited.add(key);

    // Check if current cell is a Ref
    const grid = store.get(current.gridId);
    if (!grid) {
      throw new Error(`Grid "${current.gridId}" not found`);
    }
    const cell = grid.cells[current.row][current.col];

    if (cell._tag !== 'Ref') {
      // Hit a non-Ref, we're done
      return [current, false];
    }

    // It's a Ref, try to enter it
    const nextEntry = tryEnter(cell.gridId, direction);
    if (nextEntry === null) {
      // Entry denied mid-chain
      return [null, false];
    }

    current = nextEntry;
    depth++;
  }

  // Hit max_depth, treat as cycle
  return [current, true];
}

function followExitChain(
  store: GridStore,
  exitPos: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  maxDepth: number
): [CellPosition | null, boolean] {
  const visited = new Set<string>();
  let current = exitPos;
  let depth = 0;

  const deltas: Record<Direction, [number, number]> = {
    [Direction.N]: [-1, 0],
    [Direction.S]: [1, 0],
    [Direction.E]: [0, 1],
    [Direction.W]: [0, -1],
  };
  const [dr, dc] = deltas[direction];

  while (depth < maxDepth) {
    // Check for cycle
    const key = current.toKey();
    if (visited.has(key)) {
      return [current, true];
    }
    visited.add(key);

    // Check if current cell is a Ref
    const grid = store.get(current.gridId);
    if (!grid) {
      throw new Error(`Grid "${current.gridId}" not found`);
    }
    const cell = grid.cells[current.row][current.col];

    if (cell._tag !== 'Ref') {
      // Hit a non-Ref, we're done
      return [current, false];
    }

    // It's a Ref, we need to exit through it
    const primary = findPrimaryRef(store, cell.gridId);
    if (primary === null) {
      // This Ref points to the root grid, can't exit further
      return [null, false];
    }

    const [parentGridId, parentRow, parentCol] = primary;
    const parentGrid = store.get(parentGridId);
    if (!parentGrid) {
      throw new Error(`Grid "${parentGridId}" not found`);
    }

    // Calculate exit position from primary ref
    const exitRow = parentRow + dr;
    const exitCol = parentCol + dc;

    if (
      exitRow < 0 ||
      exitRow >= parentGrid.rows ||
      exitCol < 0 ||
      exitCol >= parentGrid.cols
    ) {
      // Exiting parent grid too, need to continue up the chain
      current = new CellPosition(parentGridId, parentRow, parentCol);
    } else {
      // Exit position is valid
      current = new CellPosition(parentGridId, exitRow, exitCol);
    }

    depth++;
  }

  // Hit max_depth, treat as cycle
  return [current, true];
}

function* traverseGenerator(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  autoEnter: boolean,
  autoExit: boolean,
  maxDepth: number,
  tagFn: TagFn | null,
  result: TraversalResult
): Generator<CellPosition> {
  function setReason(reason: TerminationReason): void {
    if (result.terminationReason === null) {
      result.terminationReason = reason;
    }
  }

  let current = start;
  yield current;

  const deltas: Record<Direction, [number, number]> = {
    [Direction.N]: [-1, 0],
    [Direction.S]: [1, 0],
    [Direction.E]: [0, 1],
    [Direction.W]: [0, -1],
  };
  const [dr, dc] = deltas[direction];

  let depth = 0;
  while (depth < maxDepth) {
    const grid = store.get(current.gridId);
    if (!grid) {
      throw new Error(`Grid "${current.gridId}" not found`);
    }
    const nextRow = current.row + dr;
    const nextCol = current.col + dc;

    // Check if we're at the edge
    if (nextRow < 0 || nextRow >= grid.rows || nextCol < 0 || nextCol >= grid.cols) {
      // At edge - find primary reference to exit through
      const primary = findPrimaryRef(store, current.gridId);
      if (primary === null) {
        // No parent (root grid) - terminate
        setReason(TerminationReason.EDGE_REACHED);
        return;
      }

      // Teleport to primary reference location
      const [parentGridId, parentRow, parentCol] = primary;
      const parentGrid = store.get(parentGridId);
      if (!parentGrid) {
        throw new Error(`Grid "${parentGridId}" not found`);
      }

      if (!autoExit) {
        // Stop at the Ref we're exiting through
        current = new CellPosition(parentGridId, parentRow, parentCol);
        yield current;
        setReason(TerminationReason.EDGE_REACHED);
        return;
      }

      // Auto-exit: continue in the same direction from the primary ref's position
      const exitRow = parentRow + dr;
      const exitCol = parentCol + dc;

      if (
        exitRow < 0 ||
        exitRow >= parentGrid.rows ||
        exitCol < 0 ||
        exitCol >= parentGrid.cols
      ) {
        // Exiting parent grid too - use chain following
        current = new CellPosition(parentGridId, parentRow, parentCol);
        const [finalPos, hitCycle] = followExitChain(
          store,
          current,
          direction,
          tryEnter,
          maxDepth - depth
        );
        if (hitCycle) {
          setReason(TerminationReason.EXIT_CYCLE_DETECTED);
          return;
        }
        if (finalPos === null) {
          setReason(TerminationReason.EDGE_REACHED);
          return;
        }
        current = finalPos;
        depth += 1;
        continue;
      }

      // Exit position is valid
      current = new CellPosition(parentGridId, exitRow, exitCol);
    } else {
      // Normal movement within grid
      current = new CellPosition(current.gridId, nextRow, nextCol);
    }

    // Get the cell at current position
    const cell = grid.cells[current.row]?.[current.col] ||
                 store.get(current.gridId)!.cells[current.row][current.col];

    // Check if cell has 'stop' tag
    if (tagFn !== null && tagFn(cell).has('stop')) {
      setReason(TerminationReason.STOP_TAG);
      return;
    }

    // Check if current cell is a Ref before yielding
    if (cell._tag === 'Ref') {
      if (autoEnter) {
        // Auto-enter: don't yield the Ref, follow chain to non-Ref
        const entry = tryEnter(cell.gridId, direction);
        if (entry !== null) {
          const [finalPos, hitCycle] = followEnterChain(
            store,
            entry,
            direction,
            tryEnter,
            maxDepth - depth
          );
          if (hitCycle) {
            setReason(TerminationReason.ENTRY_CYCLE_DETECTED);
            return;
          }
          if (finalPos !== null) {
            current = finalPos;
            yield current;
            depth += 1;
          } else {
            setReason(TerminationReason.ENTRY_DENIED);
            return;
          }
        } else {
          setReason(TerminationReason.ENTRY_DENIED);
          return;
        }
      } else {
        // Yield the Ref cell first
        yield current;
        // Then ask try_enter whether to enter
        const entry = tryEnter(cell.gridId, direction);
        if (entry !== null) {
          current = entry;
          yield current;
          depth += 1;
        } else {
          setReason(TerminationReason.ENTRY_DENIED);
          return;
        }
      }
    } else {
      // Not a Ref, just yield it
      yield current;
    }

    depth = 0; // Reset depth counter on normal movement
  }

  // If we exit the while loop, max_depth was reached
  setReason(TerminationReason.MAX_DEPTH_REACHED);
}

export function traverse(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  autoEnter: boolean = false,
  autoExit: boolean = true,
  maxDepth: number = 1000,
  tagFn: TagFn | null = null
): TraversalResult {
  const result = Object.create(TraversalResult.prototype) as TraversalResult;
  result.terminationReason = null;
  const generator = traverseGenerator(
    store,
    start,
    direction,
    tryEnter,
    autoEnter,
    autoExit,
    maxDepth,
    tagFn,
    result
  );
  (result as any).generator = generator;
  return result;
}

export function getCell(store: GridStore, pos: CellPosition): Cell {
  const grid = store.get(pos.gridId);
  if (!grid) {
    throw new Error(`Grid "${pos.gridId}" not found`);
  }
  return grid.cells[pos.row][pos.col];
}

// =============================================================================
// Push Operation
// =============================================================================

class DecisionPoint {
  constructor(
    public readonly refPosition: CellPosition,
    public readonly refCell: Ref,
    public readonly pathSnapshot: [CellPosition, Cell][],
    public readonly visitedSnapshot: Set<string>,
    public readonly depthAtDecision: number
  ) {}
}

function restoreFromDecision(
  decision: DecisionPoint,
  blockedRefs: Set<string>
): [CellPosition, [CellPosition, Cell][], Set<string>, number] {
  const refKey = decision.refPosition.toKey();
  blockedRefs.add(refKey);

  return [
    decision.refPosition,
    [...decision.pathSnapshot],
    new Set(decision.visitedSnapshot),
    decision.depthAtDecision,
  ];
}

export function pushTraverseSimple(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  tagFn: TagFn | null = null,
  maxDepth: number = 1000
): [[CellPosition, Cell][], TerminationReason] {
  const deltas: Record<Direction, [number, number]> = {
    [Direction.N]: [-1, 0],
    [Direction.S]: [1, 0],
    [Direction.E]: [0, 1],
    [Direction.W]: [0, -1],
  };

  const path: [CellPosition, Cell][] = [];
  const visited = new Set<string>();
  let current = start;
  let depth = 0;

  // Add starting position to path
  const startCell = getCell(store, start);
  path.push([start, startCell]);
  visited.add(start.toKey());

  while (depth < maxDepth) {
    depth += 1;

    // Get current grid and compute next position
    const grid = store.get(current.gridId);
    if (!grid) {
      throw new Error(`Grid "${current.gridId}" not found`);
    }
    const [dr, dc] = deltas[direction];
    let nextRow = current.row + dr;
    let nextCol = current.col + dc;

    // Check if we hit an edge
    if (nextRow < 0 || nextRow >= grid.rows || nextCol < 0 || nextCol >= grid.cols) {
      // At edge - need to exit to parent grid
      const primaryRef = findPrimaryRef(store, current.gridId);

      if (primaryRef === null) {
        // No parent - we're at the root grid edge
        return [path, TerminationReason.EDGE_REACHED];
      }

      // Exit through the primary ref
      const [parentGridId, parentRow, parentCol] = primaryRef;
      const parentGrid = store.get(parentGridId);
      if (!parentGrid) {
        throw new Error(`Grid "${parentGridId}" not found`);
      }

      // Continue from the primary ref's position in parent grid
      nextRow = parentRow + dr;
      nextCol = parentCol + dc;

      // Check if we're still at edge after exiting
      if (
        nextRow < 0 ||
        nextRow >= parentGrid.rows ||
        nextCol < 0 ||
        nextCol >= parentGrid.cols
      ) {
        // Cascading exit - use exit chain logic
        const exitPos = new CellPosition(parentGridId, parentRow, parentCol);
        const [finalPos, hitCycle] = followExitChain(
          store,
          exitPos,
          direction,
          tryEnter,
          maxDepth - depth
        );

        if (finalPos === null) {
          return [path, TerminationReason.EDGE_REACHED];
        }

        if (hitCycle) {
          return [path, TerminationReason.EXIT_CYCLE_DETECTED];
        }

        // Continue from final exit position
        current = finalPos;
        const nextGrid = store.get(current.gridId)!;
        nextRow = current.row + dr;
        nextCol = current.col + dc;

        // Check edge again after exit chain
        if (
          nextRow < 0 ||
          nextRow >= nextGrid.rows ||
          nextCol < 0 ||
          nextCol >= nextGrid.cols
        ) {
          return [path, TerminationReason.EDGE_REACHED];
        }

        current = new CellPosition(current.gridId, nextRow, nextCol);
      } else {
        // Normal exit to parent
        current = new CellPosition(parentGridId, nextRow, nextCol);
      }
    } else {
      // Normal move within same grid
      current = new CellPosition(current.gridId, nextRow, nextCol);
    }

    // Check for cycle
    const key = current.toKey();
    if (visited.has(key)) {
      // Check if we cycled back to start (success) or elsewhere (failure)
      if (current.equals(start)) {
        // Cycle to start - success condition for push
        return [path, TerminationReason.PATH_CYCLE_DETECTED];
      } else {
        // Invalid cycle to non-start position
        return [path, TerminationReason.PATH_CYCLE_DETECTED];
      }
    }

    // Get the cell at current position
    const cell = getCell(store, current);

    // Check for stop tag
    if (tagFn !== null) {
      const tags = tagFn(cell);
      if (tags.has('stop')) {
        return [path, TerminationReason.STOP_TAG];
      }
    }

    // Handle Ref cells with portal/solid logic
    if (cell._tag === 'Ref') {
      // Try to enter the referenced grid
      const entryPos = tryEnter(cell.gridId, direction);

      if (entryPos === null) {
        // Entry denied - Ref acts as SOLID object
        path.push([current, cell]);
        visited.add(key);
      } else {
        // Entry allowed - Ref acts as PORTAL
        const [finalPos, hitCycle] = followEnterChain(
          store,
          entryPos,
          direction,
          tryEnter,
          maxDepth - depth
        );

        if (finalPos === null) {
          return [path, TerminationReason.ENTRY_DENIED];
        }

        if (hitCycle) {
          return [path, TerminationReason.ENTRY_CYCLE_DETECTED];
        }

        // Continue from the final position after entering
        current = finalPos;
        const finalCell = getCell(store, current);
        path.push([current, finalCell]);
        visited.add(current.toKey());

        // Check if we just added an Empty cell
        if (finalCell._tag === 'Empty') {
          return [path, TerminationReason.EDGE_REACHED];
        }
      }
    } else {
      // Non-Ref cell - add to path and continue
      path.push([current, cell]);
      visited.add(key);

      // Check if we just added an Empty cell
      if (cell._tag === 'Empty') {
        return [path, TerminationReason.EDGE_REACHED];
      }
    }
  }

  // Exceeded max_depth
  return [path, TerminationReason.MAX_DEPTH_REACHED];
}

export function pushTraverseBacktracking(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  tagFn: TagFn | null = null,
  maxDepth: number = 1000,
  maxBacktrackDepth: number = 10
): [[CellPosition, Cell][], TerminationReason] {
  const deltas: Record<Direction, [number, number]> = {
    [Direction.N]: [-1, 0],
    [Direction.S]: [1, 0],
    [Direction.E]: [0, 1],
    [Direction.W]: [0, -1],
  };

  // Initialize state
  let path: [CellPosition, Cell][] = [];
  let visited = new Set<string>();
  const decisionStack: DecisionPoint[] = [];
  const blockedRefs = new Set<string>();
  let current = start;
  let depth = 0;
  let backtrackCount = 0;

  // Add starting position to path
  const startCell = getCell(store, start);
  path.push([start, startCell]);
  visited.add(start.toKey());

  while (depth < maxDepth) {
    depth += 1;

    // Get current grid and compute next position
    const grid = store.get(current.gridId);
    if (!grid) {
      throw new Error(`Grid "${current.gridId}" not found`);
    }
    const [dr, dc] = deltas[direction];
    let nextRow = current.row + dr;
    let nextCol = current.col + dc;

    // Check if we hit an edge
    if (nextRow < 0 || nextRow >= grid.rows || nextCol < 0 || nextCol >= grid.cols) {
      // At edge - need to exit to parent grid
      const primaryRef = findPrimaryRef(store, current.gridId);

      if (primaryRef === null) {
        // No parent - we're at the root grid edge
        return [path, TerminationReason.EDGE_REACHED];
      }

      // Exit through the primary ref
      const [parentGridId, parentRow, parentCol] = primaryRef;
      const parentGrid = store.get(parentGridId);
      if (!parentGrid) {
        throw new Error(`Grid "${parentGridId}" not found`);
      }

      // Continue from the primary ref's position in parent grid
      nextRow = parentRow + dr;
      nextCol = parentCol + dc;

      // Check if we're still at edge after exiting
      if (
        nextRow < 0 ||
        nextRow >= parentGrid.rows ||
        nextCol < 0 ||
        nextCol >= parentGrid.cols
      ) {
        // Cascading exit - use exit chain logic
        const exitPos = new CellPosition(parentGridId, parentRow, parentCol);
        const [finalPos, hitCycle] = followExitChain(
          store,
          exitPos,
          direction,
          tryEnter,
          maxDepth - depth
        );

        if (finalPos === null) {
          return [path, TerminationReason.EDGE_REACHED];
        }

        if (hitCycle) {
          // Try to backtrack
          if (decisionStack.length > 0 && backtrackCount < maxBacktrackDepth) {
            backtrackCount += 1;
            const decision = decisionStack.pop()!;
            [current, path, visited, depth] = restoreFromDecision(decision, blockedRefs);
            // Add the Ref as solid and continue
            const refCell = getCell(store, current);
            path.push([current, refCell]);
            visited.add(current.toKey());
            continue;
          } else {
            return [path, TerminationReason.EXIT_CYCLE_DETECTED];
          }
        }

        // Continue from final exit position
        current = finalPos;
        const nextGrid = store.get(current.gridId)!;
        nextRow = current.row + dr;
        nextCol = current.col + dc;

        // Check edge again after exit chain
        if (
          nextRow < 0 ||
          nextRow >= nextGrid.rows ||
          nextCol < 0 ||
          nextCol >= nextGrid.cols
        ) {
          return [path, TerminationReason.EDGE_REACHED];
        }

        current = new CellPosition(current.gridId, nextRow, nextCol);
      } else {
        // Normal exit to parent
        current = new CellPosition(parentGridId, nextRow, nextCol);
      }
    } else {
      // Normal move within same grid
      current = new CellPosition(current.gridId, nextRow, nextCol);
    }

    // Check for cycle
    const key = current.toKey();
    if (visited.has(key)) {
      // Check if we cycled back to start (success) or elsewhere (failure)
      if (current.equals(start)) {
        // Cycle to start - success condition for push
        return [path, TerminationReason.PATH_CYCLE_DETECTED];
      } else {
        // Invalid cycle to non-start position - try to backtrack
        if (decisionStack.length > 0 && backtrackCount < maxBacktrackDepth) {
          backtrackCount += 1;
          const decision = decisionStack.pop()!;
          [current, path, visited, depth] = restoreFromDecision(decision, blockedRefs);
          // Add the Ref as solid and continue
          const refCell = getCell(store, current);
          path.push([current, refCell]);
          visited.add(current.toKey());
          continue;
        } else {
          return [path, TerminationReason.PATH_CYCLE_DETECTED];
        }
      }
    }

    // Get the cell at current position
    const cell = getCell(store, current);

    // Check for stop tag
    if (tagFn !== null) {
      const tags = tagFn(cell);
      if (tags.has('stop')) {
        // Hit stop tag - try to backtrack
        if (decisionStack.length > 0 && backtrackCount < maxBacktrackDepth) {
          backtrackCount += 1;
          const decision = decisionStack.pop()!;
          [current, path, visited, depth] = restoreFromDecision(decision, blockedRefs);
          // Add the Ref as solid and continue
          const refCell = getCell(store, current);
          path.push([current, refCell]);
          visited.add(current.toKey());
          continue;
        } else {
          return [path, TerminationReason.STOP_TAG];
        }
      }
    }

    // Handle Ref cells with portal/solid logic + backtracking
    if (cell._tag === 'Ref') {
      const refKey = current.toKey();

      // Check if this Ref is blocked from previous backtrack
      if (!blockedRefs.has(refKey)) {
        // Try to enter the referenced grid (portal behavior)
        const entryPos = tryEnter(cell.gridId, direction);

        if (entryPos !== null) {
          // Entry allowed - create decision point for potential backtracking
          const decision = new DecisionPoint(
            current,
            cell,
            [...path],
            new Set(visited),
            depth
          );
          decisionStack.push(decision);

          // Follow the enter chain to find final non-Ref destination
          const [finalPos, hitCycle] = followEnterChain(
            store,
            entryPos,
            direction,
            tryEnter,
            maxDepth - depth
          );

          if (finalPos === null) {
            // try_enter denied mid-chain - backtrack
            if (backtrackCount < maxBacktrackDepth) {
              backtrackCount += 1;
              const decision = decisionStack.pop()!;
              [current, path, visited, depth] = restoreFromDecision(decision, blockedRefs);
              // Add the Ref as solid and continue
              const refCell = getCell(store, current);
              path.push([current, refCell]);
              visited.add(current.toKey());
              continue;
            } else {
              return [path, TerminationReason.ENTRY_DENIED];
            }
          }

          if (hitCycle) {
            // Cycle in enter chain - backtrack
            if (backtrackCount < maxBacktrackDepth) {
              backtrackCount += 1;
              const decision = decisionStack.pop()!;
              [current, path, visited, depth] = restoreFromDecision(decision, blockedRefs);
              // Add the Ref as solid and continue
              const refCell = getCell(store, current);
              path.push([current, refCell]);
              visited.add(current.toKey());
              continue;
            } else {
              return [path, TerminationReason.ENTRY_CYCLE_DETECTED];
            }
          }

          // Successfully entered - continue from the final position
          current = finalPos;
          const finalCell = getCell(store, current);
          path.push([current, finalCell]);
          visited.add(current.toKey());

          // Check if we just added an Empty cell
          if (finalCell._tag === 'Empty') {
            return [path, TerminationReason.EDGE_REACHED];
          }
        } else {
          // Entry denied - Ref acts as SOLID object
          path.push([current, cell]);
          visited.add(refKey);
        }
      } else {
        // This Ref is blocked from previous backtrack - treat as solid
        path.push([current, cell]);
        visited.add(refKey);
      }
    } else {
      // Non-Ref cell - add to path and continue
      path.push([current, cell]);
      visited.add(key);

      // Check if we just added an Empty cell
      if (cell._tag === 'Empty') {
        return [path, TerminationReason.EDGE_REACHED];
      }
    }
  }

  // Exceeded max_depth
  return [path, TerminationReason.MAX_DEPTH_REACHED];
}

export function applyPush(
  store: GridStore,
  path: [CellPosition, Cell][]
): GridStore {
  // Extract cells and rotate: [c1, c2, c3] -> [c3, c1, c2]
  const cells = path.map(([_, cell]) => cell);
  const rotated = [cells[cells.length - 1], ...cells.slice(0, -1)];

  // Group updates by grid_id
  const updates = new Map<string, [number, number, Cell][]>();
  for (let i = 0; i < path.length; i++) {
    const [pos, _] = path[i];
    if (!updates.has(pos.gridId)) {
      updates.set(pos.gridId, []);
    }
    updates.get(pos.gridId)!.push([pos.row, pos.col, rotated[i]]);
  }

  // Reconstruct affected grids immutably
  const newStore = new Map(store);
  for (const [gridId, gridUpdates] of updates) {
    const grid = store.get(gridId)!;

    // Convert to mutable structure
    const mutableCells = grid.cells.map((row) => [...row]);

    // Apply all updates for this grid
    for (const [row, col, newCell] of gridUpdates) {
      mutableCells[row][col] = newCell;
    }

    // Create new Grid instance
    const newGrid = new Grid(grid.id, mutableCells);
    newStore.set(gridId, newGrid);
  }

  return newStore;
}

export function pushSimple(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  tagFn: TagFn | null = null,
  maxDepth: number = 1000
): GridStore | null {
  const [path, reason] = pushTraverseSimple(store, start, direction, tryEnter, tagFn, maxDepth);

  // Check success conditions
  if (reason === TerminationReason.EDGE_REACHED) {
    // Success if path ends at Empty
    if (path.length > 0 && path[path.length - 1][1]._tag === 'Empty') {
      return applyPush(store, path);
    } else {
      return null;
    }
  } else if (reason === TerminationReason.PATH_CYCLE_DETECTED) {
    // Success if cycle returns to start position
    if (path.length >= 2 && path[0][0].equals(start)) {
      return applyPush(store, path);
    } else {
      return null;
    }
  } else {
    // All other termination reasons are failures
    return null;
  }
}

export function push(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  tryEnter: TryEnter,
  tagFn: TagFn | null = null,
  maxDepth: number = 1000,
  maxBacktrackDepth: number = 10
): GridStore | null {
  const [path, reason] = pushTraverseBacktracking(
    store,
    start,
    direction,
    tryEnter,
    tagFn,
    maxDepth,
    maxBacktrackDepth
  );

  // Check success conditions
  if (reason === TerminationReason.EDGE_REACHED) {
    // Success if path ends at Empty
    if (path.length > 0 && path[path.length - 1][1]._tag === 'Empty') {
      return applyPush(store, path);
    } else {
      return null;
    }
  } else if (reason === TerminationReason.PATH_CYCLE_DETECTED) {
    // Success if cycle returns to start position
    if (path.length >= 2 && path[0][0].equals(start)) {
      return applyPush(store, path);
    } else {
      return null;
    }
  } else {
    // All other termination reasons are failures
    return null;
  }
}
