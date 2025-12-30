# TypeScript Port Implementation Plan

## Project Overview

**Goal**: Port the Python paragrid library to TypeScript with full feature parity for core mechanics (grid structures, parsing, analysis, navigation, push/pull operations) and comprehensive test coverage.

**Scope**:
- ✅ **Include**: All core grid mechanics (~100+ tests)
- ❌ **Exclude**: Rendering utilities and ASCII output

**Technology Stack**:
- TypeScript 5.9+ (strict mode)
- Vite 7.3+ (build tool)
- Vitest 4.0+ (testing)
- fraction.js (rational arithmetic)

---

## Current Status

### ✅ Completed: Phase 0-1 (Foundation)
- [x] Project setup and dependencies
- [x] Core type system implementation
- [x] String parser with validation
- [x] **19/100+ tests passing**

### 🚧 In Progress: Phase 2 (Analysis)
- [ ] CellNode types
- [ ] Primary reference detection
- [ ] Analyze function with rational math

### ⏳ Remaining: Phases 3-10
- Navigation, operations, tagging, pull, edge cases, polish

---

## Complete File Structure

```
web/
├── src/
│   ├── lib/
│   │   ├── core/
│   │   │   ├── types.ts          ✅ Cell, Grid, GridStore
│   │   │   ├── direction.ts      ✅ Direction enum
│   │   │   ├── position.ts       ✅ CellPosition
│   │   │   └── index.ts          ⏳ Barrel exports
│   │   ├── parser/
│   │   │   ├── parser.ts         ✅ parseGrids()
│   │   │   └── index.ts          ⏳ Barrel exports
│   │   ├── analysis/
│   │   │   ├── types.ts          ⏳ CellNode variants
│   │   │   ├── analyze.ts        ⏳ analyze() function
│   │   │   ├── primary-ref.ts    ⏳ findPrimaryRef()
│   │   │   └── index.ts          ⏳ Barrel exports
│   │   ├── navigator/
│   │   │   ├── navigator.ts      ⏳ Navigator class
│   │   │   ├── try-enter.ts      ⏳ tryEnter()
│   │   │   └── index.ts          ⏳ Barrel exports
│   │   ├── operations/
│   │   │   ├── rules.ts          ⏳ RefStrategy, RuleSet
│   │   │   ├── push.ts           ⏳ push(), pushSimple()
│   │   │   ├── pull.ts           ⏳ pull()
│   │   │   ├── apply.ts          ⏳ applyPush(), applyPull()
│   │   │   ├── failure.ts        ⏳ PushFailure type
│   │   │   └── index.ts          ⏳ Barrel exports
│   │   ├── tagging/
│   │   │   ├── types.ts          ⏳ TagFn type
│   │   │   ├── find-tagged.ts    ⏳ findTaggedCell()
│   │   │   └── index.ts          ⏳ Barrel exports
│   │   ├── utils/
│   │   │   ├── fraction.ts       ⏳ Rational arithmetic wrapper
│   │   │   ├── immutable.ts      ⏳ Immutability helpers
│   │   │   └── index.ts          ⏳ Barrel exports
│   │   └── index.ts              ⏳ Public API exports
│   ├── main.ts                   ✅ Application entry
│   └── vite-env.d.ts             ✅ Type declarations
├── test/
│   ├── core/
│   │   ├── types.test.ts         ✅ 5 tests passing
│   │   └── parser.test.ts        ✅ 14 tests passing
│   ├── analysis/
│   │   ├── analyze.test.ts       ⏳ TestAnalyze (6 tests)
│   │   └── primary-ref.test.ts   ⏳ TestFindPrimaryRef (5 tests)
│   ├── navigator/
│   │   └── navigator.test.ts     ⏳ TestNavigator (1 test)
│   ├── operations/
│   │   ├── push.test.ts          ⏳ TestPush (9 tests)
│   │   ├── push-backtracking.test.ts  ⏳ TestPushBacktracking (3 tests)
│   │   ├── push-swallowing.test.ts    ⏳ TestPushSwallowing (11 tests)
│   │   ├── pull.test.ts          ⏳ TestPull (14 tests)
│   │   └── tagging.test.ts       ⏳ TestTagging (2 tests)
│   ├── edge-cases/
│   │   └── edge-cases.test.ts    ⏳ TestEdgeCases (7 tests)
│   └── test-utils.ts             ⏳ Shared test helpers
├── package.json                  ✅ Dependencies configured
├── tsconfig.json                 ✅ TypeScript config (strict mode)
├── vite.config.ts                ✅ Build configuration
└── IMPLEMENTATION_PLAN.md        ✅ This document
```

