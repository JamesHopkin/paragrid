/**
 * Tests for camera helpers (hierarchy and scale).
 */

import { describe, it, expect } from 'vitest';
import {
  HierarchyHelper,
  getScaleAndOffset,
} from './index.js';
import { parseGrids } from '../parser/parser.js';

describe('Hierarchy Helper', () => {
  describe('getParent', () => {
    it('returns null for root grid (no parent)', () => {
      const store = parseGrids({
        root: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getParent('root')).toBe(null);
    });

    it('returns parent grid ID for child grid', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getParent('child')).toBe('root');
    });

    it('handles multiple levels of nesting', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getParent('b')).toBe('a');
      expect(helper.getParent('a')).toBe('root');
      expect(helper.getParent('root')).toBe(null);
    });
  });

  describe('getDirectlyContainedReferences', () => {
    it('returns empty array for grid with no references', () => {
      const store = parseGrids({
        main: '1 2|3 4',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getDirectlyContainedReferences('main')).toEqual([]);
    });

    it('returns single reference', () => {
      const store = parseGrids({
        main: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getDirectlyContainedReferences('main')).toEqual(['child']);
    });

    it('returns multiple unique references in order', () => {
      const store = parseGrids({
        main: 'a b|c _',
        a: '1 2',
        b: '3 4',
        c: '5 6',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getDirectlyContainedReferences('main')).toEqual(['a', 'b', 'c']);
    });

    it('deduplicates repeated references', () => {
      const store = parseGrids({
        main: 'a b a',
        a: '1 2',
        b: '3 4',
      });
      const helper = new HierarchyHelper(store);

      // 'a' appears twice but should only be listed once
      expect(helper.getDirectlyContainedReferences('main')).toEqual(['a', 'b']);
    });

    it('returns empty array for non-existent grid', () => {
      const store = parseGrids({
        main: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getDirectlyContainedReferences('nonexistent')).toEqual([]);
    });
  });

  describe('findDirectlyContainedReference', () => {
    it('returns true when reference exists', () => {
      const store = parseGrids({
        parent: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.findDirectlyContainedReference('parent', 'child')).toBe(true);
    });

    it('returns false when reference does not exist', () => {
      const store = parseGrids({
        parent: '1 2',
        child: '3 4',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.findDirectlyContainedReference('parent', 'child')).toBe(false);
    });
  });

  describe('getPathToAncestor', () => {
    it('returns path for simple parent-child relationship', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getPathToAncestor('child', 'root')).toEqual(['child', 'root']);
    });

    it('returns path through multiple levels', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: 'c _',
        c: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getPathToAncestor('c', 'root')).toEqual(['c', 'b', 'a', 'root']);
      expect(helper.getPathToAncestor('c', 'a')).toEqual(['c', 'b', 'a']);
      expect(helper.getPathToAncestor('b', 'root')).toEqual(['b', 'a', 'root']);
    });

    it('returns single-element path when grid is its own ancestor', () => {
      const store = parseGrids({
        root: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getPathToAncestor('root', 'root')).toEqual(['root']);
    });

    it('returns null when target is not an ancestor', () => {
      const store = parseGrids({
        root: '*a _',
        a: '~b _',
        b: '1 2',
      });
      const helper = new HierarchyHelper(store);

      // root is not an ancestor of a (a is child of root)
      expect(helper.getPathToAncestor('root', 'a')).toBe(null);
      // a is not an ancestor of b (b is child of a)
      expect(helper.getPathToAncestor('a', 'b')).toBe(null);
    });

    it('returns path when target is parent even in cycle', () => {
      const store = parseGrids({
        a: '*b _',
        b: '~a _',
      });
      const helper = new HierarchyHelper(store);

      // a's parent is b, so b is an ancestor of a (path exists)
      expect(helper.getPathToAncestor('a', 'b')).toEqual(['a', 'b']);

      // But if we try to go beyond the target, cycle detection kicks in
      // (This is tested by getAncestorChain which continues to root)
    });
  });

  describe('getAncestorChain', () => {
    it('returns single-element array for root grid', () => {
      const store = parseGrids({
        root: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getAncestorChain('root')).toEqual(['root']);
    });

    it('returns chain for nested grids', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: 'c _',
        c: '1 2',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getAncestorChain('c')).toEqual(['c', 'b', 'a', 'root']);
      expect(helper.getAncestorChain('b')).toEqual(['b', 'a', 'root']);
      expect(helper.getAncestorChain('a')).toEqual(['a', 'root']);
    });

    it('returns null when cycle detected', () => {
      const store = parseGrids({
        a: '*b _',
        b: '~a _',
      });
      const helper = new HierarchyHelper(store);

      expect(helper.getAncestorChain('a')).toBe(null);
      expect(helper.getAncestorChain('b')).toBe(null);
    });
  });
});

