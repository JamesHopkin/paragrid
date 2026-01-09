/**
 * Tests for view validator.
 */

import { describe, it, expect } from 'vitest';
import {
  validateViewPath,
  validateViewUpdate,
  assertValidViewPath,
  assertValidViewUpdate,
} from './view-validator.js';
import { parseGrids } from '../parser/parser.js';
import type { ViewUpdate } from './camera-protocol.js';

describe('View Validator', () => {
  describe('validateViewPath', () => {
    it('rejects empty path', () => {
      const store = parseGrids({ root: '1 2' });
      const result = validateViewPath(store, []);

      expect(result.valid).toBe(false);
      expect(result.error?.message).toBe('View path is empty');
    });

    it('accepts valid single-grid path', () => {
      const store = parseGrids({ root: '1 2' });
      const result = validateViewPath(store, ['root']);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts valid nested path', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const result = validateViewPath(store, ['root', 'child']);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts valid multi-level path', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: 'c _',
        c: '1 2',
      });
      const result = validateViewPath(store, ['root', 'a', 'b', 'c']);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects path with non-existent grid', () => {
      const store = parseGrids({ root: '1 2' });
      const result = validateViewPath(store, ['root', 'missing']);

      expect(result.valid).toBe(false);
      expect(result.error?.message).toBe("Grid 'missing' does not exist");
      expect(result.error?.gridId).toBe('missing');
      expect(result.error?.pathIndex).toBe(1);
    });

    it('rejects path with invalid parent-child relationship', () => {
      const store = parseGrids({
        root: '1 2',
        orphan: '3 4',
      });
      const result = validateViewPath(store, ['root', 'orphan']);

      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('not referenced by any parent');
      expect(result.error?.gridId).toBe('orphan');
      expect(result.error?.pathIndex).toBe(1);
    });

    it('rejects path with wrong parent', () => {
      const store = parseGrids({
        root: 'child1 child2',
        child1: '1 2',
        child2: '3 4',
      });
      // Try to claim child2 is a child of child1 (it's actually a sibling)
      const result = validateViewPath(store, ['root', 'child1', 'child2']);

      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('not a child of');
      expect(result.error?.gridId).toBe('child2');
      expect(result.error?.pathIndex).toBe(2);
    });

    it('handles self-referencing grids', () => {
      const store = parseGrids({
        main: '*inner _ _',
        inner: '~main 1 2',
      });

      // Valid path: main -> inner
      expect(validateViewPath(store, ['main', 'inner']).valid).toBe(true);

      // Valid path: main -> inner -> main (cycle)
      expect(validateViewPath(store, ['main', 'inner', 'main']).valid).toBe(true);
    });
  });

  describe('validateViewUpdate', () => {
    it('accepts valid update with only targetView', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const update: ViewUpdate = {
        targetView: ['root', 'child'],
      };
      const result = validateViewUpdate(store, update);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts valid update with animationStartView', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const update: ViewUpdate = {
        targetView: ['root', 'child'],
        animationStartView: ['root'],
      };
      const result = validateViewUpdate(store, update);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts valid update with trackObjectAnimations', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const update: ViewUpdate = {
        targetView: ['root', 'child'],
        trackObjectAnimations: true,
      };
      const result = validateViewUpdate(store, update);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects update with invalid targetView', () => {
      const store = parseGrids({ root: '1 2' });
      const update: ViewUpdate = {
        targetView: ['root', 'missing'],
      };
      const result = validateViewUpdate(store, update);

      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('Invalid targetView');
      expect(result.error?.message).toContain('missing');
    });

    it('rejects update with invalid animationStartView', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const update: ViewUpdate = {
        targetView: ['root', 'child'],
        animationStartView: ['root', 'missing'],
      };
      const result = validateViewUpdate(store, update);

      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('Invalid animationStartView');
      expect(result.error?.message).toContain('missing');
    });

    it('includes context in error message', () => {
      const store = parseGrids({ root: '1 2' });
      const update: ViewUpdate = {
        targetView: ['missing'],
      };
      const result = validateViewUpdate(store, update, 'onPlayerEnter');

      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('onPlayerEnter:');
    });
  });

  describe('assertValidViewPath', () => {
    it('does not throw for valid path', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });

      expect(() => {
        assertValidViewPath(store, ['root', 'child']);
      }).not.toThrow();
    });

    it('throws for invalid path', () => {
      const store = parseGrids({ root: '1 2' });

      expect(() => {
        assertValidViewPath(store, ['root', 'missing']);
      }).toThrow("Grid 'missing' does not exist");
    });

    it('includes context in error message', () => {
      const store = parseGrids({ root: '1 2' });

      expect(() => {
        assertValidViewPath(store, ['missing'], 'MyController.getView');
      }).toThrow('MyController.getView:');
    });
  });

  describe('assertValidViewUpdate', () => {
    it('does not throw for valid update', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const update: ViewUpdate = {
        targetView: ['root', 'child'],
        animationStartView: ['root'],
      };

      expect(() => {
        assertValidViewUpdate(store, update);
      }).not.toThrow();
    });

    it('throws for invalid update', () => {
      const store = parseGrids({ root: '1 2' });
      const update: ViewUpdate = {
        targetView: ['root', 'missing'],
      };

      expect(() => {
        assertValidViewUpdate(store, update);
      }).toThrow('Invalid targetView');
    });

    it('includes context in error message', () => {
      const store = parseGrids({ root: '1 2' });
      const update: ViewUpdate = {
        targetView: ['missing'],
      };

      expect(() => {
        assertValidViewUpdate(store, update, 'onPlayerMove');
      }).toThrow('onPlayerMove:');
    });
  });

  describe('edge cases', () => {
    it('handles grids with similar names', () => {
      const store = parseGrids({
        main: 'child _',
        child: 'childish _',
        childish: '1 2',
      });

      // Valid: main -> child
      expect(validateViewPath(store, ['main', 'child']).valid).toBe(true);

      // Valid: main -> child -> childish
      expect(validateViewPath(store, ['main', 'child', 'childish']).valid).toBe(true);

      // Invalid: main -> childish (childish is not a direct child of main)
      const result = validateViewPath(store, ['main', 'childish']);
      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('not a child of');
    });

    it('validates all grids in path exist before checking relationships', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });

      // Should report the non-existent grid first, not relationship issues
      const result = validateViewPath(store, ['root', 'missing', 'another']);
      expect(result.valid).toBe(false);
      expect(result.error?.message).toBe("Grid 'missing' does not exist");
      expect(result.error?.pathIndex).toBe(1);
    });
  });
});
