/**
 * ParagridAnimator - Reusable animation orchestration for isometric Paragrid games.
 *
 * Handles creation and playback of movement and camera animations using iso-render.
 * The animator manages animation systems but does NOT manage scene/renderer lifecycle -
 * that's the responsibility of the game/demo context.
 */

import {
  AnimationSystem,
  CameraAnimationSystem,
  Easing,
  type AnimationClip,
  type CameraAnimationClip,
  type Camera,
  type EasingFunction
} from 'iso-render';
import type { Movement } from './animation-builder.js';
import type { CameraParams } from '../camera/scale-helper.js';

/**
 * Configuration for ParagridAnimator.
 */
export interface AnimatorConfig {
  /** Duration of movement animations in seconds (default: 0.3) */
  movementDuration?: number;
  /** Duration of camera animations in seconds (default: 0.3) */
  cameraDuration?: number;
  /** Easing function for movement animations (default: easeInQuad) */
  movementEasing?: EasingFunction;
  /** Easing function for camera animations (default: easeInOutQuad) */
  cameraEasing?: EasingFunction;
}

/**
 * ParagridAnimator manages animation clip creation and playback.
 *
 * This class handles:
 * - Creating animation clips from movement data
 * - Creating camera animation clips from camera transitions
 * - Managing AnimationSystem and CameraAnimationSystem
 * - Animation loop lifecycle (start/stop)
 * - Frame callbacks for rendering
 *
 * The animator does NOT manage:
 * - Scene/renderer/celltree lifecycle (handled by game context)
 * - Deciding when to rebuild vs re-render (handled by game context)
 * - Input handling or game state (handled by game context)
 *
 * @example
 * ```typescript
 * const animator = new ParagridAnimator({
 *   movementDuration: 0.3,
 *   cameraDuration: 0.3
 * });
 *
 * // Create and play movement animation
 * const movements = chainToMovements(store, pushChain, oldView, newView);
 * animator.animateMovements(movements);
 * animator.start((dt) => {
 *   // Re-render with animation overrides
 *   const transforms = animator.evaluateTransforms();
 *   const camera = animator.evaluateCamera(baseCamera);
 *   // ... render scene ...
 * });
 * ```
 */
export class ParagridAnimator {
  private readonly config: Required<AnimatorConfig>;
  private readonly animationSystem: AnimationSystem;
  private readonly cameraAnimationSystem: CameraAnimationSystem;
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private frameCallback: ((deltaTime: number) => void) | null = null;

  constructor(config: AnimatorConfig = {}) {
    this.config = {
      movementDuration: config.movementDuration ?? 0.3,
      cameraDuration: config.cameraDuration ?? 0.3,
      movementEasing: config.movementEasing ?? Easing.easeInQuad,
      cameraEasing: config.cameraEasing ?? Easing.easeInOutQuad,
    };
    this.animationSystem = new AnimationSystem();
    this.cameraAnimationSystem = new CameraAnimationSystem();
  }

