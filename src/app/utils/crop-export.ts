import { ImageOrientation, Page } from '../app.types';
import { degreeToRadian } from './utils';
import { ZipEntry } from './zip';

// Cropped-page previews rendered in the browser from the same geometry the
// editor draws: crops are in the oriented (display) frame of the scan, as
// fractions of its width / height, rotated by `angle` degrees around their
// center. Equivalent to crop_documents() in cropilot-utils, which crops in the
// original frame and rotates the result by `orientation` afterwards. The output
// is a downscaled JPEG preview, not a full-size crop.

export const PREVIEW_MAX_SIDE = 1600;
const PREVIEW_JPEG_QUALITY = 0.85;

type CropGeometry = Pick<Page, 'xc' | 'yc' | 'width' | 'height' | 'angle'>;

export const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = url;
  });

// One JPEG per crop, ordered left to right like the backend's crop export.
export const renderCropPreviews = async (
  img: HTMLImageElement,
  orientation: ImageOrientation,
  pages: CropGeometry[],
  maxSide: number = PREVIEW_MAX_SIDE
): Promise<Blob[]> => {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const sideways = orientation === 90 || orientation === 270;
  const displayWidth = sideways ? ih : iw;
  const displayHeight = sideways ? iw : ih;

  const blobs: Blob[] = [];
  for (const page of [...pages].sort((a, b) => a.xc - b.xc)) {
    const cropWidth = page.width * displayWidth;
    const cropHeight = page.height * displayHeight;
    const scale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');

    // Areas of a crop that reach past the scan come out white, not black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';

    // Undo the crop's rotation around its center, then draw the scan in its
    // display orientation (as drawOrientedImage does in the editor).
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(scale, scale);
    ctx.rotate(-degreeToRadian(page.angle));
    ctx.translate(-page.xc * displayWidth, -page.yc * displayHeight);
    ctx.translate(displayWidth / 2, displayHeight / 2);
    ctx.rotate(degreeToRadian(orientation));
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);

    blobs.push(await canvasToJpeg(canvas));
  }
  return blobs;
};

// A crop as stored by the API (original frame of the scan) moved to the
// display frame the editor and renderCropPreviews() work in — the same
// quarter-turns as EditorService.pageFromOriginalOrientation().
export const cropToDisplayFrame = <T extends CropGeometry>(page: T, orientation: ImageOrientation): T => {
  let p = { ...page };
  for (let i = 0; i < orientation / 90; i++) {
    p = { ...p, xc: 1 - p.yc, yc: p.xc, width: p.height, height: p.width };
  }
  return p;
};

// API orientation (any multiple of 90°) as one of 0 / 90 / 180 / 270.
export const normalizeOrientation = (orientation?: number): ImageOrientation => {
  const normalized = (((orientation ?? 0) % 360) + 360) % 360;
  return ([0, 90, 180, 270].includes(normalized) ? normalized : 0) as ImageOrientation;
};

export interface CropSource {
  fileBase: string;
  orientation: ImageOrientation;
  // Display frame.
  pages: CropGeometry[];
  image: () => Promise<HTMLImageElement>;
}

// ZIP entries for a whole title, a few scans at a time: fetching the images is
// the slow part, and each worker holds one full scan image while it renders.
export const renderTitlePreviews = async (
  sources: CropSource[],
  onScanDone: () => void,
  concurrency: number = 3
): Promise<ZipEntry[]> => {
  const results: ZipEntry[][] = new Array(sources.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < sources.length) {
      const source = sources[next++];
      const index = next - 1;
      if (source.pages.length) {
        const blobs = await renderCropPreviews(await source.image(), source.orientation, source.pages);
        const names = cropFileNames(source.fileBase, blobs.length);
        results[index] = blobs.map((data, i) => ({ name: names[i], data }));
      } else {
        results[index] = [];
      }
      onScanDone();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return results.flat();
};

// File base of a scan inside the title: older titles have an empty scan_name,
// those are named by their position so names stay unique inside the ZIP.
export const scanFileBase = (scanName: string | undefined, index: number): string =>
  scanName || `sken_${String(index + 1).padStart(4, '0')}`;

export const loadImageBlob = async (blob: Blob): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const canvasToJpeg =(canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Failed to encode JPEG.')),
      'image/jpeg',
      PREVIEW_JPEG_QUALITY
    );
  });

// `v0002_page1.jpg`, `v0002_page2.jpg`, ... — the naming of crop_documents()
// in cropilot-utils (cropilot_api_tools/uploader.py). Scan names come from the
// API without an extension.
export const cropFileNames = (scanName: string, count: number): string[] => {
  const base = safeFileName(scanName);
  return Array.from({ length: count }, (_, i) => `${base}_page${i + 1}.jpg`);
};

// Characters that are not allowed in file names on common systems.
export const safeFileName = (name: string): string =>
  name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'cropilot';

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
