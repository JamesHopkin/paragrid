/**
 * Tests for push operation with backtracking.
 */

import { describe, it, expect } from 'vitest';
import { Concrete, Empty, Ref, type GridStore, type Cell } from '../../src/lib/core/types.js';
import { CellPosition } from '../../src/lib/core/position.js';
import { Direction } from '../../src/lib/core/direction.js';
import { push, pushSimple } from '../../src/lib/operations/push.js';
import { createRuleSet, RefStrategy } from '../../src/lib/operations/rules.js';
import { isPushFailure } from '../../src/lib/operations/failure.js';

describe('TestPushBacktracking', () => {
  it('test_backtrack_on_stop_inside_ref', () => {
    // Setup: [A, Ref(inner), Empty]
    //        inner: [X, STOP]
    // Push from A eastward.
    // Simple: fails (hits STOP inside inner)
    // Backtracking: succeeds by treating Ref as solid
    // Result: [Empty, A, Ref(inner)]

    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Ref('inner'), Empty()]],
        rows: 1,
        cols: 3,
      },
      inner: {
        id: 'inner',
        cells: [[Concrete('X'), Concrete('STOP')]],
        rows: 1,
        cols: 2,
      },
    };

    function tagStop(cell: Cell): Set<string> {
      // Tag STOP concrete cells with 'stop' tag
      if (cell.type === 'concrete' && cell.id === 'STOP') {
        return new Set(['stop']);
      }
      return new Set();
    }

    const start = new CellPosition('main', 0, 0);

    // Simple version with TRY_ENTER_FIRST should fail (enters Ref, hits STOP)
    const resultSimple = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST),
      tagStop
    );
    expect(isPushFailure(resultSimple)).toBe(true);
    if (isPushFailure(resultSimple)) {
      expect(resultSimple.reason).toBe('STOP_TAG');
    }

    // Backtracking version should succeed (tries portal, fails, backtracks to solid)
    const result = push(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST),
      tagStop
    );
    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Result: [Empty, A, Ref(inner)]
      expect(result.store.main.cells[0][0].type).toBe('empty');
      expect(result.store.main.cells[0][1]).toEqual(Concrete('A'));
      expect(result.store.main.cells[0][2]).toEqual(Ref('inner'));

      // Inner grid should be unchanged (Ref treated as solid, not entered)
      expect(result.store.inner.cells[0][0]).toEqual(Concrete('X'));
      expect(result.store.inner.cells[0][1]).toEqual(Concrete('STOP'));
    }
  });

  it('test_no_backtrack_when_simple_succeeds', () => {
    // Test that backtracking doesn't trigger when portal path succeeds
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

    // Both versions should succeed with same result
    const resultSimple = pushSimple(store, start, Direction.E, createRuleSet());
    const resultBacktrack = push(store, start, Direction.E, createRuleSet());

    expect(isPushFailure(resultSimple)).toBe(false);
    expect(isPushFailure(resultBacktrack)).toBe(false);

    if (!isPushFailure(resultSimple) && !isPushFailure(resultBacktrack)) {
      // Results should be identical
      expect(resultSimple.store.main.cells).toEqual(resultBacktrack.store.main.cells);
      expect(resultSimple.store.inner.cells).toEqual(resultBacktrack.store.inner.cells);
    }
  });

  it('test_backtrack_multiple_levels', () => {
    // Test backtracking through multiple nested Refs
    // Setup: [A, Ref1(B), Empty]
    //        B: [X, STOP]  (STOP is reached by moving, not entering)
    // Expected:
    // 1. Enter Ref1, arrive at X, move to STOP, fail
    // 2. Backtrack: treat Ref1 as solid -> succeeds

    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Concrete('A'), Ref('B'), Empty()]],
        rows: 1,
        cols: 3,
      },
      B: {
        id: 'B',
        cells: [[Concrete('X'), Concrete('STOP')]],
        rows: 1,
        cols: 2,
      },
    };

    function tagStop(cell: Cell): Set<string> {
      if (cell.type === 'concrete' && cell.id === 'STOP') {
        return new Set(['stop']);
      }
      return new Set();
    }

    const start = new CellPosition('main', 0, 0);

    // Simple version with TRY_ENTER_FIRST should fail (enters B, hits STOP after X)
    const resultSimple = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST),
      tagStop
    );
    expect(isPushFailure(resultSimple)).toBe(true);
    if (isPushFailure(resultSimple)) {
      expect(resultSimple.reason).toBe('STOP_TAG');
    }

    // Backtracking version should succeed by treating Ref1 as solid
    const result = push(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST),
      tagStop
    );
    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Result: [Empty, A, Ref(B)]
      expect(result.store.main.cells[0][0].type).toBe('empty');
      expect(result.store.main.cells[0][1]).toEqual(Concrete('A'));
      expect(result.store.main.cells[0][2]).toEqual(Ref('B'));
    }
  });
});