  /**
   * Unified animation method - creates animations for all movements and optional camera transition.
   *
   * This is the primary API for creating animations. It handles:
   * - Position animations for ALL objects
   * - Scale animations ONLY for objects with isEnterExit=true
   * - Optional camera zoom/pan animation
   *
   * @param movements - Array of movement data (from chainToMovements)
   * @param cameraTransition - Optional camera transition parameters
   * @returns Array of clip IDs created [objectClipId?, cameraClipId?]
   *
   * @example
   * ```typescript
   * // Simple within-grid push (no camera change)
   * animator.animate(movements);
   *
   * // Enter/exit transition (with camera zoom)
   * animator.animate(movements, { start: startParams, end: endParams });
   * ```
   */
  animate(
    movements: Movement[],
    cameraTransition?: { start: CameraParams; end: CameraParams }
  ): string[] {
    const clipIds: string[] = [];

    // Create object animations if we have movements
    if (movements.length > 0) {
      const objectClipId = cameraTransition ? 'enter-exit-move' : 'push-move';
      const duration = cameraTransition ? this.config.cameraDuration : this.config.movementDuration;
      const easing = cameraTransition ? this.config.cameraEasing : this.config.movementEasing;

      // Remove any existing movement animations
      this.animationSystem.removeClip('push-move');
      this.animationSystem.removeClip('enter-exit-move');

      const animations: Array<{
        nodeId: string;
        channels: Array<{
          target: 'position' | 'rotation' | 'scale';
          interpolation: 'linear';
          keyFrames: Array<{ time: number; value: [number, number, number]; easing?: EasingFunction }>;
        }>;
      }> = [];

      for (const movement of movements) {
        // Calculate offset from new position to old position (in world space)
        const relativeOffset: [number, number, number] = [
          movement.oldPos[0] - movement.newPos[0],
          movement.oldPos[1] - movement.newPos[1],
          movement.oldPos[2] - movement.newPos[2]
        ];

        // Determine if this movement needs scale animation
        // Scale animation requires: enter/exit + valid scale ratio
        const needsScale = movement.isEnterExit && movement.scaleRatio !== undefined;

        if (needsScale) {
          console.log(`  Animation: ${movement.cellId} from offset [${relativeOffset[0].toFixed(2)}, ${relativeOffset[2].toFixed(2)}] to [0, 0] (with scale ${movement.scaleRatio!.toFixed(3)}x)`);
        } else {
          console.log(`  Animation: ${movement.cellId} from offset [${relativeOffset[0].toFixed(2)}, ${relativeOffset[2].toFixed(2)}] to [0, 0]`);
        }

        // Build channels: always position, optionally scale
        const channels: Array<{
          target: 'position' | 'rotation' | 'scale';
          interpolation: 'linear';
          keyFrames: Array<{ time: number; value: [number, number, number]; easing?: EasingFunction }>;
        }> = [
          {
            target: 'position',
            interpolation: 'linear',
            keyFrames: [
              { time: 0, value: relativeOffset, easing },
              { time: duration, value: [0, 0, 0] }
            ]
          }
        ];

        // Add scale animation for objects crossing grid boundaries
        if (needsScale) {
          const startScale: [number, number, number] = [
            movement.scaleRatio!,
            movement.scaleRatio!,
            movement.scaleRatio!
          ];
          const endScale: [number, number, number] = [1, 1, 1];

          channels.push({
            target: 'scale',
            interpolation: 'linear',
            keyFrames: [
              { time: 0, value: startScale, easing },
              { time: duration, value: endScale }
            ]
          });
        }

        animations.push({
          nodeId: movement.cellId,
          channels
        });
      }

      const objectClip: AnimationClip = {
        id: objectClipId,
        duration,
        loop: false,
        animations
      };

      this.animationSystem.addClip(objectClip);
      this.animationSystem.play(objectClipId);
      clipIds.push(objectClipId);
    }

    // Create camera animation if transitioning
    if (cameraTransition) {
      const cameraClipId = this.animateCameraTransition(cameraTransition.start, cameraTransition.end);
      clipIds.push(cameraClipId);
    }

    return clipIds;
  }

  /**
   * Create and play movement animations from an array of movements.
   * Returns the clip ID.
   *
   * @param movements - Array of movement data (from chainToMovements)
   * @returns Animation clip ID
   */
  animateMovements(movements: Movement[]): string {
    const clipId = 'push-move';
    const duration = this.config.movementDuration;

    // Remove any existing movement animation
    this.animationSystem.removeClip(clipId);

    const animations: Array<{
      nodeId: string;
      channels: Array<{
        target: 'position' | 'rotation' | 'scale';
        interpolation: 'linear';
        keyFrames: Array<{ time: number; value: [number, number, number]; easing?: EasingFunction }>;
      }>;
    }> = [];

    for (const movement of movements) {
      // Calculate offset from new position to old position (in world space)
      const relativeOffset: [number, number, number] = [
        movement.oldPos[0] - movement.newPos[0],
        movement.oldPos[1] - movement.newPos[1],
        movement.oldPos[2] - movement.newPos[2]
      ];
      const targetPos: [number, number, number] = [0, 0, 0];

      console.log(`  ${movement.cellId}: [${relativeOffset[0].toFixed(2)}, ${relativeOffset[2].toFixed(2)}] -> [${targetPos}]`);

      animations.push({
        nodeId: movement.cellId,
        channels: [{
          target: 'position',
          interpolation: 'linear',
          keyFrames: [
            { time: 0, value: relativeOffset, easing: this.config.movementEasing },
            { time: duration, value: targetPos }
          ]
        }]
      });
    }

    const clip: AnimationClip = {
      id: clipId,
      duration,
      loop: false,
      animations
    };

    this.animationSystem.addClip(clip);
    this.animationSystem.play(clipId);

    return clipId;
  }

