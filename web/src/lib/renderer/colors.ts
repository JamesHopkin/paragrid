/**
 * Color utilities for rendering.
 */

/**
 * Convert HSL color values to hex RGB format.
 *
 * @param h - Hue (0-360)
 * @param s - Saturation (0-1)
 * @param l - Lightness (0-1)
 * @returns Hex color string (e.g., "#rrggbb")
 */
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Get a color for a grid based on its ID.
 * Uses a hash-based approach to generate consistent colors per grid.
 *
 * @param gridId - Grid identifier
 * @returns Hex color string (e.g., "#rrggbb")
 */
export function getGridColor(gridId: string): string {
  // Simple hash-based color generation
  let hash = 0;
  for (let i = 0; i < gridId.length; i++) {
    hash = gridId.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash % 360);
  return hslToHex(hue, 0.7, 0.6);
}
