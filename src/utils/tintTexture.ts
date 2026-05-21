import * as THREE from 'three';

/** Extract raw sRGB pixel data from a loaded THREE.Texture. */
export function extractAtlasPixels(texture: THREE.Texture): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} | null {
  const img = texture.image as CanvasImageSource | null;
  if (!img) return null;
  let w = 0, h = 0;
  if (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement) {
    w = img.width; h = img.height;
  } else if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    w = img.width; h = img.height;
  }
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  try {
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  } catch {
    return null;
  }
}

/**
 * Build a CanvasTexture with body-paint pixels recolored to tintHex.
 *
 * Body paint is identified as pixels with HSV saturation > 0.40 and
 * sRGB luminance 25–242. This reliably excludes:
 *   - Wheels  rgb(56,56,61)      sat≈0.08
 *   - Windows rgb(134,139,161)   sat≈0.17
 *   - Windows rgb(208,232,255)   sat≈0.18
 *
 * Tint is applied as: newColor = tintColor × (pixelLum / 128)
 * so shaded body regions stay proportionally darker / lighter.
 */
export function buildTintedTexture(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
  tintHex: string,
): THREE.CanvasTexture {
  const raw = parseInt(tintHex.replace('#', ''), 16);
  const tr = (raw >> 16) & 0xff;
  const tg = (raw >> 8) & 0xff;
  const tb = raw & 0xff;

  const data = new Uint8ClampedArray(srcData);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const sat = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
    if (sat > 0.40 && lum > 25 && lum < 242) {
      const ratio = lum / 128;
      data[i]     = Math.min(255, Math.round(tr * ratio));
      data[i + 1] = Math.min(255, Math.round(tg * ratio));
      data[i + 2] = Math.min(255, Math.round(tb * ratio));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
