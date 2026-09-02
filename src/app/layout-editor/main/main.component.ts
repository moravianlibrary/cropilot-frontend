import { Component, ElementRef, inject, NgZone, viewChild } from '@angular/core';
import { TelemetryService } from '../../services/telemetry.service';
import { EditorService } from '../../services/editor.service';
import { clamp, degreeToRadian, radianToDegree } from '../../utils/utils';
import { CornerName, EdgeLocalOrientation, EdgeSide, HitInfo, Page } from '../../app.types';
import { LoaderComponent } from '../../components/loader/loader.component';
import { ToastComponent } from '../../components/toast/toast.component';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { hitTestPageGeometry, localCornerToUserCorner } from '../../utils/editor-geometry';

@Component({
  selector: 'app-main-editor',
  imports: [LoaderComponent, ToastComponent],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})
export class MainComponent {
  editor = inject(EditorService);
  private telemetry = inject(TelemetryService);
  private auth = inject(AuthService);
  private ui = inject(UiService);

  private pointerCursor: string = "pointer";
  private moveCursor: string = "url('/assets/move-cursor.png'), auto";
  private horizontalEdgeCursor: string = "url('/assets/horizontal-edge-cursor.png') 9.5 0, ew-resize";
  private verticalEdgeCursor: string = "url('/assets/vertical-edge-cursor.png') 0 9.5, ns-resize";
  private diagonalTlbrCursor: string = "url('/assets/diagonal-tlbr-cursor.png') 9.5 9.5, nwse-resize";
  private diagonalBltrCursor: string = "url('/assets/diagonal-bltr-cursor.png') 9.5 9.5, nesw-resize";
  private rotateCursorTopRight: string = "url('/assets/rotate-cursor-top-right.png') 9.5 9.5, auto";
  private rotateCursorTopLeft: string = "url('/assets/rotate-cursor-top-left.png') 9.5 9.5, auto";
  private rotateCursorBottomRight: string = "url('/assets/rotate-cursor-bottom-right.png') 9.5 9.5, auto";
  private rotateCursorBottomLeft: string = "url('/assets/rotate-cursor-bototm-left.png') 9.5 9.5, auto";

  private edgeHitTolerance = 14;
  private cornerHitTolerance = 14;
  private rotateHandleOffset = 14;
  private rotateHitTolerance = 24;

  private ngZone = inject(NgZone);
  private mainContainer = viewChild<ElementRef<HTMLDivElement>>('mainContainer');
  private resizeObserver?: ResizeObserver;
  private rafId: number | null = null;