**Legend**: ✅ Complete | 🚧 In Progress | ⏳ Pending

---

## Phase-by-Phase Implementation Plan

### Phase 0: Setup ✅ COMPLETE

**Duration**: 30 minutes
**Status**: ✅ Complete

#### Tasks
- [x] Install fraction.js dependency
- [x] Verify Vitest configuration
- [x] Create directory structure
- [x] Validate test runner works

#### Validation
- [x] `npm test` runs without errors
- [x] fraction.js available for import

---

### Phase 1: Core Types & Parser ✅ COMPLETE

**Duration**: 2-3 hours
**Status**: ✅ Complete
**Tests**: 19/19 passing

#### Implementation Files
- [x] `src/lib/core/direction.ts` - Direction enum (N, S, E, W)
- [x] `src/lib/core/types.ts` - Cell types (Empty, Concrete, Ref), Grid, GridStore
- [x] `src/lib/core/position.ts` - CellPosition class
- [x] `src/lib/parser/parser.ts` - parseGrids() function

#### Key Features Implemented
- [x] Discriminated unions with `type` field for Cell variants
- [x] `readonly` arrays and interfaces for immutability
- [x] Parser handles: spaces/`_` → Empty, digits → Concrete, letters → Ref
- [x] Primary/secondary ref markers (`*`, `~`)
- [x] Detailed error messages with position information

#### Tests
- [x] `test/core/types.test.ts` - TestGridStructures (5 tests)
  - [x] Empty cell creation
  - [x] Concrete cell creation
  - [x] Ref cell creation
  - [x] Grid creation
  - [x] Grid dimensions

- [x] `test/core/parser.test.ts` - TestParseGrids (14 tests)
  - [x] Simple concrete grid parsing
  - [x] Grids with refs
  - [x] Empty cells (spaces)
  - [x] Underscore empty markers
  - [x] Multi-character IDs
  - [x] Multi-character refs
  - [x] Explicit primary refs (`*A`)
  - [x] Explicit secondary refs (`~A`)
  - [x] Auto-determined refs
  - [x] Case sensitivity
  - [x] Invalid cell error handling
  - [x] Inconsistent row length error
  - [x] Single row grids
  - [x] Single column grids

#### Validation Criteria
- [x] All 19 tests passing
- [x] TypeScript compiles with zero errors
- [x] No `any` types in implementation

---

### Phase 2: Analysis & Primary Ref ⏳ PENDING

**Duration**: 2-3 hours
**Status**: ⏳ Not started
**Tests**: 0/11 tests

#### Implementation Files
- [ ] `src/lib/utils/fraction.ts` - Rational arithmetic wrapper
  - [ ] Wrapper around fraction.js
  - [ ] Convenience functions for common operations
  - [ ] Type-safe interface

- [ ] `src/lib/analysis/types.ts` - CellNode variants
  - [ ] EmptyNode interface
  - [ ] ConcreteNode interface (id, gridId)
  - [ ] NestedNode interface (gridId, children)
  - [ ] RefNode interface (gridId, refTarget, isPrimary, content)
  - [ ] CutoffNode interface (threshold reached)
  - [ ] CellNode union type
  - [ ] Type guards for each variant

- [ ] `src/lib/analysis/primary-ref.ts` - findPrimaryRef()
  - [ ] Search grid for primary reference to target
  - [ ] Handle explicit markers (`*`, `~`)
  - [ ] Auto-determine first occurrence
  - [ ] Return position or undefined

- [ ] `src/lib/analysis/analyze.ts` - analyze() function
  - [ ] DFS traversal with Fraction dimensions
  - [ ] Threshold termination (default 1/10)
  - [ ] Track primary_refs set through recursion
  - [ ] Build CellTree structure
  - [ ] Handle cycles via threshold cutoff