  /**
   * Create and play camera transition animation.
   * Returns the clip ID.
   *
   * @param startParams - Starting camera parameters
   * @param endParams - Ending camera parameters
   * @returns Camera animation clip ID
   */
  animateCameraTransition(startParams: CameraParams, endParams: CameraParams): string {
    const clipId = 'camera-transition';
    const duration = this.config.cameraDuration;

    const startCenter = startParams.position;
    const startRightEdge: [number, number, number] = [
      startCenter[0] + startParams.viewWidth / 2,
      startCenter[1],
      startCenter[2]
    ];
    const endCenter = endParams.position;
    const endRightEdge: [number, number, number] = [
      endCenter[0] + endParams.viewWidth / 2,
      endCenter[1],
      endCenter[2]
    ];

    const cameraClip: CameraAnimationClip = {
      id: clipId,
      duration,
      loop: false,
      channels: [
        {
          target: 'center',
          interpolation: 'linear',
          keyFrames: [
            { time: 0, value: startCenter, easing: this.config.cameraEasing },
            { time: duration, value: endCenter }
          ]
        },
        {
          target: 'rightEdge',
          interpolation: 'linear',
          keyFrames: [
            { time: 0, value: startRightEdge, easing: this.config.cameraEasing },
            { time: duration, value: endRightEdge }
          ]
        }
      ]
    };

    this.cameraAnimationSystem.addClip(cameraClip);
    this.cameraAnimationSystem.play(clipId);

    return clipId;
  }

  /**
   * Create and play combined enter/exit animation with both objects and camera.
   * Objects crossing grid boundaries get scale animation, others only get position.
   * Returns array of clip IDs [objectClipId, cameraClipId].
   *
   * @param movements - Array of movement data
   * @param startParams - Starting camera parameters
   * @param endParams - Ending camera parameters
   * @returns Array of animation clip IDs [objects, camera]
   */
  animateEnterExit(movements: Movement[], startParams: CameraParams, endParams: CameraParams): [string, string] {
    const objectClipId = 'enter-exit-move';
    const cameraClipId = 'camera-transition';
    const duration = this.config.cameraDuration; // Use camera duration for synchronized animation

    // Remove any existing animations
    this.animationSystem.removeClip('push-move');
    this.animationSystem.removeClip(objectClipId);

    // Calculate scale ratio for enter/exit objects
    // When entering (zoom in): startViewWidth > endViewWidth, so scale > 1 (objects start larger)
    // When exiting (zoom out): startViewWidth < endViewWidth, so scale < 1 (objects start smaller)
    const scaleRatio = startParams.viewWidth / endParams.viewWidth;
    const startScale: [number, number, number] = [scaleRatio, scaleRatio, scaleRatio];
    const endScale: [number, number, number] = [1, 1, 1];

    console.log(`  Scale animation: ${scaleRatio.toFixed(3)}x -> 1.0x`);

    const animations: Array<{
      nodeId: string;
      channels: Array<{
        target: 'position' | 'rotation' | 'scale';
        interpolation: 'linear';
        keyFrames: Array<{ time: number; value: [number, number, number]; easing?: EasingFunction }>;
      }>;
    }> = [];

    for (const movement of movements) {
      // Calculate offset from new position to old position (in world space)
      const relativeOffset: [number, number, number] = [
        movement.oldPos[0] - movement.newPos[0],
        movement.oldPos[1] - movement.newPos[1],
        movement.oldPos[2] - movement.newPos[2]
      ];

      console.log(`  Animation: ${movement.cellId} from offset [${relativeOffset[0].toFixed(2)}, ${relativeOffset[2].toFixed(2)}] to [0, 0]${movement.isEnterExit ? ' (with scale)' : ''}`);

      // Build channels: always position, optionally scale
      const channels: Array<{
        target: 'position' | 'rotation' | 'scale';
        interpolation: 'linear';
        keyFrames: Array<{ time: number; value: [number, number, number]; easing?: EasingFunction }>;
      }> = [
        {
          target: 'position',
          interpolation: 'linear',
          keyFrames: [
            { time: 0, value: relativeOffset, easing: this.config.cameraEasing },
            { time: duration, value: [0, 0, 0] }
          ]
        }
      ];

      // Only add scale animation for objects that are actually entering/exiting
      if (movement.isEnterExit) {
        channels.push({
          target: 'scale',
          interpolation: 'linear',
          keyFrames: [
            { time: 0, value: startScale, easing: this.config.cameraEasing },
            { time: duration, value: endScale }
          ]
        });
      }

      animations.push({
        nodeId: movement.cellId,
        channels
      });
    }

    const objectClip: AnimationClip = {
      id: objectClipId,
      duration,
      loop: false,
      animations
    };

    // Add and play object animation
    this.animationSystem.addClip(objectClip);
    this.animationSystem.play(objectClipId);

    // Add and play camera animation
    this.animateCameraTransition(startParams, endParams);

    return [objectClipId, cameraClipId];
  }

