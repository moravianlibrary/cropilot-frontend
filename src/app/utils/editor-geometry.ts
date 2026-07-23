import { CornerName, EdgeSide, HitInfo, HitTestOptions, LocalSide, Page, PageRectPx, ResizeOrientation } from '../app.types';
import { degreeToRadian } from './utils';

export const getWidthResizeOrientation = (angle: number): ResizeOrientation | null => {
  if (angle > 0 && angle < 90)  return { signX: +1, signY: +1, baseAngle: angle };
  if (angle > 90)               return { signX: -1, signY: +1, baseAngle: angle - 90 };
  if (angle < -90)              return { signX: -1, signY: -1, baseAngle: -angle - 90 };
  if (angle < 0 && angle > -90) return { signX: +1, signY: -1, baseAngle: -angle };
  return null;
}

export const getHeightResizeOrientation = (angle: number): ResizeOrientation | null => {
  if (angle > 0 && angle < 90)  return { signX: -1, signY: +1, baseAngle: 90 - angle };
  if (angle > 90)               return { signX: -1, signY: -1, baseAngle: angle - 90 };
  if (angle < -90)              return { signX: +1, signY: -1, baseAngle: 180 + angle };
  if (angle < 0 && angle > -90) return { signX: +1, signY: +1, baseAngle: -angle };
  return null;
}

export const localEdgeSideToUserSide = (localSide: LocalSide, angleDeg: number): EdgeSide => {
  const a = angleDeg;

  if (a >= -45 && a <= 45) {
    return localSide;
  }

  if (a > 45 && a <= 135) {
    switch (localSide) {
      case 'left': return 'top';
      case 'right': return 'bottom';
      case 'top': return 'right';
      case 'bottom': return 'left';
    }
  }

  if (a > 135 || a <= -135) {
    switch (localSide) {
      case 'left': return 'right';
      case 'right': return 'left';
      case 'top': return 'bottom';
      case 'bottom': return 'top';
    }
  }

  if (a > -135 && a < -45) {
    switch (localSide) {
      case 'left': return 'bottom';
      case 'right': return 'top';
      case 'top': return 'left';
      case 'bottom': return 'right';
    }
  }

  return localSide;
}

export const localCornerToUserCorner = (local: CornerName, angleDeg: number): CornerName => {
  const a = angleDeg;

  if (a >= -45 && a <= 45) return local;

  if (a > 45 && a <= 135) {
    const map90: Record<CornerName, CornerName> = { nw: 'ne', ne: 'se', se: 'sw', sw: 'nw' };
    return map90[local];
  }

  if (a > 135 || a <= -135) {
    const map180: Record<CornerName, CornerName> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
    return map180[local];
  }

  const map270: Record<CornerName, CornerName> = { nw: 'sw', sw: 'se', se: 'ne', ne: 'nw' };
  return map270[local];
}

export const hitTestPageGeometry = (
  x: number,
  y: number,
  page: Page,
  rect: PageRectPx,
  options: HitTestOptions
): HitInfo => {
  const { centerX, centerY, width, height } = rect;
  const angle = degreeToRadian(page.angle);

  const hw = width / 2;
  const hh = height / 2;

  const dx = x - centerX;
  const dy = y - centerY;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const withinXWithTolerance = Math.abs(localX) <= hw + options.edgeHitTolerance / 2;
  const withinYWithTolerance = Math.abs(localY) <= hh + options.edgeHitTolerance / 2;
  const withinX = Math.abs(localX) <= hw;
  const withinY = Math.abs(localY) <= hh;

  const corners: { x: number; y: number; name: CornerName }[] = [
    { x: -hw - options.cornerSize / 2, y: -hh - options.cornerSize / 2, name: 'nw' },
    { x: hw + options.cornerSize / 2, y: -hh - options.cornerSize / 2, name: 'ne' },
    { x: hw + options.cornerSize / 2, y: hh + options.cornerSize / 2, name: 'se' },
    { x: -hw - options.cornerSize / 2, y: hh + options.cornerSize / 2, name: 'sw' }
  ];

  for (const corner of corners) {
    const distCorner = Math.hypot(localX - corner.x, localY - corner.y);

    if (distCorner <= options.cornerHitTolerance) {
      return { area: 'corner', page, corner: localCornerToUserCorner(corner.name, page.angle) };
    }

    if (
      distCorner < options.rotateHandleOffset
      || distCorner > options.rotateHitTolerance
      || (withinX && withinY)
    ) {
      continue;
    }

    return { area: 'rotate', page, corner: localCornerToUserCorner(corner.name, page.angle) };
  }

  if (!withinXWithTolerance || !withinYWithTolerance) {
    return { area: 'none' };
  }

  const nearLeftOrRight = Math.abs(Math.abs(localX) - (hw + 6)) <= options.edgeHitTolerance;
  const nearTopOrBottom = Math.abs(Math.abs(localY) - (hh + 6)) <= options.edgeHitTolerance;

  if (nearLeftOrRight && !nearTopOrBottom) {
    const localSide = localX > 0 ? 'right' : 'left';
    return {
      area: 'edge',
      page,
      edgeOrientation: 'vertical',
      edgeSide: localEdgeSideToUserSide(localSide, page.angle)
    };
  }

  if (nearTopOrBottom && !nearLeftOrRight) {
    const localSide = localY > 0 ? 'bottom' : 'top';
    return {
      area: 'edge',
      page,
      edgeOrientation: 'horizontal',
      edgeSide: localEdgeSideToUserSide(localSide, page.angle)
    };
  }

  if (withinX && withinY) {
    return { area: 'inside', page };
  }

  return { area: 'none' };
}