#### Key Design Patterns
```typescript
// CellNode discriminated union
type CellNode = EmptyNode | ConcreteNode | NestedNode | RefNode | CutoffNode;

interface NestedNode {
  readonly type: 'nested';
  readonly gridId: string;
  readonly children: ReadonlyArray<ReadonlyArray<CellNode>>;
  readonly width: Fraction;
  readonly height: Fraction;
}

// Analysis function signature
function analyze(
  store: GridStore,
  gridId: string,
  width: Fraction,
  height: Fraction,
  threshold?: Fraction,
  primaryRefs?: Set<string>
): CellNode;
```

#### Tests
- [ ] `test/analysis/primary-ref.test.ts` - TestFindPrimaryRef (5 tests)
  - [ ] Find simple primary ref
  - [ ] No primary ref found
  - [ ] First occurrence as primary
  - [ ] Explicit primary marker
  - [ ] Explicit overrides order

- [ ] `test/analysis/analyze.test.ts` - TestAnalyze (6 tests)
  - [ ] Analyze simple grid
  - [ ] Analyze with empty cells
  - [ ] Analyze with reference
  - [ ] Threshold cutoff
  - [ ] Self-referencing grid
  - [ ] Primary ref tracking

#### Validation Criteria
- [ ] 11 new tests passing (30 total)
- [ ] Fraction.js integration working
- [ ] Rational arithmetic produces exact results
- [ ] Threshold termination prevents infinite recursion

---

### Phase 3: Navigator & Try-Enter ⏳ PENDING

**Duration**: 2 hours
**Status**: ⏳ Not started
**Tests**: 0/1 tests

#### Implementation Files
- [ ] `src/lib/operations/rules.ts` - RefStrategy system
  - [ ] RefStrategyType enum (PORTAL, SOLID, SWALLOW)
  - [ ] RefStrategy class with predefined orders
    - [ ] DEFAULT: [SOLID, PORTAL, SWALLOW]
    - [ ] TRY_ENTER_FIRST: [PORTAL, SOLID, SWALLOW]
    - [ ] PUSH_FIRST: [SOLID, PORTAL, SWALLOW]
    - [ ] SWALLOW_FIRST: [SWALLOW, PORTAL, SOLID]
  - [ ] RuleSet interface with ref_strategy

- [ ] `src/lib/navigator/try-enter.ts` - tryEnter() standalone
  - [ ] Attempt to enter Ref at position
  - [ ] Handle entry into referenced grid
  - [ ] Update navigator state
  - [ ] Cycle detection

- [ ] `src/lib/navigator/navigator.ts` - Navigator class
  - [ ] State: current position, direction, visited_grids
  - [ ] try_advance() - Move to next cell, handle edges
  - [ ] try_enter() - Enter Ref at current position
  - [ ] try_enter_multi() - Enter through Ref chains
  - [ ] flip() - Reverse direction (for swallow)
  - [ ] clone() - Create copy for backtracking
  - [ ] Exit cycle detection (iterative approach)

#### Key Implementation Details
```typescript
class Navigator {
  current: CellPosition;
  direction: Direction;
  private visitedGrids: Set<string>;

  constructor(store: GridStore, start: CellPosition, direction: Direction);

  tryAdvance(): boolean; // Move forward, handle edges
  tryEnter(rules: RuleSet): boolean; // Enter Ref
  flip(): void; // Reverse direction
  clone(): Navigator; // For backtracking
}
```

#### Tests
- [ ] `test/navigator/navigator.test.ts` - TestNavigator (1 test)
  - [ ] Exit cycle detection with mutual references

#### Validation Criteria
- [ ] 1 new test passing (31 total)
- [ ] Navigator handles edge crossing correctly
- [ ] Exit cycle detection prevents infinite loops
- [ ] Clone creates independent copy

---

### Phase 4: Simple Push & Apply ⏳ PENDING

**Duration**: 3-4 hours
**Status**: ⏳ Not started
**Tests**: 0/9 tests

#### Implementation Files
- [ ] `src/lib/operations/failure.ts` - PushFailure type
  - [ ] PushFailure interface with reason and position
  - [ ] Failure reasons enum
  - [ ] Type guard: isPushFailure()

- [ ] `src/lib/utils/immutable.ts` - Immutability helpers
  - [ ] getCell() - Safe cell access
  - [ ] setCell() - Immutable cell update
  - [ ] Deep freeze utilities

- [ ] `src/lib/operations/apply.ts` - applyPush()
  - [ ] Rotate path contents forward: [c1,c2,c3] → [c3,c1,c2]
  - [ ] Update multiple grids immutably
  - [ ] Return new GridStore

