/**
 * Tests for simple push operation (without backtracking).
 */

import { describe, it, expect } from 'vitest';
import { Concrete, Empty, Ref, type GridStore } from '../../src/lib/core/types.js';
import { CellPosition } from '../../src/lib/core/position.js';
import { Direction } from '../../src/lib/core/direction.js';
import { pushSimple } from '../../src/lib/operations/push.js';
import { createRuleSet, RefStrategy } from '../../src/lib/operations/rules.js';
import { isPushFailure } from '../../src/lib/operations/failure.js';

describe('TestPush', () => {
  it('test_push_simple_to_empty', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Concrete('B'), Empty()]],
        rows: 1,
        cols: 3,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const rules = createRuleSet();
    const result = pushSimple(store, start, Direction.E, rules);

    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      // After push: [A, B, Empty] -> [Empty, A, B]
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][1]).toEqual(Concrete('A'));
      expect(result.main.cells[0][2]).toEqual(Concrete('B'));
    }
  });

  it('test_push_cycle_to_start', () => {
    // This test is skipped in Python (just passes)
    // Skip it here too for now
  });

  it('test_push_single_cell_at_empty', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Empty(), Concrete('A')]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    // Path: [Empty, A], push ends at A (not Empty) -> should fail
    expect(isPushFailure(result)).toBe(true);
    if (isPushFailure(result)) {
      expect(result.reason).toBe('NO_STRATEGY');
    }
  });

  it('test_push_immutability', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Concrete('B'), Empty()]],
        rows: 1,
        cols: 3,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    expect(isPushFailure(result)).toBe(false);
    // Original store should be unchanged
    expect(store.main.cells[0][0]).toEqual(Concrete('A'));
    expect(store.main.cells[0][1]).toEqual(Concrete('B'));
    expect(store.main.cells[0][2].type).toBe('empty');
  });

  it('test_push_fails_edge_no_empty', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Concrete('B'), Concrete('C')]],
        rows: 1,
        cols: 3,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    // Path: [A, B, C], hits edge at non-Empty -> should fail
    expect(isPushFailure(result)).toBe(true);
    if (isPushFailure(result)) {
      expect(result.reason).toBe('NO_STRATEGY');
    }
  });

  it('test_push_through_portal', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Ref('inner'), Empty()]],
        rows: 1,
        cols: 3,
      },
      inner: {
        id: 'inner',
        cells: [[Concrete('X'), Concrete('Y')]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      // After push: A -> X -> Y -> Empty
      // Rotation: [A, X, Y, Empty] -> [Empty, A, X, Y]
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][1]).toEqual(Ref('inner')); // Ref not pushed
      expect(result.main.cells[0][2]).toEqual(Concrete('Y'));

      // Inner grid updated
      expect(result.inner.cells[0][0]).toEqual(Concrete('A'));
      expect(result.inner.cells[0][1]).toEqual(Concrete('X'));
    }
  });

  it('test_push_blocked_ref', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Ref('locked'), Empty()]],
        rows: 1,
        cols: 3,
      },
      locked: {
        id: 'locked',
        cells: [[Concrete('SECRET')]],
        rows: 1,
        cols: 1,
      },
    };

    const start = new CellPosition('main', 0, 0);
    // Use PUSH_FIRST strategy to treat Ref as solid
    const result = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.PUSH_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      // Path: [A, Ref(locked), Empty]
      // Ref acts as solid object, gets pushed
      // Rotation: [A, Ref, Empty] -> [Empty, A, Ref]
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][1]).toEqual(Concrete('A'));
      expect(result.main.cells[0][2]).toEqual(Ref('locked'));

      // Locked grid unchanged
      expect(result.locked.cells[0][0]).toEqual(Concrete('SECRET'));
    }
  });

  it('test_push_affects_multiple_grids', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Ref('inner'), Empty()]],
        rows: 1,
        cols: 3,
      },
      inner: {
        id: 'inner',
        cells: [[Concrete('X'), Concrete('Y')]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      // Both grids should be updated
      expect(result.main).toBeDefined();
      expect(result.inner).toBeDefined();

      // Verify changes
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.inner.cells[0][0]).toEqual(Concrete('A'));
    }
  });

  it('test_push_stops_at_empty', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Concrete('B'), Empty(), Concrete('C'), Concrete('D')]],
        rows: 1,
        cols: 5,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      // After push: [A, B, Empty, C, D] -> [Empty, A, B, C, D]
      // Only the first 3 cells should be affected
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][1]).toEqual(Concrete('A'));
      expect(result.main.cells[0][2]).toEqual(Concrete('B'));
      // C and D should remain unchanged
      expect(result.main.cells[0][3]).toEqual(Concrete('C'));
      expect(result.main.cells[0][4]).toEqual(Concrete('D'));
    }
  });

  it('test_push_stops_at_empty_through_portal', () => {
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Ref('inner'), Concrete('C')]],
        rows: 1,
        cols: 3,
      },
      inner: {
        id: 'inner',
        cells: [[Concrete('X'), Empty()]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      // Path should be: [A, X, Empty]
      // After rotation: [Empty, A, X]
      // Main[0,0] should be Empty, Main[0,2] should still be C (unchanged)
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][2]).toEqual(Concrete('C')); // C unchanged
      // Inner should have [A, X]
      expect(result.inner.cells[0][0]).toEqual(Concrete('A'));
      expect(result.inner.cells[0][1]).toEqual(Concrete('X'));
    }
  });
});
