/**
 * Heavy data processing — simulates image pixel manipulation (greyscale + blur kernel).
 * Receives a flat RGBA pixel buffer (as a plain number array) and returns the processed buffer.
 */
export function processImageData({
  data: { data, width, height },
}: {
  data: { data: number[]; width: number; height: number };
}): { data: number[]; width: number; height: number } {
  const buf = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(buf.length);

  // Pass 1: greyscale
  for (let i = 0; i < buf.length; i += 4) {
    const grey = buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114;
    buf[i] = buf[i + 1] = buf[i + 2] = grey;
    buf[i + 3] = 255;
  }

  // Pass 2: 3×3 box blur
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0,
        g = 0,
        b = 0,
        count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const idx = (ny * width + nx) * 4;
            r += buf[idx];
            g += buf[idx + 1];
            b += buf[idx + 2];
            count++;
          }
        }
      }
      const oi = (y * width + x) * 4;
      out[oi] = r / count;
      out[oi + 1] = g / count;
      out[oi + 2] = b / count;
      out[oi + 3] = 255;
    }
  }

  return { data: Array.from(out), width, height };
}

/**
 * Generates a synthetic RGBA pixel buffer (random noise image).
 */
export function generateImageData({
  data: { width, height },
}: {
  data: { width: number; height: number };
}): {
  data: number[];
  width: number;
  height: number;
} {
  const pixels: number[] = [];
  for (let i = 0; i < width * height; i++) {
    pixels.push(
      Math.floor(Math.random() * 256), // R
      Math.floor(Math.random() * 256), // G
      Math.floor(Math.random() * 256), // B
      255, // A
    );
  }
  return { data: pixels, width, height };
}