- [ ] `src/lib/operations/push.ts` - pushSimple()
  - [ ] Build path with Navigator
  - [ ] Strategy selection (solid/portal/swallow)
  - [ ] Check termination (Empty, edge, stop tag)
  - [ ] Apply rotation on success
  - [ ] Return GridStore or PushFailure

#### Key Algorithm
```typescript
function pushSimple(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  rules: RuleSet,
  tagFn?: TagFn
): GridStore | PushFailure {
  // 1. Initialize navigator
  // 2. Build path by advancing
  // 3. For each position, try strategies in order
  // 4. Check termination conditions
  // 5. Apply rotation if successful
}
```

#### Tests
- [ ] `test/operations/push.test.ts` - TestPush (9 tests)
  - [ ] Push simple to empty
  - [ ] Push single cell at empty
  - [ ] Push immutability
  - [ ] Push fails at edge with no empty
  - [ ] Push through portal (TRY_ENTER_FIRST)
  - [ ] Push blocked ref (PUSH_FIRST)
  - [ ] Push affects multiple grids
  - [ ] Push stops at empty
  - [ ] Push stops at empty through portal

#### Validation Criteria
- [ ] 9 new tests passing (40 total)
- [ ] Immutable updates preserve original store
- [ ] Path rotation works correctly
- [ ] Strategy system functional

---

### Phase 5: Push with Backtracking ⏳ PENDING

**Duration**: 3-4 hours
**Status**: ⏳ Not started
**Tests**: 0/3 tests

#### Implementation Files
- [ ] Update `src/lib/operations/push.ts` - Add push()
  - [ ] State type: {nav: Navigator, path: CellPosition[], strategyIndex: number}
  - [ ] Decision stack for backtracking
  - [ ] Try strategies in order from RuleSet
  - [ ] Backtrack on failure, try next strategy
  - [ ] Success conditions: Empty or cycle to start
  - [ ] Depth limit (prevent infinite backtracking)

#### Key Algorithm
```typescript
function push(
  store: GridStore,
  start: CellPosition,
  direction: Direction,
  rules: RuleSet,
  tagFn?: TagFn,
  maxDepth?: number
): GridStore | PushFailure {
  // 1. Initialize decision stack with start state
  // 2. While stack not empty:
  //    a. Pop state
  //    b. Try strategies from strategyIndex onward
  //    c. For each strategy:
  //       - Clone navigator
  //       - Apply strategy
  //       - Check termination
  //       - If success: apply and return
  //       - If can continue: push new state to stack
  //    d. If all strategies fail: backtrack
  // 3. All paths exhausted: return failure
}
```

#### Tests
- [ ] `test/operations/push-backtracking.test.ts` - TestPushBacktracking (3 tests)
  - [ ] Backtrack on stop inside ref
  - [ ] No backtrack when simple succeeds
  - [ ] Backtrack multiple levels
  - [ ] Backtrack on entry denied in chain

#### Validation Criteria
- [ ] 3 new tests passing (43 total)
- [ ] Backtracking explores alternative strategies
- [ ] Depth limit prevents infinite loops
- [ ] State cloning works correctly

---

### Phase 6: Swallowing Mechanics ⏳ PENDING

**Duration**: 3-4 hours
**Status**: ⏳ Not started
**Tests**: 0/11 tests

#### Implementation Files
- [ ] Update `src/lib/operations/push.ts` - SWALLOW strategy
  - [ ] Swallow logic: add to path, flip direction, advance, enter
  - [ ] Only applicable when start is Ref
  - [ ] Target cell gets swallowed by Ref
  - [ ] Strategy ordering affects behavior
  - [ ] Stop tags prevent swallowing

#### Key Implementation
```typescript
// In push() strategy loop
case RefStrategyType.SWALLOW:
  if (!isRef(startCell)) break; // Only Refs can swallow

  path.push(currentPos);
  nav.flip(); // Reverse direction
  if (!nav.tryAdvance()) break; // Move backwards
  if (!nav.tryEnter(rules)) break; // Enter the ref
  // Continue building path from inside ref
```

#### Tests
- [ ] `test/operations/push-swallowing.test.ts` - TestPushSwallowing (11 tests)
  - [ ] Swallow basic mechanics (N/S/E/W)
  - [ ] Swallow with SWALLOW_FIRST strategy
  - [ ] Stop tag prevents swallowing
  - [ ] Strategy ordering: SWALLOW vs PORTAL priority
  - [ ] Swallow chain reactions
  - [ ] Immutability preservation
  - [ ] Swallow through nested refs

