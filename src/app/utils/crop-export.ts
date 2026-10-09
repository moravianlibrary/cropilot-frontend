import { ImageOrientation, Page } from '../app.types';
import { degreeToRadian } from './utils';

// Crops of the open scan rendered in the browser from the same geometry the
// editor draws: crops are in the oriented (display) frame of the scan, as
// fractions of its width / height, rotated by `angle` degrees around their
// center. Equivalent to crop_documents() in cropilot-utils and crop_page() in
// the backend, which crop in the original frame and turn the result by
// `orientation` afterwards. Output keeps the resolution of the loaded scan.
// Whole titles are cut on the backend (GET /{title_id}/crop-previews).

const JPEG_QUALITY = 0.9;

type CropGeometry = Pick<Page, 'xc' | 'yc' | 'width' | 'height' | 'angle'>;

// One JPEG per crop, ordered left to right like the backend's crop export.
export const renderCropPreviews = async (
  img: HTMLImageElement,
  orientation: ImageOrientation,
  pages: CropGeometry[]
): Promise<Blob[]> => {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const sideways = orientation === 90 || orientation === 270;
  const displayWidth = sideways ? ih : iw;
  const displayHeight = sideways ? iw : ih;

  const blobs: Blob[] = [];
  for (const page of [...pages].sort((a, b) => a.xc - b.xc)) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(page.width * displayWidth));
    canvas.height = Math.max(1, Math.round(page.height * displayHeight));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');

    // Areas of a crop that reach past the scan come out white, not black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';

    // Undo the crop's rotation around its center, then draw the scan in its
    // display orientation (as drawOrientedImage does in the editor).
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-degreeToRadian(page.angle));
    ctx.translate(-page.xc * displayWidth, -page.yc * displayHeight);
    ctx.translate(displayWidth / 2, displayHeight / 2);
    ctx.rotate(degreeToRadian(orientation));
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);

    blobs.push(await canvasToJpeg(canvas));
  }
  return blobs;
};

const canvasToJpeg = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Failed to encode JPEG.')),
      'image/jpeg',
      JPEG_QUALITY
    );
  });

// File base of a scan inside the title: older titles have an empty scan_name,
// those are named by their position (as the backend archive does).
export const scanFileBase = (scanName: string | undefined, index: number): string =>
  scanName || `sken_${String(index + 1).padStart(4, '0')}`;

// `v0002_page1.jpg`, `v0002_page2.jpg`, ... — the naming of crop_documents()
// in cropilot-utils and of the backend archive. Scan names come from the API
// without an extension.
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
