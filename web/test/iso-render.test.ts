/**
 * Simple test to verify iso-render library is available and working
 */

import { describe, it, expect } from 'vitest';
import { SceneBuilder, Camera, cube, rectangle, project } from 'iso-render';

describe('iso-render library', () => {
  it('should import basic types and functions', () => {
    expect(SceneBuilder).toBeDefined();
    expect(Camera).toBeDefined();
    expect(cube).toBeDefined();
    expect(rectangle).toBeDefined();
    expect(project).toBeDefined();
  });

  it('should create a simple scene with a cube', () => {
    const scene = new SceneBuilder()
      .background({ type: 'solid', color: '#f0f0f0' })
      .light({
        direction: [1, 2, 1],
        color: '#ffffff',
        ambient: 0.4
      })
      .object('test-cube', cube(1.0))
      .instance('test-cube', {
        position: [0, 0.5, 0],
        color: '#ff6b6b'
      })
      .build();

    expect(scene).toBeDefined();
    expect(scene.background).toEqual({ type: 'solid', color: '#f0f0f0' });
    expect(scene.light).toBeDefined();
  });

  it('should create camera presets', () => {
    const camera = Camera.trueIsometric();
    expect(camera).toBeDefined();

    const architectural = Camera.architectural();
    expect(architectural).toBeDefined();
  });

  it('should project scene to screen space', () => {
    const scene = new SceneBuilder()
      .background({ type: 'solid', color: '#f0f0f0' })
      .light({ direction: [1, 2, 1], color: '#ffffff', ambient: 0.4 })
      .object('cube', cube(1.0))
      .instance('cube', { position: [0, 0.5, 0], color: '#ff0000' })
      .build();

    const camera = Camera.trueIsometric();
    const screenSpace = project(scene, camera, 800, 600);

    expect(screenSpace).toBeDefined();
    expect(screenSpace.width).toBe(800);
    expect(screenSpace.height).toBe(600);
    // ScreenSpace contains projected geometry ready for rendering
    expect(typeof screenSpace).toBe('object');
  });

  it('should support groups and references', () => {
    const scene = new SceneBuilder()
      .background({ type: 'solid', color: '#f0f0f0' })
      .light({ direction: [1, 2, 1], color: '#ffffff', ambient: 0.4 })
      .object('cube', cube(1.0))
      .group('cluster')
        .instance('cube', { position: [0, 0.5, 0], color: '#ff0000' })
        .instance('cube', { position: [1, 0.5, 0], color: '#00ff00' })
      .endGroup()
      .reference('cluster', {
        translation: [2, 0, 0],
        scale: [0.5, 0.5, 0.5]
      })
      .build();

    expect(scene).toBeDefined();
  });
});