  /**
   * Start the animation loop with frame callback.
   * The callback receives deltaTime in seconds.
   *
   * @param onFrame - Callback invoked each frame with deltaTime
   */
  start(onFrame: (deltaTime: number) => void): void {
    if (this.animationFrameId !== null) {
      return; // Already running
    }

    this.frameCallback = onFrame;
    this.lastFrameTime = performance.now();

    const animate = (currentTime: number): void => {
      const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
      this.lastFrameTime = currentTime;

      // Update both animation systems
      this.animationSystem.update(deltaTime);
      this.cameraAnimationSystem.update(deltaTime);

      // Invoke frame callback
      if (this.frameCallback) {
        this.frameCallback(deltaTime);
      }

      // Continue if either animation is active
      const cellAnimating = this.animationSystem.getState().playing;
      const cameraAnimating = this.cameraAnimationSystem.getState().playing;

      if (cellAnimating || cameraAnimating) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        // All animations complete - clean up
        this.animationFrameId = null;
        this.frameCallback = null;

        // Remove animation clips so transform overrides are cleared
        this.animationSystem.removeClip('push-move');
        this.animationSystem.removeClip('enter-exit-move');
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop all animations immediately.
   */
  stop(): void {
    this.animationSystem.stop();
    this.cameraAnimationSystem.stop();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.frameCallback = null;
  }

  /**
   * Check if any animation is currently playing.
   */
  isAnimating(): boolean {
    return this.animationFrameId !== null;
  }

  /**
   * Evaluate current transform overrides for rendering.
   * Call this during render to get animated positions/scales.
   */
  evaluateTransforms(): ReturnType<AnimationSystem['evaluateTransforms']> {
    return this.animationSystem.evaluateTransforms();
  }

  /**
   * Evaluate camera with current animation applied.
   * Call this during render to get the animated camera.
   *
   * @param baseCamera - The base camera to animate
   * @returns Animated camera
   */
  evaluateCamera(baseCamera: Camera): Camera {
    return this.cameraAnimationSystem.evaluateCamera(baseCamera);
  }

  /**
   * Clear all animation clips and stop playback.
   * Useful for resetting state.
   */
  clear(): void {
    this.stop();
    this.animationSystem.removeClip('push-move');
    this.animationSystem.removeClip('enter-exit-move');
  }
}