#### Validation Criteria
- [ ] 11 new tests passing (54 total)
- [ ] Swallow only works when start is Ref
- [ ] Direction flip works correctly
- [ ] Strategy ordering respected

---

### Phase 7: Tagging System ⏳ PENDING

**Duration**: 1-2 hours
**Status**: ⏳ Not started
**Tests**: 0/2 tests

#### Implementation Files
- [ ] `src/lib/tagging/types.ts` - TagFn type
  - [ ] TagFn function signature
  - [ ] Returns Set<string> of tags for position

- [ ] `src/lib/tagging/find-tagged.ts` - findTaggedCell()
  - [ ] Search for cell with specific tag
  - [ ] Search within grid or entire store
  - [ ] Return position or undefined

- [ ] Integrate tag checking in push/pull
  - [ ] Check start position for "stop" tag
  - [ ] Check positions in referenced grids
  - [ ] Prevent movement of stop-tagged cells

#### Key Pattern
```typescript
type TagFn = (
  store: GridStore,
  gridId: string,
  row: number,
  col: number
) => Set<string>;

// Usage in push
if (tagFn) {
  const tags = tagFn(store, start.gridId, start.row, start.col);
  if (tags.has('stop')) {
    return { reason: 'STOP_TAG', position: start };
  }
}
```

#### Tests
- [ ] `test/operations/tagging.test.ts` - TestTagging (2 tests)
  - [ ] Stop tag terminates traversal
  - [ ] No tag function continues normally
  - [ ] Empty tags continues
  - [ ] Non-stop tags ignored
  - [ ] Stop tag on ref cell
  - [ ] Stop tag on empty cell
  - [ ] Stop tag with multiple tags

#### Validation Criteria
- [ ] 2 new tests passing (56 total)
- [ ] Stop tags prevent push/pull
- [ ] Tag function integration works
- [ ] Tags respected in nested grids

---

### Phase 8: Pull Operations ⏳ PENDING

**Duration**: 3-4 hours
**Status**: ⏳ Not started
**Tests**: 0/14 tests

#### Implementation Files
- [ ] Update `src/lib/operations/apply.ts` - Add applyPull()
  - [ ] Opposite rotation: [c1,c2,c3] → [c2,c3,c1]
  - [ ] Move first cell to end (maintains order)
  - [ ] Immutable multi-grid updates

- [ ] `src/lib/operations/pull.ts` - pull()
  - [ ] Start MUST be Empty (else return store unchanged)
  - [ ] Always succeeds (never returns failure)
  - [ ] Termination: Empty, stop tag, or cycle
  - [ ] No backtracking (first applicable strategy only)
  - [ ] Skip SWALLOW strategy (not applicable to pull)
  - [ ] Build path backwards from start

#### Key Differences from Push
| Aspect | Push | Pull |
|--------|------|------|
| Start requirement | Any cell | Must be Empty |
| Failure possible | Yes | No (always succeeds) |
| Rotation | Forward [c1,c2,c3]→[c3,c1,c2] | Backward [c1,c2,c3]→[c2,c3,c1] |
| Backtracking | Yes | No |
| SWALLOW strategy | Yes | No |
| Stop tag behavior | Failure | Success termination |

#### Tests
- [ ] `test/operations/pull.test.ts` - TestPull (14 tests)
  - [ ] Pull basic mechanics
  - [ ] Pull rotation order
  - [ ] Pull starts from Empty only
  - [ ] Pull through portals
  - [ ] Pull vs solid refs
  - [ ] Pull stops at stop tag
  - [ ] Pull stops at cycle
  - [ ] Pull max depth
  - [ ] Pull immutability
  - [ ] Pull with no empty start (no-op)

#### Validation Criteria
- [ ] 14 new tests passing (70 total)
- [ ] Pull never returns failure
- [ ] Rotation opposite from push
- [ ] Empty start requirement enforced
- [ ] No backtracking implementation

---

### Phase 9: Edge Cases ⏳ PENDING

**Duration**: 2-3 hours
**Status**: ⏳ Not started
**Tests**: 0/7 tests

