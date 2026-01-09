/**
 * Tests for ValidatingCameraController wrapper.
 */

import { describe, it, expect } from 'vitest';
import { ValidatingCameraController } from './validating-camera-controller.js';
import { ParentViewCameraController } from './parent-view-camera.js';
import { HierarchyHelper } from './hierarchy-helper.js';
import { parseGrids } from '../parser/parser.js';
import type { CameraController, ViewUpdate } from './camera-protocol.js';

describe('ValidatingCameraController', () => {
  describe('wrapping a valid controller', () => {
    it('allows valid view updates from getStandardView', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        const update = validating.getStandardView('child');
        expect(update.targetView).toEqual(['root', 'child']);
      }).not.toThrow();
    });

    it('allows valid view updates from onPlayerEnter', () => {
      const store = parseGrids({
        root: 'child _',
        child: 'grandchild _',
        grandchild: '1 2',
      });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        const update = validating.onPlayerEnter('child', 'grandchild', false);
        expect(update.targetView).toBeDefined();
      }).not.toThrow();
    });

    it('allows valid view updates from onPlayerExit', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        const update = validating.onPlayerExit('child', 'root');
        expect(update.targetView).toBeDefined();
      }).not.toThrow();
    });

    it('allows valid view updates from onPlayerMove', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        const update = validating.onPlayerMove('child');
        expect(update.targetView).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('catching invalid view updates', () => {
    // Create a mock controller that returns invalid view updates
    class InvalidController implements CameraController {
      getStandardView(_playerGridId: string): ViewUpdate {
        return { targetView: ['nonexistent'] };
      }

      onPlayerEnter(_fromGridId: string, _toGridId: string, _viaNonPrimaryReference: boolean): ViewUpdate {
        return { targetView: ['invalid', 'path'] };
      }

      onPlayerExit(_fromGridId: string, _toGridId: string): ViewUpdate {
        return {
          targetView: ['root'],
          animationStartView: ['missing'],
        };
      }

      onPlayerMove(_gridId: string): ViewUpdate {
        return { targetView: [] }; // Empty path is invalid
      }
    }

    it('throws on invalid view from getStandardView', () => {
      const store = parseGrids({ root: '1 2' });
      const controller = new InvalidController();
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        validating.getStandardView('root');
      }).toThrow("Grid 'nonexistent' does not exist");
    });

    it('throws on invalid view from onPlayerEnter', () => {
      const store = parseGrids({ root: '1 2' });
      const controller = new InvalidController();
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        validating.onPlayerEnter('root', 'root', false);
      }).toThrow("Grid 'invalid' does not exist");
    });

    it('throws on invalid animationStartView from onPlayerExit', () => {
      const store = parseGrids({ root: '1 2' });
      const controller = new InvalidController();
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        validating.onPlayerExit('root', 'root');
      }).toThrow('Invalid animationStartView');
    });

    it('throws on empty path from onPlayerMove', () => {
      const store = parseGrids({ root: '1 2' });
      const controller = new InvalidController();
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        validating.onPlayerMove('root');
      }).toThrow('View path is empty');
    });

    it('includes controller name in error message', () => {
      const store = parseGrids({ root: '1 2' });
      const controller = new InvalidController();
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        validating.getStandardView('root');
      }).toThrow('InvalidController.getStandardView');
    });
  });

  describe('store management', () => {
    it('allows updating the store reference', () => {
      const store1 = parseGrids({ root: 'child _', child: '1 2' });
      const store2 = parseGrids({ root: 'other _', other: '3 4' });

      const helper = new HierarchyHelper(store1);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store1);

      // Works with store1
      expect(() => {
        validating.getStandardView('child');
      }).not.toThrow();

      // Update store and helper
      helper.setStore(store2);
      validating.setStore(store2);

      // Now works with store2
      expect(() => {
        validating.getStandardView('other');
      }).not.toThrow();
    });

    it('exposes current store via getStore', () => {
      const store = parseGrids({ root: '1 2' });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      expect(validating.getStore()).toBe(store);
    });
  });

  describe('delegation behavior', () => {
    it('preserves all properties from wrapped controller', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      const directUpdate = controller.getStandardView('child');
      const wrappedUpdate = validating.getStandardView('child');

      // Should return identical results
      expect(wrappedUpdate.targetView).toEqual(directUpdate.targetView);
      expect(wrappedUpdate.animationStartView).toEqual(directUpdate.animationStartView);
      expect(wrappedUpdate.trackObjectAnimations).toEqual(directUpdate.trackObjectAnimations);
    });
  });

  describe('validation with complex hierarchies', () => {
    it('validates multi-level nesting', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: 'c _',
        c: '1 2',
      });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        const update = validating.getStandardView('c');
        expect(update.targetView.length).toBeGreaterThan(0);
      }).not.toThrow();
    });

    it('validates self-referencing grids', () => {
      const store = parseGrids({
        main: '*inner _ _',
        inner: '~main 1 2',
      });
      const helper = new HierarchyHelper(store);
      const controller = new ParentViewCameraController(helper);
      const validating = new ValidatingCameraController(controller, store);

      expect(() => {
        validating.getStandardView('inner');
      }).not.toThrow();
    });
  });
});
