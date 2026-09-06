import { setRunning, setStatus, setDone, setError } from '../ui-helpers';

interface ImageData {
  data: number[];
  width: number;
  height: number;
}
import { foreman } from '../demo';

export function initImageCard() {
  document.getElementById('btn-image')!.onclick = async () => {
    const btn = document.getElementById('btn-image') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('image', btn);
    try {
      const images = await Promise.all(
        Array.from({ length: 4 }, () =>
          foreman.runWorker('generateImageData', {
            srcData: { width: 512, height: 512 },
          }),
        ),
      );
      const imgData = images.map((r) => (r.data as ImageData[])[0]);

      setStatus(
        'image',
        'running',
        `processing ${imgData.length} × 512×512 images…`,
      );

      const processed = await Promise.all(
        imgData.map((img) =>
          foreman.runWorker('processImageData', { srcData: img }),
        ),
      );

      const summary = processed
        .map((r, i) => {
          const img = (r.data as ImageData[])[0];
          return `Image ${i + 1}: ${img.width}×${img.height}, ${img.data.length} bytes processed`;
        })
        .join('\n');
      setDone('image', btn, performance.now() - begin, summary);
    } catch (e) {
      setError('image', btn, e);
    }
  };
}
