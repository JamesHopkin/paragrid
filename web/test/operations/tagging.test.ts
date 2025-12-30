/**
 * Tests for cell tagging functionality.
 */

import { describe, it, expect } from 'vitest';
import { parseGrids } from '../../src/lib/parser/parser.js';
import { push } from '../../src/lib/operations/push.js';
import { Direction } from '../../src/lib/core/direction.js';
import { CellPosition } from '../../src/lib/core/position.js';
import { createRuleSet } from '../../src/lib/operations/rules.js';
import { isPushFailure } from '../../src/lib/operations/failure.js';
import { isConcrete, type Cell } from '../../src/lib/core/types.js';
import type { TagFn } from '../../src/lib/tagging/types.js';

describe('TestTagging', () => {
  it('test_stop_tag_in_referenced_grid_during_push', () => {
    /**
     * Test that stop tag is respected when pushing through reference chain.
     *
     * Bug reproduction: When pushing through a Ref into a referenced grid,
     * cells with 'stop' tag inside the referenced grid should prevent the push,
     * but they are currently being moved.
     */
    // Setup: main: [1, Ref(inner)]
    //        inner: [9, _]
    // Tag function: '9' has stop tag
    // Push from (0,0) eastward should fail (can't push the stop-tagged cell)

    const store = parseGrids({
      main: '1 inner',
      inner: '9 _',
    });

    const tagFn: TagFn = (cell: Cell) => {
      // Tag cells containing '9' with stop
      if (isConcrete(cell) && cell.id.includes('9')) {
        return new Set(['stop']);
      }
      return new Set();
    };

    const start = new CellPosition('main', 0, 0);
    const result = push(store, start, Direction.E, createRuleSet(), tagFn);

    // The push should fail because the '9' cell has a stop tag
    expect(isPushFailure(result)).toBe(true);
    if (isPushFailure(result)) {
      expect(result.reason).toBe('STOP_TAG');
    }
  });

  it('test_stop_tagged_cell_cannot_push_itself', () => {
    /**
     * Test that a cell with stop tag cannot initiate a push.
     *
     * Bug reproduction: When pushing FROM a stop-tagged cell, the push succeeds
     * and the stop-tagged cell moves. However, stop-tagged cells should be immovable
     * and unable to participate in any push operation, including initiating one.
     *
     * Grid layout:
     * main: [Ref(inner), 9]
     *       [Ref(main),  _]
     * inner: [9]
     *
     * The '9' cells have stop tags.
     * Push east from (0,1) [the stop-tagged '9'] should fail immediately.
     * Currently the push succeeds and the '9' moves.
     */
    const store = parseGrids({
      main: 'inner 9|main _',
      inner: '9',
    });

    const tagFn: TagFn = (cell: Cell) => {
      // Tag cells containing '9' with stop
      if (isConcrete(cell) && cell.id.includes('9')) {
        return new Set(['stop']);
      }
      return new Set();
    };

    // Push FROM the stop-tagged '9' at (0,1)
    const start = new CellPosition('main', 0, 1);
    const result = push(store, start, Direction.E, createRuleSet(), tagFn);

    // The push should fail because the starting cell has a stop tag
    expect(isPushFailure(result)).toBe(true);
    if (isPushFailure(result)) {
      expect(result.reason).toBe('STOP_TAG');
      expect(result.position.equals(start)).toBe(true);
    }
  });
});
