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
  private completionCallback: (() => void) | null = null;

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
        // Calculate displacement vector: how far the object needs to move
        // For enter/exit: oldPos and newPos are in world-space, giving correct displacement across grids
        // For in-grid: they're in grid-local space, giving correct displacement within the grid
        let relativeOffset: [number, number, number] = [
          movement.oldPos[0] - movement.newPos[0],
          movement.oldPos[1] - movement.newPos[1],
          movement.oldPos[2] - movement.newPos[2]
        ];

        // Determine if this movement has enter/exit animations
        const hasVisualScale = movement.isEnterExit && movement.visualScaleRatio !== undefined;
        const hasParentCompensation = movement.isEnterExit && movement.parentScaleCompensation !== undefined;

        // CRITICAL: Compensate for parent template scaling
        // When an object is inside a scaled template (e.g., grid 'b' inside 'a' inside 'main'),
        // any animation offsets are scaled by all parent transforms. We use parentScaleCompensation
        // (which is rootCellSize / destCellSize) to counteract this cumulative scaling.
        // Example: parentScaleCompensation=9.0 means cumulative parent scale=1/9, so offset needs to be 9× larger.
        if (hasParentCompensation) {
          relativeOffset = [
            relativeOffset[0] * movement.parentScaleCompensation!,
            relativeOffset[1] * movement.parentScaleCompensation!,
            relativeOffset[2] * movement.parentScaleCompensation!
          ];
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
        // Uses visualScaleRatio (oldCellSize / newCellSize) for the visual size change
        if (hasVisualScale) {
          const startScale: [number, number, number] = [
            movement.visualScaleRatio!,
            movement.visualScaleRatio!,
            movement.visualScaleRatio!
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
   * Start the animation loop with frame callback.
   * The callback receives deltaTime in seconds.
   *
   * @param onFrame - Callback invoked each frame with deltaTime
   * @param onComplete - Optional callback invoked once when all animations complete
   */
  start(onFrame: (deltaTime: number) => void, onComplete?: () => void): void {
    if (this.animationFrameId !== null) {
      return; // Already running
    }

    this.frameCallback = onFrame;
    this.completionCallback = onComplete ?? null;
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
        const callback = this.frameCallback;
        const completionCallback = this.completionCallback;
        this.frameCallback = null;
        this.completionCallback = null;

        // Remove animation clips so transform overrides are cleared
        this.animationSystem.removeClip('push-move');
        this.animationSystem.removeClip('enter-exit-move');
        this.cameraAnimationSystem.removeClip('camera-transition');

        // Trigger one final render to show the final state without animation transforms
        if (callback) {
          callback(0);
        }

        // Invoke completion callback after final render
        if (completionCallback) {
          completionCallback();
        }
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