#### Tests
- [ ] `test/edge-cases/edge-cases.test.ts` - TestEdgeCases (7 tests)
  - [ ] Single-cell grid (1×1) - minimum valid grid
  - [ ] Grid with all empty cells
  - [ ] Deeply nested structures (3+ levels)
  - [ ] Mutual recursion (A refs B, B refs A)
  - [ ] Large grids (5×5 or larger)
  - [ ] Traverse all directions (N, S, E, W)
  - [ ] Complete workflow integration

#### Focus Areas
- [ ] Ensure threshold cutoff handles deep nesting
- [ ] Performance with large grids
- [ ] Memory efficiency with immutable updates
- [ ] Edge detection at all boundaries
- [ ] Cycle detection in complex graphs

#### Validation Criteria
- [ ] 7 new tests passing (77 total)
- [ ] No stack overflows with deep recursion
- [ ] Acceptable performance (tests run <5 seconds)
- [ ] Memory usage reasonable

---

### Phase 10: Polish & Documentation ⏳ PENDING

**Duration**: 2-3 hours
**Status**: ⏳ Not started

#### Tasks
- [ ] Create barrel exports (`index.ts` files)
  - [ ] `src/lib/core/index.ts`
  - [ ] `src/lib/parser/index.ts`
  - [ ] `src/lib/analysis/index.ts`
  - [ ] `src/lib/navigator/index.ts`
  - [ ] `src/lib/operations/index.ts`
  - [ ] `src/lib/tagging/index.ts`
  - [ ] `src/lib/utils/index.ts`
  - [ ] `src/lib/index.ts` (main public API)

- [ ] Add JSDoc documentation
  - [ ] All public functions have JSDoc
  - [ ] Parameter descriptions
  - [ ] Return value descriptions
  - [ ] Usage examples in comments
  - [ ] Link to related functions

- [ ] Create test utilities
  - [ ] `test/test-utils.ts` with common helpers
  - [ ] Grid builder utilities
  - [ ] Assertion helpers
  - [ ] Mock tag functions

- [ ] Create README.md
  - [ ] Installation instructions
  - [ ] Basic usage examples
  - [ ] API reference
  - [ ] TypeScript usage patterns

- [ ] Final verification
  - [ ] All tests passing
  - [ ] No TypeScript errors
  - [ ] No `any` types in public API
  - [ ] Consistent code style
  - [ ] All imports use `.js` extension

#### Public API Example
```typescript
// src/lib/index.ts
export {
  // Core types
  Empty, Concrete, Ref,
  type Cell, type Grid, type GridStore,
  createGrid, getGrid, setGrid, getCell,

  // Direction
  Direction, flipDirection,

  // Position
  CellPosition,

  // Parser
  parseGrids,

  // Analysis
  analyze, findPrimaryRef,
  type CellNode,

  // Navigator
  Navigator,

  // Operations
  push, pushSimple, pull,
  RefStrategyType, RefStrategy, RuleSet,
  type PushFailure, isPushFailure,

  // Tagging
  findTaggedCell,
  type TagFn,
} from './lib/index.js';
```

#### Validation Criteria
- [ ] Public API clean and well-documented
- [ ] All exports work correctly
- [ ] README has usage examples
- [ ] No broken imports
- [ ] TypeScript declaration files generated

---

## Complete Task Checklist

### Setup & Foundation
- [x] Install fraction.js
- [x] Configure Vitest
- [x] Create directory structure
- [x] Implement Direction enum
- [x] Implement Cell types (Empty, Concrete, Ref)
- [x] Implement Grid and GridStore
- [x] Implement CellPosition
- [x] Implement parseGrids()
- [x] Port TestGridStructures (5 tests)
- [x] Port TestParseGrids (14 tests)

### Analysis System (Phase 2)
- [ ] Create Fraction wrapper utility
- [ ] Implement CellNode type variants
- [ ] Implement findPrimaryRef()
- [ ] Implement analyze() with DFS
- [ ] Port TestFindPrimaryRef (5 tests)
- [ ] Port TestAnalyze (6 tests)

### Navigation System (Phase 3)
- [ ] Implement RefStrategyType enum
- [ ] Implement RefStrategy presets
- [ ] Implement RuleSet interface
- [ ] Implement Navigator class
- [ ] Implement tryEnter() function
- [ ] Port TestNavigator (1 test)

