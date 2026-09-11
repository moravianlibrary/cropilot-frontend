import { PagePlacementStrategy } from '../app.types';
import { degreeToRadian } from './utils';

/**
 * Where to put a newly added crop ("výřez") so the user has as little to fix
 * as possible. Pure geometry — the editor service feeds it the current crops,
 * the model predictions and the neighbouring scans and gets back one proposal.
 *
 * Strategies, in priority order:
 *  1. `prediction` — a predicted crop that no current crop already covers.
 *  2. `mirror`     — exactly one crop exists: copy its shape to the free side.
 *  3. `neighbor`   — the scan is empty and has no predictions: borrow the
 *                    first crop of the closest neighbouring scan.
 *  4. `default`    — the historical centred 40 % × 85 % rectangle.
 *
 * All coordinates are relative to the oriented image (0–1), matching `Page`.
 */

export interface PageGeometry {
  xc: number;
  yc: number;
  width: number;
  height: number;
  angle: number;
}

export interface PageBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PagePlacementInput {
  currentPages: PageGeometry[];
  predictedPages: PageGeometry[];
  /** Crops of neighbouring scans, most trusted first. */
  neighborPages: PageGeometry[][];
  /** Oriented image width / height. */
  aspect: number;
}

export interface PagePlacement {
  page: PageGeometry;
  strategy: PagePlacementStrategy;
}

export const DEFAULT_NEW_PAGE: PageGeometry = { xc: .5, yc: .5, width: .4, height: .85, angle: 0 };

// A prediction counts as "already placed" when a current crop overlaps it this much.
const COVERED_IOU = 0.3;
const COVERED_CONTAINMENT = 0.5;
// A mirrored crop may touch its source but should not sit on top of it.
const MIRROR_OVERLAP = 0.05;
// Free gap narrower than this is not worth squeezing a crop into.
const MIN_GAP_WIDTH = 0.05;

/** Axis-aligned bounds of a (possibly rotated) crop in relative image coordinates. */
export const pageBounds = (p: PageGeometry, aspect: number): PageBounds => {
  const iw = aspect > 0 ? aspect : 1;
  const ih = 1;
  const rad = degreeToRadian(p.angle);
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const hw = (p.width * iw) / 2;
  const hh = (p.height * ih) / 2;
  const cx = p.xc * iw;
  const cy = p.yc * ih;

  const corners = [
    { x: -hw, y: -hh },
    { x: hw,  y: -hh },
    { x: hw,  y: hh  },
    { x: -hw, y: hh  },
  ].map(pt => ({
    x: cx + pt.x * cos - pt.y * sin,
    y: cy + pt.x * sin + pt.y * cos,
  }));
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);

  return {
    left: Math.min(...xs) / iw,
    right: Math.max(...xs) / iw,
    top: Math.min(...ys) / ih,
    bottom: Math.max(...ys) / ih,
  };
};

const area = (b: PageBounds): number => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

const intersectionArea = (a: PageBounds, b: PageBounds): number => {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};

const iou = (a: PageBounds, b: PageBounds): number => {
  const inter = intersectionArea(a, b);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
};

/** Share of the smaller box that lies inside the other one. */
const overlapFraction = (a: PageBounds, b: PageBounds): number => {
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? intersectionArea(a, b) / smaller : 0;
};

const isCovered = (candidate: PageBounds, existing: PageBounds): boolean => {
  const candidateArea = area(candidate);
  const containment = candidateArea > 0 ? intersectionArea(candidate, existing) / candidateArea : 0;
  return iou(candidate, existing) > COVERED_IOU || containment > COVERED_CONTAINMENT;
};

/** Translate the crop so it lies inside the image (when it fits at all). */
export const shiftInsideImage = (p: PageGeometry, aspect: number): PageGeometry => {
  const b = pageBounds(p, aspect);
  const dx = b.left < 0 ? -b.left : b.right > 1 ? 1 - b.right : 0;
  const dy = b.top < 0 ? -b.top : b.bottom > 1 ? 1 - b.bottom : 0;
  return dx || dy ? { ...p, xc: p.xc + dx, yc: p.yc + dy } : p;
};

const geometryOf = (p: PageGeometry): PageGeometry =>
  ({ xc: p.xc, yc: p.yc, width: p.width, height: p.height, angle: p.angle });

const leftmost = (pages: PageGeometry[]): PageGeometry | undefined =>
  pages.reduce<PageGeometry | undefined>((best, p) => !best || p.xc < best.xc ? p : best, undefined);

const proposeFromPredictions = (input: PagePlacementInput): PageGeometry | null => {
  const { currentPages, predictedPages, aspect } = input;
  const currentBounds = currentPages.map(p => pageBounds(p, aspect));
  const free = predictedPages.filter(pp => {
    const pb = pageBounds(pp, aspect);
    return !currentBounds.some(cb => isCovered(pb, cb));
  });
  const pick = leftmost(free);
  return pick ? shiftInsideImage(geometryOf(pick), aspect) : null;
};

const proposeMirror = (input: PagePlacementInput): PageGeometry | null => {
  const { currentPages, aspect } = input;
  if (currentPages.length !== 1) return null;

  const src = geometryOf(currentPages[0]);
  const srcBounds = pageBounds(src, aspect);
  const srcWidth = srcBounds.right - srcBounds.left;
  const freeLeft = srcBounds.left;
  const freeRight = 1 - srcBounds.right;
  const side: 'left' | 'right' = freeRight >= freeLeft ? 'right' : 'left';
  const gap = side === 'right' ? freeRight : freeLeft;
  if (gap < MIN_GAP_WIDTH) return null;

  // Mirror around the image axis — a book lying centred on the scanner.
  let candidate: PageGeometry = { ...src, xc: 1 - src.xc };
  const landsOnSide = side === 'right' ? candidate.xc > src.xc : candidate.xc < src.xc;
  if (!landsOnSide || overlapFraction(pageBounds(candidate, aspect), srcBounds) > MIRROR_OVERLAP) {
    // Book is off-centre: put the copy flush against the existing crop instead.
    candidate = { ...src, xc: side === 'right' ? src.xc + srcWidth : src.xc - srcWidth };
  }

  candidate = shiftInsideImage(candidate, aspect);

  // Still on top of the source after being pushed back inside → the free gap
  // is narrower than the crop; shrink the copy to the gap.
  if (overlapFraction(pageBounds(candidate, aspect), srcBounds) > MIRROR_OVERLAP) {
    candidate = {
      ...src,
      width: src.width * (gap / srcWidth),
      xc: side === 'right' ? srcBounds.right + gap / 2 : srcBounds.left - gap / 2,
    };
    candidate = shiftInsideImage(candidate, aspect);
  }

  return candidate;
};

const proposeFromNeighbors = (input: PagePlacementInput): PageGeometry | null => {
  if (input.currentPages.length) return null;
  for (const pages of input.neighborPages) {
    const pick = leftmost(pages);
    if (pick) return shiftInsideImage(geometryOf(pick), input.aspect);
  }
  return null;
};

export const proposeNewPage = (input: PagePlacementInput): PagePlacement => {
  const prediction = proposeFromPredictions(input);
  if (prediction) return { page: prediction, strategy: 'prediction' };

  const mirror = proposeMirror(input);
  if (mirror) return { page: mirror, strategy: 'mirror' };

  const neighbor = proposeFromNeighbors(input);
  if (neighbor) return { page: neighbor, strategy: 'neighbor' };

  return { page: { ...DEFAULT_NEW_PAGE }, strategy: 'default' };
};