  ngAfterViewInit(): void {
    const editor = this.editor;

    // On resize
    {
      const container = this.mainContainer()?.nativeElement;

      this.ngZone.runOutsideAngular(() => {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.rafId !== null) cancelAnimationFrame(this.rafId);

          this.rafId = requestAnimationFrame(() => {
            this.ngZone.run(() => {
              if (editor.mainImage) editor.refitMainImageToCanvas();
            });
          });
        });

        if (container) this.resizeObserver.observe(container);
      });
    }
    
    // Set canvas
    editor.c = document.getElementById('main-canvas') as HTMLCanvasElement;
    editor.ctx = editor.c.getContext('2d')!;

    // Attach event handlers
    this.attachMainCanvasEvents();
    [
      // '#main-container',
      'app-left-panel-editor',
      'app-bottom-panel-editor',
      'app-right-panel-editor'
    ].forEach(el => this.attachEventsRest(document.querySelector(el)));
    
    document.onpointerup = (ev) => {
      const tagName = (ev.target as HTMLElement).tagName;
      if (tagName !== 'HTML') return;
      this.stopDragRotateResize();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  private attachEventsRest(el: HTMLElement | null): void {
    if (!el) return;
    const editor = this.editor;

    el.onclick = (ev) => {
      const tagName = (ev.target as HTMLElement).tagName;
      if (tagName === 'APP-RIGHT-PANEL' || el.tagName === 'APP-RIGHT-PANEL') return;
      if (tagName !== 'APP-LEFT-PANEL' && tagName !== 'DIV' && tagName !== 'APP-RIGHT-PANEL' && tagName !== 'APP-BOTTOM-PANEL') return;
      if (el.tagName === 'DIV' && tagName !== 'DIV') return;
      if (!editor.selectedPage) return;
      if (this.ui.dialogOpened) {
        this.ui.dialogOpened = false;
        return;
      }
      this.stopDragRotateResize();

      if (editor.pageWasEdited) editor.updateCurrentPagesWithEdited();
      editor.lastSelectedPage = editor.selectedPage;
      editor.selectedPage = null;
      editor.lastPageCursorIsInside = null;
      editor.redrawAllPages();
      editor.mainImageItem.set({ ...editor.mainImageItem(), url: editor.c.toDataURL('image/jpeg') });
      editor.hoveringPage('');
    };

    el.onmouseup = (ev) => {
      if (!editor.selectedPage) return;
      this.stopDragRotateResize();
    };
  }

  private attachMainCanvasEvents(): void {
    const { c } = this.editor; 

    ['mousedown', 'mousemove', 'mouseup', 'mouseenter', 'mouseleave', 'wheel'].forEach(eventType => {
      c.addEventListener(eventType, (ev) => this.handleCanvasInteraction(ev as (MouseEvent | WheelEvent), c));
    });
  }

  private handleCanvasInteraction(ev: MouseEvent | WheelEvent, el: HTMLElement): void {
    if ((ev.target as HTMLElement).tagName !== 'CANVAS') return;
    const editor = this.editor;
    // Editing interactions (hover/select/drag/resize/rotate) are allowed in read
    // mode too; only saving is restricted (see AuthService.canEditTitle).
    const canWriteTitle = this.auth.canEditTitle();

    const btn = ev.button;
    const hit = this.hitTest(ev);
    const pageId = this.pageIdCursorInside(ev);
    editor.pageId = pageId;
    const insidePage = !!pageId;
    const hitPage = hit.page ?? null;
    editor.hitPage = hitPage;
    
    const hoveringPage = () => editor.hoveringPage(hitPage?._id === editor.selectedPage?._id ? editor.selectedPage?._id ?? '' : pageId);

    // Hover
    if (
      canWriteTitle
      && ev.type === 'mousemove'
      && (editor.lastPageCursorIsInside?._id !== pageId || editor.selectedPage)
      && !editor.isDragging && !editor.isRotating && !editor.isResizing && !editor.isPanning
    ) {
      editor.lastPageCursorIsInside = editor.currentPages.find(p => p._id === pageId) ?? null;
      hoveringPage();
    }

    // Zoomimg and panning
    if (ev.type === 'wheel') {
      ev.preventDefault();
      
      const wev = ev as WheelEvent;
      const rect = el.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;

      // Zooming: pinch OR ctrl/cmd + wheel
      if (ev.ctrlKey || ev.metaKey) {
        const factor = Math.exp(-wev.deltaY * editor.zoomFactor);
        editor.setZoomAt(sx, sy, editor.viewport.scale * factor);
        this.trackWheelZoom(wev.deltaY);
        if (canWriteTitle) hoveringPage();
      }

      // Panning: two-figer touch OR wheel
      if (editor.viewport.scale > 1 && !(ev.ctrlKey || ev.metaKey)) {
        editor.panBy(-wev.deltaX, -wev.deltaY);
        if (canWriteTitle) hoveringPage();
      }
    }

    // Assign cursor
    if (canWriteTitle) {
      editor.cursor = insidePage ? (editor.selectedPage?._id === hitPage?._id ? this.moveCursor : this.pointerCursor) : 'initial';

      if ((ev.type === 'mousedown' && btn === 1) || editor.isPanning) {
        editor.cursor = 'grabbing';
      } else if (hitPage && hitPage === editor.selectedPage) {
        if (hit.area === 'inside') {
          editor.cursor = hitPage && editor.selectedPage?._id === hitPage._id
            ? this.moveCursor
            : this.pointerCursor;
        } else if (hit.area === 'edge' && hit.edgeOrientation && hitPage) {
          editor.cursor = this.getEdgeCursor(hitPage.angle, hit.edgeOrientation);
        } else if (hit.area === 'corner' && hit.corner && hitPage) {
          editor.cursor = this.getCornerCursor(hitPage.angle, hit.corner);
        } else if (hit.area === 'rotate') {
          if (hit.corner === 'ne') editor.cursor = this.rotateCursorTopRight;
          if (hit.corner === 'nw') editor.cursor = this.rotateCursorTopLeft;
          if (hit.corner === 'se') editor.cursor = this.rotateCursorBottomRight;
          if (hit.corner === 'sw') editor.cursor = this.rotateCursorBottomLeft;
        }
      }

      el.style.cursor = editor.cursor;
    }

    // Click
    if (canWriteTitle && ev.type === 'mousedown' && btn === 0) {
      if (editor.pageWasEdited && (editor.cursor === 'initial' || editor.cursor === this.pointerCursor)) {
        editor.updateCurrentPagesWithEdited();
      }
      editor.isRotating = false;
      editor.lastSelectedPage = editor.selectedPage;
      editor.selectedPage = hitPage;
      editor.clickedDiffPage = editor.lastSelectedPage && editor.selectedPage && editor.lastSelectedPage !== editor.selectedPage;
      editor.lastPageCursorIsInside = hitPage;
      editor.redrawAllPages();
      editor.mainImageItem.set({ ...editor.mainImageItem(), url: editor.c.toDataURL('image/jpeg') });
      editor.hoveringPage(hitPage?._id ?? '');
      // Don't return here to enable other mousedown interactions
    }

    // Panning
    {
      if (ev.type === 'mousedown' && btn === 1 && editor.viewport.scale > 1) {
        editor.isPanning = true;
        editor.panPrevX = (ev as MouseEvent).clientX;
        editor.panPrevY = (ev as MouseEvent).clientY;
        return;
      }

      if (ev.type === 'mousemove' && editor.isPanning) {
        const dx = (ev as MouseEvent).clientX - editor.panPrevX;
        const dy = (ev as MouseEvent).clientY - editor.panPrevY;
        editor.panPrevX = (ev as MouseEvent).clientX;
        editor.panPrevY = (ev as MouseEvent).clientY;

        editor.panBy(dx, dy);
        return;
      }

      if (ev.type === 'mouseup' && editor.isPanning) {
        editor.isPanning = false;
        hoveringPage();
        el.style.cursor = insidePage ? (editor.selectedPage?._id === hitPage?._id ? this.moveCursor : this.pointerCursor) : 'initial';
        editor.mainImageItem.set({ ...editor.mainImageItem(), url: editor.c.toDataURL('image/jpeg') });
        return;
      }
    }

    // Drag
    if (canWriteTitle && hit.area === 'inside' || editor.isDragging) {
      if (ev.type === 'mousedown' && btn === 0 && hitPage) {
        editor.isDragging = true;
        editor.dragStartMouse = this.getMousePos(ev);
        editor.dragStartPage = structuredClone(hitPage);
        return;
      }

      if (editor.isDragging) {
        if (ev.type === 'mousemove') {
          el.style.cursor = this.moveCursor;
          this.dragPage(ev);
          return;
        }

        if (ev.type === 'mouseup') {
          const moved = this.mouseMovedSince(editor.dragStartMouse, ev);
          editor.isDragging = false;
          editor.dragStartPage = null;
          if (moved) this.telemetry.track('mouse_action', { action: 'move_page' });

          if (!editor.imgWasEdited()) return;
          if (hitPage) editor.hoveringPage(hitPage._id);
          editor.redrawAllPages();
          editor.mainImageItem.set({ ...editor.mainImageItem(), url: editor.c.toDataURL('image/jpeg') });
          return;
        }
      }
    }

    // Rotate
    {
      if (ev.type === 'mousedown' && btn === 0 && hit.area === 'rotate' && hitPage) {
        editor.startHit = hit;

        const { centerX, centerY } = editor.getPageRectPx(hitPage);
        const mouse = this.getMousePos(ev);
        if (!mouse) return;

        const dx = mouse.x - centerX;
        const dy = mouse.y - centerY;

        editor.rotationStartMouseAngle = Math.atan2(dy, dx);
        editor.rotationStartPage = editor.selectedPage;
        editor.isRotating = true;
        return;
      }

      if (editor.isRotating) {
        if (ev.type === 'mousemove') {
          this.rotatePage(editor.cursor, ev, el);
          return;
        }

        if (ev.type === 'mouseup') {
          editor.startHit = null;
          editor.isRotating = false;
          editor.rotationStartPage = null;
          this.telemetry.track('mouse_action', { action: 'rotate_page' });
          editor.redrawAllPages();
          editor.mainImageItem.set({ ...editor.mainImageItem(), url: editor.c.toDataURL('image/jpeg') });
          return;
        }
      }
    }

    // Resize
    {
      if (ev.type === 'mousedown' && btn === 0 && (hit.area === 'edge' || hit.area === 'corner') && hitPage) {
        editor.resizeMode = hit;
        editor.resizeStartPage = editor.selectedPage;
        editor.resizeStartMouse = this.getMousePos(ev);
        editor.resizeCursor = el.style.cursor;
        return;
      }

      if (ev.type === 'mousemove' && editor.resizeMode && editor.resizeStartPage) {
        editor.isResizing = true;
        this.resizePage(ev, el);
        return;
      }

      if (ev.type === 'mouseup' && editor.resizeMode) {
        if (editor.isResizing) this.telemetry.track('mouse_action', { action: 'resize_page' });
        editor.isResizing = false;
        editor.resizeMode = null;
        editor.resizeStartPage = null;
        editor.resizeStartMouse = null;
        editor.redrawAllPages();
        editor.mainImageItem.set({ ...editor.mainImageItem(), url: editor.c.toDataURL('image/jpeg') });
        return;
      }
    }
  }

  
  // ========== PAGE LOGIC ==========
  private pageIdCursorInside(e: MouseEvent): string {
    const editor = this.editor;
    const pos = this.getMousePos(e);
    editor.mousePos = pos;
    if (!pos) return '';

    return editor.pageIdCursorInside();
  }

  private hitTest(e: MouseEvent): HitInfo {
    const pos = this.getMousePos(e);
    if (!pos) return { area: 'none' };

    const editor = this.editor;
    const pages = editor.currentPages;

    if (editor.selectedPage) {
      const page = editor.isShiftActive && editor.currentPages.length === editor.maxPages
        ? editor.currentPages.find(p => p._id !== editor.selectedPage?._id) ?? editor.selectedPage
        : editor.selectedPage;
      const hit = this.hitTestPage(pos.x, pos.y, page);
      if (hit.area !== 'none') return hit;
    }

    const candidatePages = pages.filter(p => p !== editor.selectedPage);
    const hits = candidatePages
      .map(p => this.hitTestPage(pos.x, pos.y, p))
      .filter(hit => hit.area !== 'none');
    const index = hits.length <= 1 ? 0 : (editor.isShiftActive ? 1 : 0);

    return hits[index] ?? { area: 'none' };
  }

  private hitTestPage(x: number, y: number, p: Page): HitInfo {
    const editor = this.editor;
    return hitTestPageGeometry(x, y, p, editor.getPageRectPx(p), {
      edgeHitTolerance: this.edgeHitTolerance,
      cornerHitTolerance: this.cornerHitTolerance,
      rotateHandleOffset: this.rotateHandleOffset,
      rotateHitTolerance: this.rotateHitTolerance,
      cornerSize: editor.cornerSize
    });
  }

  private getEdgeCursor(angleDeg: number, local: EdgeLocalOrientation): string {
    let a = angleDeg % 180;
    if (a < 0) a += 180;

    const mostlyHorizontal = a <= 45 || a >= 135;

    if (local === 'vertical') {
      return mostlyHorizontal ? this.horizontalEdgeCursor : this.verticalEdgeCursor;
    } else {
      return mostlyHorizontal ? this.verticalEdgeCursor : this.horizontalEdgeCursor;
    }
  }

  private getCornerCursor(angleDeg: number, corner: CornerName): string {
    let a = angleDeg % 180;
    if (a < 0) a += 180;

    const userCorner = localCornerToUserCorner(corner, angleDeg);

    const baseForCorner =
      userCorner === 'nw' || userCorner === 'se'
        ? this.diagonalTlbrCursor
        : this.diagonalBltrCursor;

    const flippedForCorner =
      baseForCorner === this.diagonalTlbrCursor ? this.diagonalBltrCursor : this.diagonalTlbrCursor;

    const flip = a >= 45 && a <= 135;
    return flip ? flippedForCorner : baseForCorner;
  }

  private getMousePos(e: MouseEvent): { x: number; y: number } | null {
    const editor = this.editor;

    const rect = editor.c.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const { x, y, scale } = editor.viewport;

    // Invert the viewport transform: screen = world * scale + (x,y)  =>  world = (screen - (x,y)) / scale
    return {
      x: (localX - x) / scale,
      y: (localY - y) / scale,
    };
  }

  private dragPage(e: MouseEvent): void {    
    const editor = this.editor;
    if (!editor.selectedPage) return;

    const { width, height } = editor.imageRect;
    const start = editor.dragStartPage;
    const mousePos = this.getMousePos(e);
    if (!start || !mousePos || !editor.dragStartMouse) return;
    const page = editor.selectedPage;

    const dx = (mousePos.x - editor.dragStartMouse.x) / width;
    const dy = (mousePos.y - editor.dragStartMouse.y) / height;

    let newCx = start.xc + dx;
    let newCy = start.yc + dy;
    let newLeft = start.left + dx;
    let newRight = start.right + dx;
    let newTop = start.top + dy;
    let newBottom = start.bottom + dy;

    if (newLeft < 0) {
      newCx += -newLeft;
      newRight += -newLeft;
      newLeft = 0;
    }
    if (newRight > 1) {
      newCx -= newRight - 1;
      newLeft -= newRight - 1;
      newRight = 1;
    }
    if (newTop < 0) {
      newCy += -newTop;
      newBottom += -newTop;
      newTop = 0;
    }
    if (newBottom > 1) {
      newCy -= newBottom - 1;
      newTop -= newBottom - 1;
      newBottom = 1;
    }

    const updatedPage: Page = {
      ...page,
      xc: newCx,
      yc: newCy,
      left: newLeft,
      right: newRight,
      top: newTop,
      bottom: newBottom,
    };

    editor.selectedPage = updatedPage;
    editor.lastSelectedPage = updatedPage;
    editor.currentPages = editor.currentPages.map(p =>
      p._id === updatedPage._id ? updatedPage : p
    );

    editor.pageWasEdited = true;
    editor.imgWasEdited.set(true);
    editor.sthWasEdited = true;
    editor.redrawAllPages();
  }

  private rotatePage(cursor: string, ev: MouseEvent, el: HTMLElement): void {
    const editor = this.editor;
    if (!editor.rotationStartPage) return;

    if (editor.startHit?.corner === 'ne') cursor = this.rotateCursorTopRight;
    if (editor.startHit?.corner === 'nw') cursor = this.rotateCursorTopLeft;
    if (editor.startHit?.corner === 'se') cursor = this.rotateCursorBottomRight;
    if (editor.startHit?.corner === 'sw') cursor = this.rotateCursorBottomLeft;
    el.style.cursor = cursor;
    
    const startPage = editor.rotationStartPage;

    const { centerX, centerY } = editor.getPageRectPx(startPage);
    const mouse = this.getMousePos(ev);
    if (!mouse) return;

    const dx = mouse.x - centerX;
    const dy = mouse.y - centerY;

    const currentMouseAngle = Math.atan2(dy, dx);

    let delta = currentMouseAngle - editor.rotationStartMouseAngle;

    let proposedAngle = startPage.angle + radianToDegree(delta);
    proposedAngle = clamp(proposedAngle, -45, 45);
    editor.rotationDirection = Math.sign((proposedAngle - startPage.angle) || proposedAngle);

    const canRotate = (angle: number) => {
      const bounds = editor.computeBounds(startPage.xc, startPage.yc, startPage.width, startPage.height, angle);
      return bounds.left >= 0 && bounds.right <= 1 && bounds.top >= 0 && bounds.bottom <= 1;
    }

    if (!canRotate(proposedAngle)) {
      const step = (proposedAngle - startPage.angle) > 0 ? editor.incrementAngle : -editor.incrementAngle;

      let temp = startPage.angle;
      while (canRotate(temp + step)) temp += step;

      proposedAngle = temp;
    }

    // Build updated page
    if (!editor.selectedPage) return;

    const bounds = editor.computeBounds(startPage.xc, startPage.yc, startPage.width, startPage.height, proposedAngle);
    const updatedPage: Page = {
      ...editor.selectedPage,
      angle: proposedAngle,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    };

    // Update state
    editor.selectedPage = updatedPage;
    editor.lastSelectedPage = updatedPage;
    editor.currentPages = editor.currentPages.map(p =>
      p._id === updatedPage._id ? updatedPage : p
    );

    editor.pageWasEdited = true;
    editor.imgWasEdited.set(true);
    editor.sthWasEdited = true;
    editor.redrawAllPages();
  }

  private resizePage(ev: MouseEvent, el: HTMLElement): void {
    const editor = this.editor;
    const mode = editor.resizeMode;
    const startPage = editor.resizeStartPage;
    if (!mode || !startPage) return;

    el.style.cursor = editor.resizeCursor;

    const updated = structuredClone(startPage);
    
    if (mode.area === 'edge') {
      this.applyEdgeResize(updated, startPage, mode.edgeSide!, ev);
    }

    if (mode.area === 'corner') {
      this.applyCornerResize(updated, startPage, mode.corner!, ev);
    }

    editor.pageWasEdited = true;
    editor.imgWasEdited.set(true);
    editor.sthWasEdited = true;
  }

  private applyEdgeResize(p: Page, start: Page, userSide: EdgeSide, ev: MouseEvent) {
    const rect = this.editor.imageRect;
    const cw = rect.width;
    const ch = rect.height;
    const ratio = cw / ch;
    const inverseRatio = ch / cw;

    const startMouse = this.editor.resizeStartMouse;
    const mouse = this.getMousePos(ev);
    if (!mouse || !startMouse) return;

    const mx = mouse.x - startMouse.x;
    const my = mouse.y - startMouse.y;

    let newWidth = start.width;
    let newHeight = start.height;
    let newLeft = start.left;
    let newRight = start.right;
    let newTop = start.top;
    let newBottom = start.bottom;
    let newXc = start.xc;
    let newYc = start.yc;

    if ([0, -180, 90, -90].includes(start.angle)) {
      const dx = mx / cw;
      const dy = my / ch;
      
      if (userSide === 'left' || userSide === 'right') {
        if (userSide === 'right') {
          newRight = start.right + dx;
          if (newRight < newLeft) newRight = start.left;
        } else {
          newLeft = start.left + dx;
          if (newRight < newLeft) newLeft = start.right;
        }

        if ([0, -180].includes(start.angle)) {
          newWidth = newRight - newLeft;
          if (newWidth < 0) newWidth = 0;
          if (userSide === 'right' && start.angle === 0 && newWidth > 1 - start.left) {
            newWidth = 1 - start.left;
            newRight = 1;
          }
          if (userSide === 'left' && start.angle === 0 && newWidth > start.right) {
            newWidth = start.right;
            newLeft = 0;
          }
          if (userSide === 'left' && start.angle === -180 && newWidth > start.right) {
            newWidth = start.right;
            newLeft = 0;
          }
          if (userSide === 'right' && start.angle === -180 && newWidth > 1 - start.left) {
            newWidth = 1 - start.left;
            newRight = 1;
          }
        } else {
          newHeight = (newRight - newLeft) * ratio;
          if (newHeight < 0) newHeight = 0;
          if (userSide === 'right' && start.angle === 90 && newHeight * inverseRatio > 1 - start.left) {
            newHeight = (1 - start.left) * ratio;
            newRight = 1;
          }
          if (userSide === 'left' && start.angle === 90 && newHeight * inverseRatio > start.right) {
            newHeight = start.right * ratio;
            newLeft = 0;
          }
          if (userSide === 'left' && start.angle === -90 && newHeight * inverseRatio > start.right) {
            newHeight = start.right * ratio;
            newLeft = 0;
          }
          if (userSide === 'right' && start.angle === -90 && newHeight * inverseRatio > 1 - start.left) {
            newHeight = (1 - start.left) * ratio;
            newRight = 1;
          }
        }
        newXc = (newLeft + newRight) / 2;
      }

      if (userSide === 'top' || userSide === 'bottom') {
        if (userSide === 'bottom') {
          newBottom = start.bottom + dy;
          if (newBottom < newTop) newBottom = start.top;
        } else {
          newTop = start.top + dy;
          if (newBottom < newTop) newTop = start.bottom;
        }

        if ([0, -180].includes(start.angle)) {
          newHeight = newBottom - newTop;
          if (newHeight < 0) newHeight = 0;
          if (userSide === 'bottom' && start.angle === 0 && newHeight > 1 - start.top) {
            newHeight = 1 - start.top;
            newBottom = 1;
          }
          if (userSide === 'top' && start.angle === 0 && newHeight > start.bottom) {
            newHeight = start.bottom;
            newTop = 0;
          }
          if (userSide === 'top' && start.angle === -180 && newHeight > start.bottom) {
            newHeight = start.bottom;
            newTop = 0;
          }
          if (userSide === 'bottom' && start.angle === -180 && newHeight > 1 - start.top) {
            newHeight = 1 - start.top;
            newBottom = 1;
          }
        } else {
          newWidth = (newBottom - newTop) * inverseRatio;
          if (newWidth < 0) newWidth = 0;
          if (userSide === 'bottom' && start.angle === 90 && newWidth * ratio > 1 - start.top) {
            newWidth = (1 - start.top) * inverseRatio;
            newBottom = 1;
          }
          if (userSide === 'top' && start.angle === 90 && newWidth * ratio > start.bottom) {
            newWidth = start.bottom * inverseRatio;
            newTop = 0;
          }
          if (userSide === 'top' && start.angle === -90 && newWidth * ratio > start.bottom) {
            newWidth = start.bottom * inverseRatio;
            newTop = 0;
          }
          if (userSide === 'bottom' && start.angle === -90 && newWidth * ratio > 1 - start.top) {
            newWidth = (1 - start.top) * inverseRatio;
            newBottom = 1;
          }
        }
        newYc = (newTop + newBottom) / 2;
      }
    }

    // 0-90 degrees
    if (start.angle > 0 && start.angle < 90) {
      const rad = degreeToRadian(start.angle);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      if (
        (start.angle > 0 && start.angle <= 45 && userSide === 'right')
        || (start.angle > 45 && start.angle < 90 && userSide === 'bottom')
      ) {
        const hypot = mx * cos + my * sin;
        const dx = cos * hypot / cw;
        const dy = sin * hypot / ch;

        newWidth = start.width + hypot / cw;
        newRight = start.right + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newRight = start.right - cos * start.width;
          newBottom = start.bottom - sin * start.width * ratio;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newRight > 1) {
          newRight = 1;
          newWidth = start.width + (1 - start.right) / cos;
          newBottom = start.bottom + (newWidth - start.width) * sin * ratio;
          newXc = start.xc + (cos * (newWidth - start.width)) / 2;
          newYc = start.yc + ((newWidth - start.width) * sin * ratio) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newWidth = start.width + (1 - start.bottom) * inverseRatio / sin;
          newRight = start.right + (newWidth - start.width) * cos;
          newXc = start.xc + (cos * (newWidth - start.width)) / 2;
          newYc = start.yc + ((newWidth - start.width) * sin * ratio) / 2;
        }
      }

      if (
        (start.angle > 0 && start.angle <= 45 && userSide === 'bottom')
        || (start.angle > 45 && start.angle < 90 && userSide === 'left')
      ) {
        const hypot = mx * (-sin) + my * cos;
        const dx = (-sin) * hypot / cw;
        const dy = cos * hypot / ch;

        newHeight = start.height + hypot / ch;
        newLeft = start.left + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newLeft = start.left + sin * start.height * inverseRatio;
          newBottom = start.bottom - cos * start.height;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newHeight = start.height + start.left / sin * ratio;
          newBottom = start.bottom + (newHeight - start.height) * cos;
          newXc = start.xc - (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * cos) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newHeight = start.height + (1 - start.bottom) / cos;
          newLeft = start.left - (newHeight - start.height) * sin * inverseRatio;
          newXc = start.xc - (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * cos) / 2;
        }
      }

      if (
        (start.angle > 0 && start.angle <= 45 && userSide === 'left')
        || (start.angle > 45 && start.angle < 90 && userSide === 'top')
      ) {
        const hypot = mx * cos + my * sin;
        const dx = cos * hypot / cw;
        const dy = sin * hypot / ch;

        newWidth = start.width - hypot / cw;
        newLeft = start.left + dx;
        newTop = start.top + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newLeft = start.left + cos * start.width;
          newTop = start.top + sin * start.width * ratio;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newWidth = start.width + start.left / cos;
          newTop = start.top - (newWidth - start.width) * sin * ratio;
          newXc = start.xc - (cos * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * sin * ratio) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newWidth = start.width + start.top * inverseRatio / sin;
          newLeft = start.left - (newWidth - start.width) * cos;
          newXc = start.xc - (cos * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * sin * ratio) / 2;
        }
      }

      if (
        (start.angle > 0 && start.angle <= 45 && userSide === 'top')
        || (start.angle > 45 && start.angle < 90 && userSide === 'right')
      ) {
        const hypot = mx * (-sin) + my * cos;
        const dx = (-sin) * -hypot / cw;
        const dy = cos * -hypot / ch;

        newHeight = start.height - hypot / ch;
        newRight = start.right - dx;
        newTop = start.top - dy;
        newXc = start.xc - dx / 2;
        newYc = start.yc - dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newRight = start.right - sin * start.height * inverseRatio;
          newTop = start.top + cos * start.height;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newRight > 1) {
          newRight = 1;
          newHeight = start.height + (1 - start.right) / sin * ratio;
          newTop = start.top - (newHeight - start.height) * cos;
          newXc = start.xc + (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * cos) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newHeight = start.height + start.top / cos;
          newRight = start.right + (newHeight - start.height) * sin * inverseRatio;
          newXc = start.xc + (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * cos) / 2;
        }
      }
    }

    // 90-180 degrees
    if (start.angle > 90 && start.angle < 180) {
      const rad = degreeToRadian(start.angle - 90);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      if (
        (start.angle > 90 && start.angle <= 135 && userSide === 'right')
        || (start.angle > 135 && start.angle < 180 && userSide === 'bottom')
      ) {
        const hypot = mx * cos + my * sin;
        const dx = cos * hypot / cw;
        const dy = sin * hypot / ch;

        newHeight = start.height + hypot / ch;
        newRight = start.right + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newRight = start.right - cos * start.height * inverseRatio;
          newBottom = start.bottom - sin * start.height;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newRight > 1) {
          newRight = 1;
          newHeight = start.height + (1 - start.right) / cos * ratio;
          newBottom = start.bottom + (newHeight - start.height) * sin;
          newXc = start.xc + (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * sin) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newHeight = start.height + (1 - start.bottom) / sin;
          newRight = start.right + (newHeight - start.height) * cos * inverseRatio;
          newXc = start.xc + (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * sin) / 2;
        }
      }

      if (
        (start.angle > 90 && start.angle <= 135 && userSide === 'bottom')
        || (start.angle > 135 && start.angle < 180 && userSide === 'left')
      ) {
        const hypot = mx * (-sin) + my * cos;
        const dx = (-sin) * hypot / cw;
        const dy = cos * hypot / ch;

        newWidth = start.width + hypot / cw;
        newLeft = start.left + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newLeft = start.left + sin * start.width;
          newBottom = start.bottom - cos * start.width * ratio;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newWidth = start.width + start.left / sin;
          newBottom = start.bottom + (newWidth - start.width) * cos;
          newXc = start.xc - sin * (newWidth - start.width) / 2;
          newYc = start.yc + ((newWidth - start.width) * cos * ratio) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newWidth = start.width + (1 - start.bottom) / cos * inverseRatio;
          newLeft = start.left - (newWidth - start.width) * sin;
          newXc = start.xc - sin * (newWidth - start.width) / 2;
          newYc = start.yc + ((newWidth - start.width) * cos * ratio) / 2;
        }
      }

      if (
        (start.angle > 90 && start.angle <= 135 && userSide === 'left')
        || (start.angle > 135 && start.angle < 180 && userSide === 'top')
      ) {
        const hypot = mx * cos + my * sin;
        const dx = cos * hypot / cw;
        const dy = sin * hypot / ch;

        newHeight = start.height - hypot / ch;
        newLeft = start.left + dx;
        newTop = start.top + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newLeft = start.left + cos * start.height * inverseRatio;
          newTop = start.top + sin * start.height;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newHeight = start.height + start.left / cos * ratio;
          newTop = start.top - (newHeight - start.height) * sin;
          newXc = start.xc - (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * sin) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newHeight = start.height + start.top / sin;
          newLeft = start.left - (newHeight - start.height) * cos * inverseRatio;
          newXc = start.xc - (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * sin) / 2;
        }
      }

      if (
        (start.angle > 90 && start.angle <= 135 && userSide === 'top')
        || (start.angle > 135 && start.angle < 180 && userSide === 'right')
      ) {
        const hypot = mx * (-sin) + my * cos;
        const dx = (-sin) * -hypot / cw;
        const dy = cos * -hypot / ch;

        newWidth = start.width - hypot / cw;
        newRight = start.right - dx;
        newTop = start.top - dy;
        newXc = start.xc - dx / 2;
        newYc = start.yc - dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newRight = start.right - sin * start.width;
          newTop = start.top + cos * start.width * ratio;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newRight > 1) {
          newRight = 1;
          newWidth = start.width + (1 - start.right) / sin;
          newTop = start.top - (newWidth - start.width) * cos * ratio;
          newXc = start.xc + (sin * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * cos * ratio) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newWidth = start.width + start.top / cos * inverseRatio;
          newRight = start.right + (newWidth - start.width) * sin;
          newXc = start.xc + (sin * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * cos * ratio) / 2;
        }
      }
    }

    // -180 - -90 degrees
    if (start.angle > -180 && start.angle < -90) {
      const rad = degreeToRadian(-start.angle - 90);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      if (
        (start.angle > -180 && start.angle <= -135 && userSide === 'right')
        || (start.angle > -135 && start.angle < -90 && userSide === 'bottom')
      ) {
        const hypot = mx * sin + my * cos;
        const dx = sin * hypot / cw;
        const dy = cos * hypot / ch;

        newWidth = start.width + hypot / cw;
        newRight = start.right + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newRight = start.right - sin * start.width;
          newBottom = start.bottom - cos * start.width * ratio;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newRight > 1) {
          newRight = 1;
          newWidth = start.width + (1 - start.right) / sin;
          newBottom = start.bottom + (newWidth - start.width) * cos * ratio;
          newXc = start.xc + (sin * (newWidth - start.width)) / 2;
          newYc = start.yc + ((newWidth - start.width) * cos * ratio) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newWidth = start.width + (1 - start.bottom) * inverseRatio / cos;
          newRight = start.right + (newWidth - start.width) * sin;
          newXc = start.xc + (sin * (newWidth - start.width)) / 2;
          newYc = start.yc + ((newWidth - start.width) * cos * ratio) / 2;
        }
      }

      if (
        (start.angle > -180 && start.angle <= -135 && userSide === 'bottom')
        || (start.angle > -135 && start.angle < -90 && userSide === 'left')
      ) {
        const hypot = mx * (-cos) + my * sin;
        const dx = (-cos) * hypot / cw;
        const dy = sin * hypot / ch;

        newHeight = start.height + hypot / ch;
        newLeft = start.left + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newLeft = start.left + cos * start.height * inverseRatio;
          newBottom = start.bottom - sin * start.height;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newHeight = start.height + start.left / cos * ratio;
          newBottom = start.bottom + (newHeight - start.height) * sin;
          newXc = start.xc - (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * sin) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newHeight = start.height + (1 - start.bottom) / sin;
          newLeft = start.left - (newHeight - start.height) * cos * inverseRatio;
          newXc = start.xc - (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * sin) / 2;
        }
      }

      if (
        (start.angle > -180 && start.angle <= -135 && userSide === 'left')
        || (start.angle > -135 && start.angle < -90 && userSide === 'top')
      ) {
        const hypot = mx * sin + my * cos;
        const dx = sin * hypot / cw;
        const dy = cos * hypot / ch;

        newWidth = start.width - hypot / cw;
        newLeft = start.left + dx;
        newTop = start.top + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newLeft = start.left + sin * start.width;
          newTop = start.top + cos * start.width * ratio;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newWidth = start.width + start.left / sin;
          newTop = start.top - (newWidth - start.width) * cos * ratio;
          newXc = start.xc - (sin * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * cos * ratio) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newWidth = start.width + start.top * inverseRatio / cos;
          newLeft = start.left - (newWidth - start.width) * sin;
          newXc = start.xc - (sin * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * cos * ratio) / 2;
        }
      }

      if (
        (start.angle > -180 && start.angle <= -135 && userSide === 'top')
        || (start.angle > -135 && start.angle < -90 && userSide === 'right')
      ) {
        const hypot = mx * (-cos) + my * sin;
        const dx = (-cos) * -hypot / cw;
        const dy = sin * -hypot / ch;

        newHeight = start.height - hypot / ch;
        newRight = start.right - dx;
        newTop = start.top - dy;
        newXc = start.xc - dx / 2;
        newYc = start.yc - dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newRight = start.right - cos * start.height * inverseRatio;
          newTop = start.top + sin * start.height;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newRight > 1) {
          newRight = 1;
          newHeight = start.height + (1 - start.right) / cos * ratio;
          newTop = start.top - (newHeight - start.height) * sin;
          newXc = start.xc + (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * sin) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newHeight = start.height + start.top / sin;
          newRight = start.right + (newHeight - start.height) * cos * inverseRatio;
          newXc = start.xc + (cos * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * sin) / 2;
        }
      }
    }

    // -90-0 degrees
    if (start.angle > -90 && start.angle < 0) {
      const rad = degreeToRadian(-start.angle);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      if (
        (start.angle > -90 && start.angle < -45 && userSide === 'right')
        || (start.angle >= -45 && start.angle < 0 && userSide === 'bottom')
      ) {
        const hypot = mx * sin + my * cos;
        const dx = sin * hypot / cw;
        const dy = cos * hypot / ch;

        newHeight = start.height + hypot / ch;
        newRight = start.right + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newRight = start.right - sin * start.height * inverseRatio;
          newBottom = start.bottom - cos * start.height;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newRight > 1) {
          newRight = 1;
          newHeight = start.height + (1 - start.right) / sin * ratio;
          newBottom = start.bottom + (newHeight - start.height) * cos;
          newXc = start.xc + (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * cos) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newHeight = start.height + (1 - start.bottom) / cos;
          newRight = start.right + (newHeight - start.height) * sin * inverseRatio;
          newXc = start.xc + (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc + ((newHeight - start.height) * cos) / 2;
        }
      }

      if (
        (start.angle > -90 && start.angle < -45 && userSide === 'bottom')
        || (start.angle >= -45 && start.angle < 0 && userSide === 'left')
      ) {
        const hypot = mx * (-cos) + my * sin;
        const dx = (-cos) * hypot / cw;
        const dy = sin * hypot / ch;

        newWidth = start.width + hypot / cw;
        newLeft = start.left + dx;
        newBottom = start.bottom + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newLeft = start.left + cos * start.width;
          newBottom = start.bottom - sin * start.width * ratio;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (newBottom - start.top) / 2 + start.top;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newWidth = start.width + start.left / cos;
          newBottom = start.bottom + (newWidth - start.width) * sin;
          newXc = start.xc - cos * (newWidth - start.width) / 2;
          newYc = start.yc + ((newWidth - start.width) * sin * ratio) / 2;
        }

        if (newBottom > 1) {
          newBottom = 1;
          newWidth = start.width + (1 - start.bottom) / sin * inverseRatio;
          newLeft = start.left - (newWidth - start.width) * cos;
          newXc = start.xc - cos * (newWidth - start.width) / 2;
          newYc = start.yc + ((newWidth - start.width) * sin * ratio) / 2;
        }
      }

      if (
        (start.angle > -90 && start.angle < -45 && userSide === 'left')
        || (start.angle >= -45 && start.angle < 0 && userSide === 'top')
      ) {
        const hypot = mx * sin + my * cos;
        const dx = sin * hypot / cw;
        const dy = cos * hypot / ch;

        newHeight = start.height - hypot / ch;
        newLeft = start.left + dx;
        newTop = start.top + dy;
        newXc = start.xc + dx / 2;
        newYc = start.yc + dy / 2;

        if (newHeight < 0) {
          newHeight = 0;
          newLeft = start.left + sin * start.height * inverseRatio;
          newTop = start.top + cos * start.height;
          newXc = (start.right - newLeft) / 2 + newLeft;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newLeft < 0) {
          newLeft = 0;
          newHeight = start.height + start.left / sin * ratio;
          newTop = start.top - (newHeight - start.height) * cos;
          newXc = start.xc - (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * cos) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newHeight = start.height + start.top / cos;
          newLeft = start.left - (newHeight - start.height) * sin * inverseRatio;
          newXc = start.xc - (sin * (newHeight - start.height) * inverseRatio) / 2;
          newYc = start.yc - ((newHeight - start.height) * cos) / 2;
        }
      }

      if (
        (start.angle > -90 && start.angle < -45 && userSide === 'top')
        || (start.angle >= -45 && start.angle < 0 && userSide === 'right')
      ) {
        const hypot = mx * (-cos) + my * sin;
        const dx = (-cos) * -hypot / cw;
        const dy = sin * -hypot / ch;

        newWidth = start.width - hypot / cw;
        newRight = start.right - dx;
        newTop = start.top - dy;
        newXc = start.xc - dx / 2;
        newYc = start.yc - dy / 2;

        if (newWidth < 0) {
          newWidth = 0;
          newRight = start.right - cos * start.width;
          newTop = start.top + sin * start.width * ratio;
          newXc = (newRight - start.left) / 2 + start.left;
          newYc = (start.bottom - newTop) / 2 + newTop;
        }

        if (newRight > 1) {
          newRight = 1;
          newWidth = start.width + (1 - start.right) / cos;
          newTop = start.top - (newWidth - start.width) * sin * ratio;
          newXc = start.xc + (cos * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * sin * ratio) / 2;
        }

        if (newTop < 0) {
          newTop = 0;
          newWidth = start.width + start.top / sin * inverseRatio;
          newRight = start.right + (newWidth - start.width) * cos;
          newXc = start.xc + (cos * (newWidth - start.width)) / 2;
          newYc = start.yc - ((newWidth - start.width) * sin * ratio) / 2;
        }
      }
    }

    p.width = newWidth;
    p.height = newHeight;
    p.left = newLeft;
    p.right = newRight;
    p.top = newTop;
    p.bottom = newBottom;
    p.xc = newXc;
    p.yc = newYc;

    const editor = this.editor;
    editor.selectedPage = p;
    editor.currentPages = editor.currentPages.map(page => page._id === p._id ? p : page);
    editor.redrawAllPages();
  }

  private applyCornerResize(p: Page, start: Page, userCorner: CornerName, ev: MouseEvent) {
    const rect = this.editor.imageRect;
    const cw = rect.width;
    const ch = rect.height;
    const ratio = cw / ch;
    const inverseRatio = ch / cw;
    
    const startMouse = this.editor.resizeStartMouse;
    const mouse = this.getMousePos(ev);
    if (!mouse || !startMouse) return;

    const mx = mouse.x - startMouse.x;
    const my = mouse.y - startMouse.y;

    let newWidth = start.width;
    let newHeight = start.height;
    let newLeft = start.left;
    let newRight = start.right;
    let newTop = start.top;
    let newBottom = start.bottom;
    let newXc = start.xc;
    let newYc = start.yc;

    if ([0, -180, 90, -90].includes(start.angle)) {
      const dx = mx / cw;
      const dy = my / ch;

      if (userCorner.includes('e') || userCorner.includes('w')) {
        if (userCorner.includes('e')) {
          newRight = start.right + dx;
          if (newRight < newLeft) newRight = start.left;
        } else if (userCorner.includes('w')) {
          newLeft = start.left + dx;
          if (newRight < newLeft) newLeft = start.right;
        }

        if ([0, -180].includes(start.angle)) {
          newWidth = newRight - newLeft;
          if (newWidth < 0) newWidth = 0;
          if (userCorner.includes('e') && start.angle === 0 && newWidth > 1 - start.left) {
            newWidth = 1 - start.left;
            newRight = 1;
          }
          if (userCorner.includes('w') && start.angle === 0 && newWidth > start.right) {
            newWidth = start.right;
            newLeft = 0;
          }
          if (userCorner.includes('w') && start.angle === -180 && newWidth > start.right) {
            newWidth = start.right;
            newLeft = 0;
          }
          if (userCorner.includes('e') && start.angle === -180 && newWidth > 1 - start.left) {
            newWidth = 1 - start.left;
            newRight = 1;
          }
        } else {
          newHeight = (newRight - newLeft) * ratio;
          if (newHeight < 0) newHeight = 0;
          if (userCorner.includes('e') && start.angle === 90 && newHeight * inverseRatio > 1 - start.left) {
            newHeight = (1 - start.left) * ratio;
            newRight = 1;
          }
          if (userCorner.includes('w') && start.angle === 90 && newHeight * inverseRatio > start.right) {
            newHeight = start.right * ratio;
            newLeft = 0;
          }
          if (userCorner.includes('w') && start.angle === -90 && newHeight * inverseRatio > start.right) {
            newHeight = start.right * ratio;
            newLeft = 0;
          }
          if (userCorner.includes('e') && start.angle === -90 && newHeight * inverseRatio > 1 - start.left) {
            newHeight = (1 - start.left) * ratio;
            newRight = 1;
          }
        }
        newXc = (newLeft + newRight) / 2;
      }

      if (userCorner.includes('n') || userCorner.includes('s')) {
        if (userCorner.includes('s')) {
          newBottom = start.bottom + dy;
          if (newBottom < newTop) newBottom = start.top;
        } else if (userCorner.includes('n')) {
          newTop = start.top + dy;
          if (newBottom < newTop) newTop = start.bottom;
        }

        if ([0, -180].includes(start.angle)) {
          newHeight = newBottom - newTop;
          if (newHeight < 0) newHeight = 0;
          if (userCorner.includes('s') && start.angle === 0 && newHeight > 1 - start.top) {
            newHeight = 1 - start.top;
            newBottom = 1;
          }
          if (userCorner.includes('n') && start.angle === 0 && newHeight > start.bottom) {
            newHeight = start.bottom;
            newTop = 0;
          }
          if (userCorner.includes('n') && start.angle === -180 && newHeight > start.bottom) {
            newHeight = start.bottom;
            newTop = 0;
          }
          if (userCorner.includes('s') && start.angle === -180 && newHeight > 1 - start.top) {
            newHeight = 1 - start.top;
            newBottom = 1;
          }
        } else {
          newWidth = (newBottom - newTop) * inverseRatio;
          if (newWidth < 0) newWidth = 0;
          if (userCorner.includes('s') && start.angle === 90 && newWidth * ratio > 1 - start.top) {
            newWidth = (1 - start.top) * inverseRatio;
            newBottom = 1;
          }
          if (userCorner.includes('n') && start.angle === 90 && newWidth * ratio > start.bottom) {
            newWidth = start.bottom * inverseRatio;
            newTop = 0;
          }
          if (userCorner.includes('n') && start.angle === -90 && newWidth * ratio > start.bottom) {
            newWidth = start.bottom * inverseRatio;
            newTop = 0;
          }
          if (userCorner.includes('s') && start.angle === -90 && newWidth * ratio > 1 - start.top) {
            newWidth = (1 - start.top) * inverseRatio;
            newBottom = 1;
          }
        }
        newYc = (newTop + newBottom) / 2;
      }
    }

    // 0-90 degrees
    if (start.angle > 0 && start.angle < 90) {
      const rad = degreeToRadian(start.angle);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      if (
        (start.angle > 0 && start.angle <= 45 && userCorner === 'ne')
        || (start.angle > 45 && start.angle < 90 && userCorner === 'se')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * -hypotY / cw;
        const dyY = cos * -hypotY / ch;

        newWidth = start.width + hypotX / cw;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newHeight = start.height - hypotY / ch;
        newRight -= dxY;
        newTop = start.top - dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newRight = start.left;
          newBottom = start.bottom - sin * start.width * ratio;
          newTop = newBottom;
        } else if (newWidth < 0) {
          newWidth = 0;
          newRight = start.right - cos * start.width - sin * (start.height - newHeight) * inverseRatio;
          newBottom = start.bottom - sin * start.width * ratio;
          newTop = start.top + cos * (start.height - newHeight);
        } else if (newHeight < 0) {
          newHeight = 0;
          newRight = start.right - sin * start.height * inverseRatio - cos * (start.width - newWidth);
          newTop = start.top + cos * start.height;
          newBottom = start.bottom - sin * (start.width - newWidth) * ratio;
        }

        if (newTop < 0) {
          newTop = 0;
          const dH = start.top / cos;
          newHeight = start.height + dH;
          newRight += dxY + sin * dH * inverseRatio;
        }

        if (newBottom > 1) {
          newBottom = 1;
          const dW = (1 - start.bottom) * inverseRatio / sin;
          newWidth = start.width + dW;
          newRight -= dxX - cos * dW;
        }

        if (newRight > 1) {
          newRight = 1;
          const maxMx = Math.min((1 - start.right) * cw, mx);
          const mouseDist = Math.hypot(maxMx, my);
          const beta = Math.acos((1 - start.right) * cw / mouseDist);
          if (Math.sign(my) < 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width + mouseDist * Math.sin(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height - mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          }
          newTop = start.top - (newHeight - start.height) * cos;
          newBottom = start.bottom + (newWidth - start.width) * sin * ratio;
        }
      }

      if (
        (start.angle > 0 && start.angle <= 45 && userCorner === 'se')
        || (start.angle > 45 && start.angle < 90 && userCorner === 'sw')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * hypotY / cw;
        const dyY = cos * hypotY / ch;

        newWidth = start.width + hypotX / cw;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newHeight = start.height + hypotY / ch;
        newLeft = start.left + dxY;
        newBottom += dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newBottom = start.top;
          newLeft = start.left + sin * start.height * inverseRatio;
          newRight = newLeft;
        } else if (newWidth < 0) {
          newWidth = 0;
          newRight = start.right - cos * start.width;
          newBottom = start.bottom - sin * start.width * ratio - cos * (start.height - newHeight);
        } else if (newHeight < 0) {
          newHeight = 0;
          newRight = start.right - cos * (start.width - newWidth);
          newLeft = start.left + sin * start.height * inverseRatio;
          newBottom = start.top + sin * start.width * ratio - sin * (start.width - newWidth) * ratio;
        }

        if (newLeft < 0) {
          newLeft = 0;
          const dH = start.left / sin * ratio;
          newHeight = start.height + dH;
          newBottom -= dyY - cos * dH;
        }

        if (newRight > 1) {
          newRight = 1;
          const dW = (1 - start.right) / cos;
          newWidth = start.width + dW;
          newBottom -= dyX - sin * dW * ratio;
        }

        if (newBottom > 1) {
          newBottom = 1;
          const maxMy = Math.min((1 - start.bottom) * ch, my);
          const mouseDist = Math.hypot(maxMy, mx);
          const beta = Math.acos((1 - start.bottom) * ch / mouseDist);
          if (Math.sign(mx) > 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width - mouseDist * Math.sin(gamma) / cw;
          }
          newLeft = start.left - (newHeight - start.height) * sin * inverseRatio;
          newRight = start.right + (newWidth - start.width) * cos;
        }
      }

      if (
        (start.angle > 0 && start.angle <= 45 && userCorner === 'sw')
        || (start.angle > 45 && start.angle < 90 && userCorner === 'nw')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * hypotY / cw;
        const dyY = cos * hypotY / ch;

        newWidth = start.width - hypotX / cw;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newHeight = start.height + hypotY / ch;
        newLeft += dxY;
        newBottom = start.bottom + dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newTop = start.top + sin * start.width * ratio;
          newBottom = newTop;
          newLeft = start.right;
        } else if (newWidth < 0) {
          newWidth = 0;
          newTop = start.top + sin * start.width * ratio;
          newBottom = start.bottom - cos * (start.height - newHeight);
          newLeft = start.left + cos * start.width + sin * (start.height - newHeight) * inverseRatio;
        } else if (newHeight < 0) {
          newHeight = 0;
          newTop = start.top + sin * (start.width - newWidth) * ratio;
          newBottom = start.top + sin * start.width * ratio;
          newLeft = start.left + sin * start.height * inverseRatio + cos * (start.width - newWidth);
        }

        if (newTop < 0) {
          newTop = 0;
          const dW = start.top / sin * inverseRatio;
          newWidth = start.width + dW;
          newLeft -= dxX + cos * dW;
        }

        if (newBottom > 1) {
          newBottom = 1;
          const dH = (1 - start.bottom) / cos;
          newHeight = start.height + dH;
          newLeft -= dxY + sin * dH * inverseRatio;
        }

        if (newLeft < 0) {
          newLeft = 0;
          const maxMx = Math.min(start.left * cw, Math.abs(mx));
          const mouseDist = Math.hypot(maxMx, my);
          const beta = Math.acos(start.left * cw / mouseDist);
          if (Math.sign(my) > 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width + mouseDist * Math.sin(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height - mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          }
          newTop = start.top - (newWidth - start.width) * sin * ratio;
          newBottom = start.bottom + (newHeight - start.height) * cos;
        }
      }

      if (
        (start.angle > 0 && start.angle <= 45 && userCorner === 'nw')
        || (start.angle > 45 && start.angle < 90 && userCorner === 'ne')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * -hypotY / cw;
        const dyY = cos * -hypotY / ch;

        newWidth = start.width - hypotX / cw;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newHeight = start.height - hypotY / ch;
        newRight = start.right - dxY;
        newTop -= dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newTop = start.bottom;
          newRight = start.right - sin * start.height * inverseRatio;
          newLeft = newRight;
        } else if (newWidth < 0) {
          newWidth = 0;
          newTop = start.top + sin * start.width * ratio + cos * (start.height - newHeight);
          newLeft = start.left + cos * start.width;
          newRight = start.right - sin * (start.height - newHeight) * inverseRatio;
        } else if (newHeight < 0) {
          newHeight = 0;
          newTop = start.top + cos * start.height + sin * (start.width - newWidth) * ratio;
          newRight = start.right - sin * start.height * inverseRatio;
          newLeft = start.left + cos * (start.width - newWidth);
        }

        if (newLeft < 0) {
          newLeft = 0;
          const dW = start.left / cos;
          newWidth = start.width + dW;
          newTop -= dyX + sin * dW * ratio;
        }

        if (newRight > 1) {
          newRight = 1;
          const dH = (1 - start.right) * ratio / sin;
          newHeight = start.height + dH;
          newTop += dyY - cos * dH;
        }

        if (newTop < 0) {
          newTop = 0;
          const maxMy = Math.min(start.top * ch, Math.abs(my));
          const mouseDist = Math.hypot(maxMy, mx);
          const beta = Math.acos(start.top * ch / mouseDist);
          if (Math.sign(mx) < 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width - mouseDist * Math.sin(gamma) / cw;
          }
          newLeft = start.left - (newWidth - start.width) * cos;
          newRight = start.right + (newHeight - start.height) * sin * inverseRatio;
        }
      }
    }

    // 90-180 degrees
    if (start.angle > 90 && start.angle < 180) {
      const rad = degreeToRadian(start.angle - 90);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);


      if (
        (start.angle > 90 && start.angle <= 135 && userCorner === 'ne')
        || (start.angle > 135 && start.angle < 180 && userCorner === 'se')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * -hypotY / cw;
        const dyY = cos * -hypotY / ch;

        newHeight = start.height + hypotX / ch;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newWidth = start.width - hypotY / cw;
        newRight -= dxY;
        newTop = start.top - dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newRight > 1) {}
        if (newBottom > 1) {}
        if (newTop < 0) {}
      }

      if (
        (start.angle > 90 && start.angle <= 135 && userCorner === 'se')
        || (start.angle > 135 && start.angle < 180 && userCorner === 'sw')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * hypotY / cw;
        const dyY = cos * hypotY / ch;

        newHeight = start.height + hypotX / ch;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newWidth = start.width + hypotY / cw;
        newLeft = start.left + dxY;
        newBottom += dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newRight > 1) {}
        if (newBottom > 1) {}
        if (newLeft < 0) {}
      }

      if (
        (start.angle > 90 && start.angle <= 135 && userCorner === 'sw')
        || (start.angle > 135 && start.angle < 180 && userCorner === 'nw')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * hypotY / cw;
        const dyY = cos * hypotY / ch;

        newHeight = start.height - hypotX / ch;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newWidth = start.width + hypotY / cw;
        newLeft += dxY;
        newBottom = start.bottom + dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newTop < 0) {}
        if (newBottom > 1) {}
        if (newLeft < 0) {}
      }

      if (
        (start.angle > 90 && start.angle <= 135 && userCorner === 'nw')
        || (start.angle > 135 && start.angle < 180 && userCorner === 'ne')
      ) {
        const hypotX = mx * cos + my * sin;
        const dxX = cos * hypotX / cw;
        const dyX = sin * hypotX / ch;
        const hypotY = mx * (-sin) + my * cos;
        const dxY = (-sin) * -hypotY / cw;
        const dyY = cos * -hypotY / ch;

        newHeight = start.height - hypotX / ch;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newWidth = start.width - hypotY / cw;
        newRight = start.right - dxY;
        newTop -= dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newTop < 0) {}
        if (newRight > 1) {}
        if (newLeft < 0) {}
      }
    }

    // -180 - -90 degrees
    if (start.angle > -180 && start.angle < -90) {
      const rad = degreeToRadian(-start.angle - 90);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);


      if (
        (start.angle > -180 && start.angle <= -135 && userCorner === 'ne')
        || (start.angle > -135 && start.angle < -90 && userCorner === 'se')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * -hypotY / cw;
        const dyY = sin * -hypotY / ch;

        newWidth = start.width + hypotX / cw;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newHeight = start.height - hypotY / ch;
        newRight -= dxY;
        newTop = start.top - dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newRight > 1) {}
        if (newBottom > 1) {}
        if (newTop < 0) {}
      }

      if (
        (start.angle > -180 && start.angle <= -135 && userCorner === 'se')
        || (start.angle > -135 && start.angle < -90 && userCorner === 'sw')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * hypotY / cw;
        const dyY = sin * hypotY / ch;

        newWidth = start.width + hypotX / cw;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newHeight = start.height + hypotY / ch;
        newLeft = start.left + dxY;
        newBottom += dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newRight > 1) {}
        if (newBottom > 1) {}
        if (newLeft < 0) {}
      }

      if (
        (start.angle > -180 && start.angle <= -135 && userCorner === 'sw')
        || (start.angle > -135 && start.angle < -90 && userCorner === 'nw')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * hypotY / cw;
        const dyY = sin * hypotY / ch;

        newWidth = start.width - hypotX / cw;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newHeight = start.height + hypotY / ch;
        newLeft += dxY;
        newBottom = start.bottom + dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newTop < 0) {}
        if (newBottom > 1) {}
        if (newLeft < 0) {}
      }

      if (
        (start.angle > -180 && start.angle <= -135 && userCorner === 'nw')
        || (start.angle > -135 && start.angle < -90 && userCorner === 'ne')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * -hypotY / cw;
        const dyY = sin * -hypotY / ch;

        newWidth = start.width - hypotX / cw;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newHeight = start.height - hypotY / ch;
        newRight = start.right - dxY;
        newTop -= dyY;

        // TO DO
        if (newWidth < 0 && newHeight < 0) {}
        else if (newWidth < 0) {}
        else if (newHeight < 0) {}

        if (newTop < 0) {}
        if (newRight > 1) {}
        if (newLeft < 0) {}
      }
    }

    // -90-0 degrees
    if (start.angle > -90 && start.angle < 0) {
      const rad = degreeToRadian(-start.angle);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      if (
        (start.angle > -90 && start.angle < -45 && userCorner === 'ne')
        || (start.angle >= -45 && start.angle < 0 && userCorner === 'se')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * -hypotY / cw;
        const dyY = sin * -hypotY / ch;

        newHeight = start.height + hypotX / ch;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newWidth = start.width - hypotY / cw;
        newRight -= dxY;
        newTop = start.top - dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newRight = start.left;
          newBottom = start.bottom - cos * start.height;
          newTop = newBottom;
        } else if (newWidth < 0) {
          newWidth = 0;
          newTop = start.top + sin * start.width * ratio;
          newBottom = start.bottom - cos * (start.height - newHeight);
          newRight = start.right - cos * start.width - sin * (start.height - newHeight) * inverseRatio;
        } else if (newHeight < 0) {
          newHeight = 0;
          newTop = start.top + sin * (start.width - newWidth) * ratio;
          newBottom = start.bottom - cos * start.height;
          newRight = start.right - cos * (start.width - newWidth) - sin * start.height * inverseRatio;
        }

        if (newTop < 0) {
          newTop = 0;
          const dW = start.top * inverseRatio / sin;
          newWidth = start.width + dW;
          newRight += dxY + cos * dW;
        }

        if (newBottom > 1) {
          newBottom = 1;
          const dH = (1 - start.bottom) / cos;
          newHeight = start.height + dH;
          newRight -= dxX - sin * dH * inverseRatio;
        }

        if (newRight > 1) {
          newRight = 1;
          const maxMx = Math.min((1 - start.right) * cw, mx);
          const mouseDist = Math.hypot(maxMx, my);
          const beta = Math.acos((1 - start.right) * cw / mouseDist);
          if (Math.sign(my) > 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width + mouseDist * Math.sin(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height - mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          }
          newTop = start.top - (newWidth - start.width) * sin * ratio;
          newBottom = start.bottom + (newHeight - start.height) * cos;
        }
      }

      if (
        (start.angle > -90 && start.angle < -45 && userCorner === 'se')
        || (start.angle >= -45 && start.angle < 0 && userCorner === 'sw')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * hypotY / cw;
        const dyY = sin * hypotY / ch;

        newHeight = start.height + hypotX / ch;
        newRight = start.right + dxX;
        newBottom = start.bottom + dyX;
        newWidth = start.width + hypotY / cw;
        newLeft = start.left + dxY;
        newBottom += dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newBottom = start.top;
          newRight = start.right - sin * start.height * inverseRatio;
          newLeft = newRight;
        } else if (newWidth < 0) {
          newWidth = 0;
          newBottom = start.bottom - sin * start.width * ratio - cos * (start.height - newHeight);
          newRight = start.right - sin * (start.height - newHeight) * inverseRatio;
          newLeft = start.left + cos * start.width;
        } else if (newHeight < 0) {
          newHeight = 0;
          newBottom = start.bottom - cos * start.height - sin * (start.width - newWidth) * ratio;
          newRight = start.right - sin * start.height * inverseRatio;
          newLeft = start.left + cos * (start.width - newWidth);
        }

        if (newLeft < 0) {
          newLeft = 0;
          const dW = start.left / cos;
          newWidth = start.width + dW;
          newBottom -= dyY - sin * dW * ratio;
        }

        if (newRight > 1) {
          newRight = 1;
          const dH = (1 - start.right) * ratio / sin;
          newHeight = start.height + dH;
          newBottom -= dyX - cos * dH;
        }

        if (newBottom > 1) {
          newBottom = 1;
          const maxMy = Math.min((1 - start.bottom) * ch, my);
          const mouseDist = Math.hypot(maxMy, mx);
          const beta = Math.acos((1 - start.bottom) * ch / mouseDist);
          if (Math.sign(mx) < 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width - mouseDist * Math.sin(gamma) / cw;
          }
          newLeft = start.left - (newWidth - start.width) * cos;
          newRight = start.right + (newHeight - start.height) * sin * inverseRatio;
        }
      }

      if (
        (start.angle > -90 && start.angle < -45 && userCorner === 'sw')
        || (start.angle >= -45 && start.angle < 0 && userCorner === 'nw')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * hypotY / cw;
        const dyY = sin * hypotY / ch;

        newHeight = start.height - hypotX / ch;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newWidth = start.width + hypotY / cw;
        newLeft += dxY;
        newBottom = start.bottom + dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newBottom = start.bottom - sin * start.width * ratio;
          newTop = newBottom;
          newLeft = start.right;
        } else if (newWidth < 0) {
          newWidth = 0;
          newBottom = start.bottom - sin * start.width * ratio;
          newTop = start.top + cos * (start.height - newHeight);
          newLeft = start.left + cos * start.width + sin * (start.height - newHeight) * inverseRatio;
        } else if (newHeight < 0) {
          newHeight = 0;
          newBottom = start.bottom - sin * (start.width - newWidth) * ratio;
          newTop = start.top + cos * start.height;
          newLeft = start.left + sin * start.height * inverseRatio + cos * (start.width - newWidth);
        }

        if (newTop < 0) {
          newTop = 0;
          const dH = start.top / cos;
          newHeight = start.height + dH;
          newLeft -= dxX + sin * dH * inverseRatio;
        }

        if (newBottom > 1) {
          newBottom = 1;
          const dW = (1 - start.bottom) * inverseRatio / sin;
          newWidth = start.width + dW;
          newLeft -= dxY + cos * dW;
        }

        if (newLeft < 0) {
          newLeft = 0;
          const maxMx = Math.min(start.left * cw, Math.abs(mx));
          const mouseDist = Math.hypot(maxMx, my);
          const beta = Math.acos(start.left * cw / mouseDist);
          if (Math.sign(my) < 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width + mouseDist * Math.sin(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height - mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          }
          newTop = start.top - (newHeight - start.height) * cos;
          newBottom = start.bottom + (newWidth - start.width) * sin * ratio;
        }
      }

      if (
        (start.angle > -90 && start.angle < -45 && userCorner === 'nw')
        || (start.angle >= -45 && start.angle < 0 && userCorner === 'ne')
      ) {
        const hypotX = mx * sin + my * cos;
        const dxX = sin * hypotX / cw;
        const dyX = cos * hypotX / ch;
        const hypotY = mx * (-cos) + my * sin;
        const dxY = (-cos) * -hypotY / cw;
        const dyY = sin * -hypotY / ch;

        newHeight = start.height - hypotX / ch;
        newLeft = start.left + dxX;
        newTop = start.top + dyX;
        newWidth = start.width - hypotY / cw;
        newRight = start.right - dxY;
        newTop -= dyY;

        if (newWidth < 0 && newHeight < 0) {
          newWidth = 0;
          newHeight = 0;
          newTop = start.bottom;
          newRight = start.right - cos * start.width;
          newLeft = newRight;
        } else if (newWidth < 0) {
          newWidth = 0;
          newTop = start.top + sin * start.width * ratio + cos * (start.height - newHeight);
          newRight = start.right - cos * start.width;
          newLeft = start.left + sin * (start.height - newHeight) * inverseRatio;
        } else if (newHeight < 0) {
          newHeight = 0;
          newTop = start.top + sin * (start.width - newWidth) * ratio + cos * start.height;
          newRight = start.right - cos * (start.width - newWidth);
          newLeft = start.right - cos * start.width;
        }

        if (newLeft < 0) {
          newLeft = 0;
          const dH = start.left * ratio / sin;
          newHeight = start.height + dH;
          newTop -= dyX + cos * dH;
        }

        if (newRight > 1) {
          newRight = 1;
          const dW = (1 - start.right) / cos;
          newWidth = start.width + dW;
          newTop += dyY - sin * dW * ratio;
        }

        if (newTop < 0) {
          newTop = 0;
          const maxMy = Math.min(start.top * ch, Math.abs(my));
          const mouseDist = Math.hypot(maxMy, mx);
          const beta = Math.acos(start.top * ch / mouseDist);
          if (Math.sign(mx) > 0) {
            const gamma = Math.PI / 2 - rad - beta;
            newHeight = start.height + mouseDist * Math.sin(gamma) / ch;
            newWidth = start.width + mouseDist * Math.cos(gamma) / cw;
          } else {
            const gamma = beta - rad;
            newHeight = start.height + mouseDist * Math.cos(gamma) / ch;
            newWidth = start.width - mouseDist * Math.sin(gamma) / cw;
          }
          newLeft = start.left - (newHeight - start.height) * sin * inverseRatio;
          newRight = start.right + (newWidth - start.width) * cos;
        }
      }
    }

    newXc = (newLeft + newRight) / 2;
    newYc = (newTop + newBottom) / 2;

    p.width = newWidth;
    p.height = newHeight;
    p.left = newLeft;
    p.right = newRight;
    p.top = newTop;
    p.bottom = newBottom;
    p.xc = newXc;
    p.yc = newYc;

    const editor = this.editor;
    editor.selectedPage = p;
    editor.currentPages = editor.currentPages.map(page => page._id === p._id ? p : page);
    editor.redrawAllPages();
  }

  // ========== TELEMETRY HELPERS ==========
  private wheelZoomTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelZoomDelta = 0;

  private mouseMovedSince(start: { x: number; y: number } | null, ev: MouseEvent): boolean {
    const pos = this.getMousePos(ev);
    return !!start && !!pos && (start.x !== pos.x || start.y !== pos.y);
  }

  // A wheel gesture fires dozens of events; report one zoom action per burst.
  private trackWheelZoom(deltaY: number): void {
    this.wheelZoomDelta += deltaY;
    if (this.wheelZoomTimer) clearTimeout(this.wheelZoomTimer);
    this.wheelZoomTimer = setTimeout(() => {
      this.telemetry.track('mouse_action', { action: this.wheelZoomDelta < 0 ? 'zoom_in' : 'zoom_out' });
      this.wheelZoomDelta = 0;
      this.wheelZoomTimer = null;
    }, 400);
  }

  private stopDragRotateResize(): void {
    const editor = this.editor;
    if (editor.isDragging || editor.isRotating || editor.isResizing) {
      // Interaction released outside the canvas; count it once here.
      this.telemetry.track('mouse_action', {
        action: editor.isDragging ? 'move_page' : editor.isRotating ? 'rotate_page' : 'resize_page'
      });
      editor.isDragging = false;
      editor.dragStartPage = null;
      editor.dragStartMouse = null;
      
      editor.isRotating = false;
      editor.rotationStartPage = null;
      editor.rotationStartMouseAngle = 0;
    
      editor.isResizing = false;
      editor.resizeStartPage = null;
      editor.resizeStartMouse = null;
      editor.resizeMode = null;
      
      editor.redrawAllPages();
      return;
    }
  }
}
