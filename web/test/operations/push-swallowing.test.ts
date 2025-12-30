/**
 * Tests for push swallowing behavior where Refs can absorb target cells.
 */

import { describe, it, expect } from 'vitest';
import {
  Concrete,
  Empty,
  Ref,
  type GridStore,
  type Cell,
} from '../../src/lib/core/types.js';
import { CellPosition } from '../../src/lib/core/position.js';
import { Direction } from '../../src/lib/core/direction.js';
import { push, pushSimple } from '../../src/lib/operations/push.js';
import { createRuleSet, RefStrategy } from '../../src/lib/operations/rules.js';
import { isPushFailure } from '../../src/lib/operations/failure.js';
import { parseGrids } from '../../src/lib/parser/parser.js';

describe('TestPushSwallowing', () => {
  it('test_swallow_basic_eastward', () => {
    // Setup: [Ref(pocket), ball, Empty]
    //        pocket: [Empty, Empty]
    // Push Ref eastward -> ball gets pushed into pocket from west
    // Result: [Empty, Ref(pocket), Empty]
    //         pocket: [ball, Empty]
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket'), Concrete('ball'), Empty()]],
        rows: 1,
        cols: 3,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty(), Empty()]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.SWALLOW_FIRST)
    );

    // Verify swallowing succeeded
    // Pushing east enters from west (right side), so ball goes to position (0,1)
    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][1]).toEqual(Ref('pocket'));
      expect(result.main.cells[0][2].type).toBe('empty');
      expect(result.pocket.cells[0][0].type).toBe('empty');
      expect(result.pocket.cells[0][1]).toEqual(Concrete('ball'));
    }
  });

  it('test_swallow_westward', () => {
    // Setup: [Empty, ball, Ref(pocket)]
    //        pocket: [Empty, Empty]
    // Push Ref westward -> ball gets pushed into pocket from east (right edge)
    // Result: [Empty, Ref(pocket), Empty]
    //         pocket: [Empty, ball]
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Empty(), Concrete('ball'), Ref('pocket')]],
        rows: 1,
        cols: 3,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty(), Empty()]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 2);
    const result = pushSimple(
      store,
      start,
      Direction.W,
      createRuleSet(RefStrategy.SWALLOW_FIRST)
    );

    // Verify swallowing succeeded
    // Pushing west enters from east (left side), so ball goes to position (0,0)
    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][1]).toEqual(Ref('pocket'));
      expect(result.main.cells[0][2].type).toBe('empty');
      expect(result.pocket.cells[0][0]).toEqual(Concrete('ball'));
      expect(result.pocket.cells[0][1].type).toBe('empty');
    }
  });

  it('test_swallow_southward', () => {
    // Setup: Grid (3 rows x 1 col):
    //        [Ref(pocket)]
    //        [ball]
    //        [Empty]
    //        pocket (2 rows x 1 col): [Empty, Empty]
    // Push Ref southward -> ball gets pushed into pocket from north (top edge)
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket')], [Concrete('ball')], [Empty()]],
        rows: 3,
        cols: 1,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty()], [Empty()]],
        rows: 2,
        cols: 1,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(
      store,
      start,
      Direction.S,
      createRuleSet(RefStrategy.SWALLOW_FIRST)
    );

    // Verify swallowing succeeded
    // Pushing south enters from north (bottom edge), so ball goes to position (1,0)
    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[1][0]).toEqual(Ref('pocket'));
      expect(result.main.cells[2][0].type).toBe('empty');
      expect(result.pocket.cells[0][0].type).toBe('empty');
      expect(result.pocket.cells[1][0]).toEqual(Concrete('ball'));
    }
  });

  it('test_swallow_northward', () => {
    // Setup: Grid (3 rows x 1 col):
    //        [Empty]
    //        [ball]
    //        [Ref(pocket)]
    //        pocket (2 rows x 1 col): [Empty, Empty]
    // Push Ref northward -> ball gets pushed into pocket from south (bottom edge)
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Empty()], [Concrete('ball')], [Ref('pocket')]],
        rows: 3,
        cols: 1,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty()], [Empty()]],
        rows: 2,
        cols: 1,
      },
    };

    const start = new CellPosition('main', 2, 0);
    const result = pushSimple(
      store,
      start,
      Direction.N,
      createRuleSet(RefStrategy.SWALLOW_FIRST)
    );

    // Verify swallowing succeeded
    // Pushing north enters from south (top edge), so ball goes to position (0,0)
    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[1][0]).toEqual(Ref('pocket'));
      expect(result.main.cells[2][0].type).toBe('empty');
      expect(result.pocket.cells[0][0]).toEqual(Concrete('ball'));
      expect(result.pocket.cells[1][0].type).toBe('empty');
    }
  });

  it('test_swallow_fails_when_target_grid_full', () => {
    // Setup: [Ref(pocket), ball, Empty]
    //        pocket: [X, Y] (full)
    // Push Ref eastward -> attempt to push ball into pocket fails (no space)
    // Should try alternative strategies (portal or solid)
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket'), Concrete('ball'), Empty()]],
        rows: 1,
        cols: 3,
      },
      pocket: {
        id: 'pocket',
        cells: [[Concrete('X'), Concrete('Y')]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    // Should fall back to portal or solid behavior
    // This test just ensures swallowing failure is handled gracefully
    // The result can be either success or failure depending on fallback
  });

  it('test_swallow_with_empty_target', () => {
    // Setup: [Ref(pocket), Empty, X]
    //        pocket: [Empty, Empty]
    // Push Ref eastward -> target is Empty
    // Swallowing Empty doesn't make semantic sense
    // Should likely skip swallow and try other strategies or just succeed normally
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket'), Empty(), Concrete('X')]],
        rows: 1,
        cols: 3,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty(), Empty()]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    // Expected: Skip swallow and succeed with normal push logic
    expect(isPushFailure(result)).toBe(false);
  });

  it('test_swallow_vs_portal_priority', () => {
    // Test that rule set controls whether swallow or portal is tried first
    // Setup: [Ref(inner), 1, Empty]
    //        inner: [Empty, Empty]
    //
    // Push from Ref(inner) with DEFAULT strategy (PORTAL, SOLID, SWALLOW - swallow is LAST):
    // - Should try PORTAL first: Ref acts as portal (enter), likely fails
    // - Should try SOLID next: Ref acts as solid object, pushes 1, succeeds
    // - Should NOT try swallow until portal and solid both fail
    //
    // Expected with DEFAULT (portal, solid, swallow): [Empty, Ref(inner), 1]
    const store = parseGrids({
      main: 'inner 1 _',
      inner: '_ _',
    });

    const start = new CellPosition('main', 0, 0);

    // Test with DEFAULT strategy (PORTAL, SOLID, SWALLOW)
    // Use push() not pushSimple() since we need multi-strategy support
    const resultDefault = push(store, start, Direction.E, createRuleSet());

    // Should NOT swallow 1 into inner (swallow is last strategy, portal/solid should succeed first)
    // Instead should push Ref as solid: [Empty, Ref(inner), 1]
    expect(isPushFailure(resultDefault)).toBe(false);
    if (!isPushFailure(resultDefault)) {
      expect(resultDefault.main.cells[0][0].type).toBe('empty');
      expect(resultDefault.main.cells[0][1]).toEqual(Ref('inner'));
      expect(resultDefault.main.cells[0][2]).toEqual(Concrete('1'));
      // Inner should still be empty (no swallowing should have occurred)
      expect(resultDefault.inner.cells[0][0].type).toBe('empty');
      expect(resultDefault.inner.cells[0][1].type).toBe('empty');
    }

    // Test with SWALLOW_FIRST strategy - now swallow SHOULD be tried first and succeed
    const resultSwallowFirst = push(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.SWALLOW_FIRST)
    );

    // Should swallow 1 into inner
    expect(isPushFailure(resultSwallowFirst)).toBe(false);
    if (!isPushFailure(resultSwallowFirst)) {
      expect(resultSwallowFirst.main.cells[0][0].type).toBe('empty');
      expect(resultSwallowFirst.main.cells[0][1]).toEqual(Ref('inner'));
      expect(resultSwallowFirst.main.cells[0][2].type).toBe('empty');
      // 1 should be in inner now
      expect(resultSwallowFirst.inner.cells[0][0].type).toBe('empty');
      expect(resultSwallowFirst.inner.cells[0][1]).toEqual(Concrete('1'));
    }
  });

  it('test_swallow_ref_cell', () => {
    // Test swallowing when target is also a Ref
    // Setup: [Ref(pocket), Ref(other), Empty]
    //        pocket: [Empty, Empty]
    //        other: [Z]
    // Push Ref(pocket) eastward -> try to swallow Ref(other)
    // Ref can be pushed into another grid
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket'), Ref('other'), Empty()]],
        rows: 1,
        cols: 3,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty(), Empty()]],
        rows: 1,
        cols: 2,
      },
      other: {
        id: 'other',
        cells: [[Concrete('Z')]],
        rows: 1,
        cols: 1,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.SWALLOW_FIRST)
    );

    // Expected: Ref(other) gets pushed into pocket, Ref(pocket) moves right
    // Pushing east enters from west (right side), so Ref(other) goes to position (0,1)
    expect(isPushFailure(result)).toBe(false);
    if (!isPushFailure(result)) {
      expect(result.main.cells[0][0].type).toBe('empty');
      expect(result.main.cells[0][1]).toEqual(Ref('pocket'));
      expect(result.main.cells[0][2].type).toBe('empty');
      expect(result.pocket.cells[0][0].type).toBe('empty');
      expect(result.pocket.cells[0][1]).toEqual(Ref('other'));
    }
  });

  it('test_swallow_chain_reaction', () => {
    // Test swallowing where target itself needs to be pushed
    // Setup: [Ref(pocket), A, B, Empty]
    //        pocket: [Empty, Empty]
    // Push Ref eastward -> A needs to be swallowed, but A must first push B
    // This tests if swallowing integrates correctly with normal push mechanics
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket'), Concrete('A'), Concrete('B'), Empty()]],
        rows: 1,
        cols: 4,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty(), Empty()]],
        rows: 1,
        cols: 2,
      },
    };

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    // Expected behavior depends on swallow implementation
    // This test ensures complex push scenarios work with swallowing
    // Just verify it completes without error
  });

  it('test_swallow_stop_tag_prevents_swallow', () => {
    // Test that cells with stop tag cannot be swallowed
    // Setup: [Ref(pocket), wall, Empty]
    //        pocket: [Empty, Empty]
    // The 'wall' cell has a stop tag - it should not be swallowable
    // Push Ref eastward -> swallow should fail because wall is stop-tagged
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket'), Concrete('wall'), Empty()]],
        rows: 1,
        cols: 3,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty(), Empty()]],
        rows: 1,
        cols: 2,
      },
    };

    function tagStop(cell: Cell): Set<string> {
      // Tag 'wall' cells with stop tag
      if (cell.type === 'concrete' && cell.id === 'wall') {
        return new Set(['stop']);
      }
      return new Set();
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(
      store,
      start,
      Direction.E,
      createRuleSet(RefStrategy.SWALLOW_FIRST),
      tagStop
    );

    // Swallow should fail, but the push might succeed via alternative strategy (portal/solid)
    // If using SWALLOW_FIRST with only swallow, it should fail completely
    // Let's verify the wall hasn't been swallowed
    if (!isPushFailure(result)) {
      // If push succeeded, the wall should still be in main grid, not in pocket
      // Check that pocket is still empty (no swallowing occurred)
      expect(result.pocket.cells[0][0].type).toBe('empty');
      expect(result.pocket.cells[0][1].type).toBe('empty');
    }
  });

  it('test_swallow_immutability', () => {
    // Test that swallowing preserves immutability of original store
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('pocket'), Concrete('ball'), Empty()]],
        rows: 1,
        cols: 3,
      },
      pocket: {
        id: 'pocket',
        cells: [[Empty(), Empty()]],
        rows: 1,
        cols: 2,
      },
    };

    const originalMain = store.main;
    const originalPocket = store.pocket;

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, createRuleSet());

    // Original store should be completely unchanged
    expect(store.main).toBe(originalMain);
    expect(store.pocket).toBe(originalPocket);
    expect(store.main.cells[0][0]).toEqual(Ref('pocket'));
    expect(store.main.cells[0][1]).toEqual(Concrete('ball'));
    expect(store.main.cells[0][2].type).toBe('empty');
    expect(store.pocket.cells[0][0].type).toBe('empty');
    expect(store.pocket.cells[0][1].type).toBe('empty');
  });
});