### Push Operations (Phases 4-6)
- [ ] Implement PushFailure type
- [ ] Implement immutability helpers
- [ ] Implement applyPush() with rotation
- [ ] Implement pushSimple() without backtracking
- [ ] Port TestPush (9 tests)
- [ ] Implement push() with backtracking
- [ ] Port TestPushBacktracking (3 tests)
- [ ] Add SWALLOW strategy to push
- [ ] Port TestPushSwallowing (11 tests)

### Tagging System (Phase 7)
- [ ] Implement TagFn type
- [ ] Implement findTaggedCell()
- [ ] Integrate tags in push/pull
- [ ] Port TestTagging (2 tests)

### Pull Operations (Phase 8)
- [ ] Implement applyPull() with opposite rotation
- [ ] Implement pull() function
- [ ] Port TestPull (14 tests)

### Integration & Polish (Phases 9-10)
- [ ] Port TestEdgeCases (7 tests)
- [ ] Create barrel exports (8 files)
- [ ] Add JSDoc to all public functions
- [ ] Create test utilities
- [ ] Write README.md
- [ ] Final verification and cleanup

**Total Tasks**: 67
**Completed**: 10 (15%)
**Remaining**: 57 (85%)

---

## Test Coverage Target

| Test Suite | Tests | Status |
|------------|-------|--------|
| TestGridStructures | 5 | ✅ Complete |
| TestParseGrids | 14 | ✅ Complete |
| TestFindPrimaryRef | 5 | ⏳ Pending |
| TestAnalyze | 6 | ⏳ Pending |
| TestNavigator | 1 | ⏳ Pending |
| TestPush | 9 | ⏳ Pending |
| TestPushBacktracking | 3 | ⏳ Pending |
| TestPushSwallowing | 11 | ⏳ Pending |
| TestTagging | 2 | ⏳ Pending |
| TestPull | 14 | ⏳ Pending |
| TestEdgeCases | 7 | ⏳ Pending |
| **Total** | **77** | **19/77 (25%)** |

---

## Key TypeScript Patterns

### Discriminated Unions
```typescript
// Python: Cell = Empty | Concrete | Ref (dataclasses)
// TypeScript: Discriminated union with type field

type Cell = Empty | Concrete | Ref;

interface Empty {
  readonly type: 'empty';
}

interface Concrete {
  readonly type: 'concrete';
  readonly id: string;
}

// Type guards
function isEmpty(cell: Cell): cell is Empty {
  return cell.type === 'empty';
}
```

### Immutability
```typescript
// All interfaces use readonly
interface Grid {
  readonly id: string;
  readonly cells: ReadonlyArray<ReadonlyArray<Cell>>;
  readonly rows: number;
  readonly cols: number;
}

// Factory functions freeze objects
function Concrete(id: string): Concrete {
  return Object.freeze({ type: 'concrete', id });
}

// Updates use spread operators
const newStore = { ...store, [grid.id]: grid };
```

### Result Types (No Exceptions for Expected Failures)
```typescript
// Push can legitimately fail - not an exception
type PushResult = GridStore | PushFailure;

interface PushFailure {
  readonly reason: 'ENTER_CYCLE' | 'EXIT_CYCLE' | 'BLOCKED' | 'STOP_TAG';
  readonly position: CellPosition;
}

// Type guard
function isPushFailure(result: PushResult): result is PushFailure {
  return 'reason' in result;
}

// Usage
const result = push(store, start, Direction.E, rules);
if (isPushFailure(result)) {
  console.log(`Push failed: ${result.reason}`);
} else {
  // result is GridStore
  console.log('Push succeeded');
}
```

### Rational Arithmetic
```typescript
import Fraction from 'fraction.js';

// Python: Fraction(1, 3)
// TypeScript: new Fraction(1, 3)

function analyze(
  store: GridStore,
  gridId: string,
  width: Fraction,
  height: Fraction,
  threshold: Fraction = new Fraction(1, 10)
): CellNode {
  const cellWidth = width.div(grid.cols);
  const cellHeight = height.div(grid.rows);

  if (cellWidth.compare(threshold) < 0 || cellHeight.compare(threshold) < 0) {
    return { type: 'cutoff' };
  }

  // ...
}
```

---

## Critical Design Decisions