describe('Scale Helper', () => {
  describe('getScaleAndOffset', () => {
    it('returns null for empty path', () => {
      const store = parseGrids({ root: '1 2' });
      expect(getScaleAndOffset(store, [])).toBe(null);
    });

    it('returns dimensions and center for single grid', () => {
      const store = parseGrids({
        root: '1 2|3 4', // 2x2 grid
      });

      const result = getScaleAndOffset(store, ['root']);
      expect(result).not.toBe(null);
      expect(result!.centerX).toBe(1); // cols / 2 = 2 / 2 = 1
      expect(result!.centerY).toBe(1); // rows / 2 = 2 / 2 = 1
      expect(result!.width).toBe(2);
      expect(result!.height).toBe(2);
    });

    it('calculates scale for nested grid', () => {
      const store = parseGrids({
        root: 'child _|_ _', // 2x2 grid
        child: '1 2', // 2x1 grid (2 cols, 1 row)
      });

      const result = getScaleAndOffset(store, ['root', 'child']);
      expect(result).not.toBe(null);

      // Child occupies top-left cell of root
      // Cell width in root = 2/2 = 1, cell height = 2/2 = 1
      // Child ref is at (0, 0), cell center = (0.5, 0.5)
      // Root grid center at (1, 1), so child cell center is at (0.5, 0.5)
      expect(result!.centerX).toBe(0.5);
      expect(result!.centerY).toBe(0.5);
      expect(result!.width).toBe(1); // Child fills one cell
      expect(result!.height).toBe(1);
    });

    it('handles multi-level nesting', () => {
      const store = parseGrids({
        root: 'a _|_ _', // 2x2, cell size 1x1
        a: 'b _', // 2x1, occupies one cell (0,0) in root, cell size 0.5x1
        b: '1 2', // 2x1, occupies first cell (0,0) in a
      });

      const result = getScaleAndOffset(store, ['root', 'a', 'b']);
      expect(result).not.toBe(null);

      // a is at (0,0) in root, center at (0.5, 0.5)
      // b is at (0,0) in a, which has cell width 0.5
      // b's center relative to a's top-left: (0.25, 0.5)
      // a's top-left in root coords: (0, 0)
      // b's center in root coords: (0.25, 0.5)
      expect(result!.centerX).toBeCloseTo(0.25);
      expect(result!.centerY).toBeCloseTo(0.5);
      expect(result!.width).toBeCloseTo(0.5);
      expect(result!.height).toBeCloseTo(1);
    });

    it('returns null for invalid path (child not in parent)', () => {
      const store = parseGrids({
        root: '1 2',
        orphan: '3 4',
      });

      expect(getScaleAndOffset(store, ['root', 'orphan'])).toBe(null);
    });

    it('returns null for non-existent grid', () => {
      const store = parseGrids({
        root: '1 2',
      });

      expect(getScaleAndOffset(store, ['root', 'missing'])).toBe(null);
    });
  });
});