### 1. Immutability Strategy
**Decision**: Structural immutability with TypeScript type system
**Rationale**:
- `readonly` provides compile-time safety
- Object.freeze() for runtime protection (development)
- Functional update patterns (spread operators)
- No heavyweight libraries needed

### 2. Error Handling
**Decision**: Return types for expected failures, exceptions for programmer errors
**Rationale**:
- Push can legitimately fail - not exceptional
- Type system enforces checking with type guards
- Pattern: `GridStore | PushFailure`
- Clear intent in function signatures

### 3. Module Organization
**Decision**: Feature-based folders with barrel exports
**Rationale**:
- Clear module boundaries
- Easy to navigate
- Tree-shaking friendly
- Clean imports: `import { push, pull } from '@paragrid/web'`

### 4. Class vs Function
**Decision**: Minimal classes, prefer functions
**Rationale**:
- Navigator: class (stateful by design)
- Everything else: functions (pure, immutable)
- Matches functional programming style
- Easier to test

### 5. Rational Arithmetic Library
**Decision**: Use fraction.js npm package
**Rationale**:
- Mature, well-tested
- API similar to Python's Fraction
- Supports all required operations
- No need to reinvent the wheel

---

## Running the Project

### Install Dependencies
```bash
npm install
```

### Run Tests
```bash
# Run all tests
npm test

# Watch mode (run on file change)
npm run test:watch

# UI mode
npm run test:ui

# Specific test file
npm test test/core/types.test.ts
```

### Build
```bash
# Build for production
npm run build

# Development server (if needed)
npm run dev
```

### Type Check
```bash
# TypeScript type checking
npx tsc --noEmit
```

---

## Success Criteria

### Code Quality
- [ ] All 77+ tests passing
- [ ] TypeScript compiles with zero errors (strict mode)
- [ ] No `any` types in public API
- [ ] Consistent naming conventions (camelCase)
- [ ] Clean module boundaries
- [ ] Comprehensive JSDoc documentation

### Functionality
- [ ] Core mechanics match Python behavior exactly
- [ ] Immutability enforced throughout
- [ ] Rational arithmetic produces exact results
- [ ] Cycle detection prevents infinite loops
- [ ] Strategy system works as designed

### Performance
- [ ] Test suite runs in < 5 seconds
- [ ] No obvious performance regressions vs Python
- [ ] Memory efficient for large grids (10×10+)
- [ ] No stack overflows with deep recursion

### Documentation
- [ ] README with usage examples
- [ ] JSDoc on all public functions
- [ ] Type definitions export correctly
- [ ] Clear API boundaries

---

## Time Estimates

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 0. Setup | 0.5h | 0.5h |
| 1. Core & Parser | 2.5h | 3h |
| 2. Analysis | 2.5h | 5.5h |
| 3. Navigator | 2h | 7.5h |
| 4. Simple Push | 3.5h | 11h |
| 5. Backtracking | 3.5h | 14.5h |
| 6. Swallowing | 3.5h | 18h |
| 7. Tagging | 1.5h | 19.5h |
| 8. Pull | 3.5h | 23h |
| 9. Edge Cases | 2.5h | 25.5h |
| 10. Polish | 2.5h | 28h |
| **Total** | **28h** | |

**Progress**: 3h / 28h (11%)
**Remaining**: 25h (89%)

---

## Next Steps

**Current Focus**: Phase 2 - Analysis & Primary Ref

**Immediate Tasks**:
1. Create `src/lib/utils/fraction.ts` wrapper
2. Implement CellNode type variants in `src/lib/analysis/types.ts`
3. Implement `findPrimaryRef()` in `src/lib/analysis/primary-ref.ts`
4. Implement `analyze()` in `src/lib/analysis/analyze.ts`
5. Port 11 tests (TestFindPrimaryRef + TestAnalyze)

**After Phase 2**: Continue with Navigator implementation (Phase 3)

---

## References

- **Python Source**: `/Users/james.hopkin/code/personal/paragrid/python/paragrid.py`
- **Python Tests**: `/Users/james.hopkin/code/personal/paragrid/python/test_paragrid.py`
- **Implementation Plan**: `/Users/james.hopkin/.claude/plans/enchanted-enchanting-ritchie.md`
- **Project Instructions**: `/Users/james.hopkin/code/personal/paragrid/CLAUDE.md`

---

*Last Updated: 2025-12-29*
*Status: Phase 1 Complete - 19/77 tests passing (25%)*
