import { Component, ElementRef, inject, NgZone, viewChild } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { clamp, degreeToRadian, radianToDegree } from '../../utils/utils';
import { CornerName, EdgeLocalOrientation, EdgeSide, HitInfo, Page } from '../../app.types';
import { LoaderComponent } from '../../components/loader/loader.component';
import { ToastComponent } from '../../components/toast/toast.component';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-main-editor',
  imports: [LoaderComponent, ToastComponent],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})
export class MainComponent {
  edtSvc = inject(EditorService);
  private authSvc = inject(AuthService);
  private uiSvc = inject(UiService);

  private pointerCursor: string = "url('/assets/pointer-cursor.png') 6.5 0, pointer";
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
    const edtSvc = this.edtSvc;

    // On resize
    {
      const container = this.mainContainer()?.nativeElement;

      this.ngZone.runOutsideAngular(() => {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.rafId !== null) cancelAnimationFrame(this.rafId);

          this.rafId = requestAnimationFrame(() => {
            this.ngZone.run(() => {
              const { c, mainImage: img } = edtSvc;

              const appMain = document.querySelector('app-main-editor') as HTMLElement;
              const appStyle = getComputedStyle(appMain);
              const appRect = appMain.getBoundingClientRect();

              const widthAvail =
                appRect.width -
                (parseFloat(appStyle.paddingLeft) +
                  parseFloat(appStyle.paddingRight) +
                  parseFloat(appStyle.borderLeftWidth) +
                  parseFloat(appStyle.borderRightWidth));

              const heightAvail =
                appRect.height -
                (parseFloat(appStyle.paddingTop) +
                  parseFloat(appStyle.paddingBottom) +
                  parseFloat(appStyle.borderTopWidth) +
                  parseFloat(appStyle.borderBottomWidth));

              c.width = widthAvail;
              c.height = heightAvail;

              if (img) {
                const imgRatio = img.width / img.height;
                const canvasRatio = c.width / c.height;

                let drawWidth: number = c.width;
                let drawHeight: number = c.height;

                imgRatio > canvasRatio
                  ? drawHeight = c.width / imgRatio
                  : drawWidth = c.height * imgRatio;

                const offsetX = (c.width - drawWidth) / 2;
                const offsetY = (c.height - drawHeight) / 2;

                // Store rect for pages / hit-testing:
                edtSvc.imageRect = {
                  x: offsetX,
                  y: offsetY,
                  width: drawWidth,
                  height: drawHeight,
                };

                edtSvc.redrawImageOnCanvas();
                if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
                edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
              }
            });
          });
        });

        if (container) this.resizeObserver.observe(container);
      });
    }
    
    // Set canvas
    edtSvc.c = document.getElementById('main-canvas') as HTMLCanvasElement;
    edtSvc.ctx = edtSvc.c.getContext('2d')!;

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
    const edtSvc = this.edtSvc;

    el.onclick = (ev) => {
      const tagName = (ev.target as HTMLElement).tagName;
      if (tagName === 'APP-RIGHT-PANEL' || el.tagName === 'APP-RIGHT-PANEL') return;
      if (tagName !== 'APP-LEFT-PANEL' && tagName !== 'DIV' && tagName !== 'APP-RIGHT-PANEL' && tagName !== 'APP-BOTTOM-PANEL') return;
      if (el.tagName === 'DIV' && tagName !== 'DIV') return;
      if (!edtSvc.selectedPage) return;
      if (this.uiSvc.dialogOpened) {
        this.uiSvc.dialogOpened = false;
        return;
      }
      this.stopDragRotateResize();

      if (edtSvc.pageWasEdited) edtSvc.updateCurrentPagesWithEdited();
      edtSvc.lastSelectedPage = edtSvc.selectedPage;
      edtSvc.selectedPage = null;
      edtSvc.lastPageCursorIsInside = null;
      edtSvc.redrawImageOnCanvas();
      if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
      edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
      edtSvc.mainImageItem.set({ ...edtSvc.mainImageItem(), url: edtSvc.c.toDataURL('image/jpeg') });
      edtSvc.hoveringPage('');
    };

    el.onmouseup = (ev) => {
      if (!edtSvc.selectedPage) return;
      this.stopDragRotateResize();
    };
  }

  private attachMainCanvasEvents(): void {
    const { c } = this.edtSvc; 

    ['mousedown', 'mousemove', 'mouseup', 'mouseenter', 'mouseleave', 'wheel'].forEach(eventType => {
      c.addEventListener(eventType, (ev) => this.handleCanvasInteraction(ev as (MouseEvent | WheelEvent), c));
    });
  }

  private handleCanvasInteraction(ev: MouseEvent | WheelEvent, el: HTMLElement): void {
    if ((ev.target as HTMLElement).tagName !== 'CANVAS') return;
    const edtSvc = this.edtSvc;
    const canWriteTitle = this.authSvc.canWriteTitle();

    const btn = ev.button;
    const hit = this.hitTest(ev);
    const pageId = this.pageIdCursorInside(ev);
    edtSvc.pageId = pageId;
    const insidePage = !!pageId;
    const hitPage = hit.page ?? null;
    edtSvc.hitPage = hitPage;
    
    const hoveringPage = () => edtSvc.hoveringPage(hitPage?._id === edtSvc.selectedPage?._id ? edtSvc.selectedPage?._id ?? '' : pageId);

    // Hover
    if (
      canWriteTitle
      && ev.type === 'mousemove'
      && (edtSvc.lastPageCursorIsInside?._id !== pageId || edtSvc.selectedPage)
      && !edtSvc.isDragging && !edtSvc.isRotating && !edtSvc.isResizing && !edtSvc.isPanning
    ) {
      edtSvc.lastPageCursorIsInside = edtSvc.currentPages.find(p => p._id === pageId) ?? null;
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
        const factor = Math.exp(-wev.deltaY * edtSvc.zoomFactor);
        edtSvc.setZoomAt(sx, sy, edtSvc.viewport.scale * factor);
        if (canWriteTitle) hoveringPage();
      }

      // Panning: two-figer touch OR wheel
      if (edtSvc.viewport.scale > 1 && !(ev.ctrlKey || ev.metaKey)) {
        edtSvc.panBy(-wev.deltaX, -wev.deltaY);
        if (canWriteTitle) hoveringPage();
      }
    }

    // Assign cursor
    if (canWriteTitle) {
      edtSvc.cursor = insidePage ? (edtSvc.selectedPage?._id === hitPage?._id ? this.moveCursor : this.pointerCursor) : 'initial';

      if ((ev.type === 'mousedown' && btn === 1) || edtSvc.isPanning) {
        edtSvc.cursor = 'grabbing';
      } else if (hitPage && hitPage === edtSvc.selectedPage) {
        if (hit.area === 'inside') {
          edtSvc.cursor = hitPage && edtSvc.selectedPage?._id === hitPage._id
            ? this.moveCursor
            : this.pointerCursor;
        } else if (hit.area === 'edge' && hit.edgeOrientation && hitPage) {
          edtSvc.cursor = this.getEdgeCursor(hitPage.angle, hit.edgeOrientation);
        } else if (hit.area === 'corner' && hit.corner && hitPage) {
          edtSvc.cursor = this.getCornerCursor(hitPage.angle, hit.corner);
        } else if (hit.area === 'rotate') {
          if (hit.corner === 'ne') edtSvc.cursor = this.rotateCursorTopRight;
          if (hit.corner === 'nw') edtSvc.cursor = this.rotateCursorTopLeft;
          if (hit.corner === 'se') edtSvc.cursor = this.rotateCursorBottomRight;
          if (hit.corner === 'sw') edtSvc.cursor = this.rotateCursorBottomLeft;
        }
      }

      el.style.cursor = edtSvc.cursor;
    }

    // Click
    if (canWriteTitle && ev.type === 'mousedown' && btn === 0) {
      if (edtSvc.pageWasEdited && (edtSvc.cursor === 'initial' || edtSvc.cursor === this.pointerCursor)) {
        edtSvc.updateCurrentPagesWithEdited();
      }
      edtSvc.isRotating = false;
      edtSvc.lastSelectedPage = edtSvc.selectedPage;
      edtSvc.selectedPage = hitPage;
      edtSvc.clickedDiffPage = edtSvc.lastSelectedPage && edtSvc.selectedPage && edtSvc.lastSelectedPage !== edtSvc.selectedPage;
      edtSvc.lastPageCursorIsInside = hitPage;
      edtSvc.redrawImageOnCanvas();
      if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
      edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
      edtSvc.mainImageItem.set({ ...edtSvc.mainImageItem(), url: edtSvc.c.toDataURL('image/jpeg') });
      edtSvc.hoveringPage(hitPage?._id ?? '');
      // Don't return here to enable other mousedown interactions
    }

    // Panning
    {
      if (ev.type === 'mousedown' && btn === 1 && edtSvc.viewport.scale > 1) {
        edtSvc.isPanning = true;
        edtSvc.panPrevX = (ev as MouseEvent).clientX;
        edtSvc.panPrevY = (ev as MouseEvent).clientY;
        return;
      }

      if (ev.type === 'mousemove' && edtSvc.isPanning) {
        const dx = (ev as MouseEvent).clientX - edtSvc.panPrevX;
        const dy = (ev as MouseEvent).clientY - edtSvc.panPrevY;
        edtSvc.panPrevX = (ev as MouseEvent).clientX;
        edtSvc.panPrevY = (ev as MouseEvent).clientY;

        edtSvc.panBy(dx, dy);
        return;
      }

      if (ev.type === 'mouseup' && edtSvc.isPanning) {
        edtSvc.isPanning = false;
        hoveringPage();
        el.style.cursor = insidePage ? (edtSvc.selectedPage?._id === hitPage?._id ? this.moveCursor : this.pointerCursor) : 'initial';
        edtSvc.mainImageItem.set({ ...edtSvc.mainImageItem(), url: edtSvc.c.toDataURL('image/jpeg') });
        return;
      }
    }

    // Drag
    if (canWriteTitle && hit.area === 'inside' || edtSvc.isDragging) {
      if (ev.type === 'mousedown' && btn === 0 && hitPage) {
        edtSvc.isDragging = true;
        // imgSvc.dragStartMouse = { x: ev.clientX, y: ev.clientY };
        edtSvc.dragStartMouse = this.getMousePos(ev);
        edtSvc.dragStartPage = structuredClone(hitPage);
        return;
      }

      if (edtSvc.isDragging) {
        if (ev.type === 'mousemove') {
          el.style.cursor = this.moveCursor;
          this.dragPage(ev);
          return;
        }

        if (ev.type === 'mouseup') {
          edtSvc.isDragging = false;
          edtSvc.dragStartPage = null;

          if (!edtSvc.imgWasEdited()) return;
          if (hitPage) edtSvc.hoveringPage(hitPage._id);
          edtSvc.redrawImageOnCanvas();
          if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
          edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
          edtSvc.mainImageItem.set({ ...edtSvc.mainImageItem(), url: edtSvc.c.toDataURL('image/jpeg') });
          return;
        }
      }
    }

    // Rotate
    {
      if (ev.type === 'mousedown' && btn === 0 && hit.area === 'rotate' && hitPage) {
        edtSvc.startHit = hit;

        const rect = el.getBoundingClientRect();
        // const cx = imgSvc.c.width * hitPage.xc;
        // const cy = imgSvc.c.height * hitPage.yc;
        // const { x, y, width, height } = imgSvc.imageRect;
        // const cx = x + width * hitPage.xc;
        // const cy = y + height * hitPage.yc;

        // const dx = ev.clientX - rect.left - cx;
        // const dy = ev.clientY - rect.top - cy;

        const { centerX, centerY } = edtSvc.getPageRectPx(hitPage);
        const mouse = this.getMousePos(ev);
        if (!mouse) return;

        const dx = mouse.x - centerX;
        const dy = mouse.y - centerY;

        edtSvc.rotationStartMouseAngle = Math.atan2(dy, dx);
        edtSvc.rotationStartPage = edtSvc.selectedPage;
        edtSvc.isRotating = true;
        return;
      }

      if (edtSvc.isRotating) {
        if (ev.type === 'mousemove') {
          this.rotatePage(edtSvc.cursor, ev, el);
          return;
        }

        if (ev.type === 'mouseup') {
          edtSvc.startHit = null;
          edtSvc.isRotating = false;
          edtSvc.rotationStartPage = null;
          edtSvc.redrawImageOnCanvas();
          if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
          edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
          edtSvc.mainImageItem.set({ ...edtSvc.mainImageItem(), url: edtSvc.c.toDataURL('image/jpeg') });
          return;
        }
      }
    }

    // Resize
    {
      if (ev.type === 'mousedown' && btn === 0 && (hit.area === 'edge' || hit.area === 'corner') && hitPage) {
        edtSvc.resizeMode = hit;
        edtSvc.resizeStartPage = edtSvc.selectedPage;
        edtSvc.resizeStartMouse = this.getMousePos(ev);
        edtSvc.resizeCursor = el.style.cursor;
        return;
      }

      if (ev.type === 'mousemove' && edtSvc.resizeMode && edtSvc.resizeStartPage) {
        edtSvc.isResizing = true;
        this.resizePage(ev, el);
        return;
      }

      if (ev.type === 'mouseup' && edtSvc.resizeMode) {
        edtSvc.isResizing = false;
        edtSvc.resizeMode = null;
        edtSvc.resizeStartPage = null;
        edtSvc.resizeStartMouse = null;
        edtSvc.redrawImageOnCanvas();
        if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
        edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
        edtSvc.mainImageItem.set({ ...edtSvc.mainImageItem(), url: edtSvc.c.toDataURL('image/jpeg') });
        return;
      }
    }
  }

  
  // ========== PAGE LOGIC ==========
  private pageIdCursorInside(e: MouseEvent): string {
    const edtSvc = this.edtSvc;
    const pos = this.getMousePos(e);
    edtSvc.mousePos = pos;
    if (!pos) return '';

    return edtSvc.pageIdCursorInside();
  }

  private hitTest(e: MouseEvent): HitInfo {
    const pos = this.getMousePos(e);
    if (!pos) return { area: 'none' };

    const edtSvc = this.edtSvc;
    const pages = edtSvc.currentPages;

    if (edtSvc.selectedPage) {
      const page = edtSvc.isShiftActive && edtSvc.currentPages.length === edtSvc.maxPages
        ? edtSvc.currentPages.find(p => p._id !== edtSvc.selectedPage?._id) ?? edtSvc.selectedPage
        : edtSvc.selectedPage;
      const hit = this.hitTestPage(pos.x, pos.y, page);
      if (hit.area !== 'none') return hit;
    }

    const candidatePages = pages.filter(p => p !== edtSvc.selectedPage);
    const hits = candidatePages
      .map(p => this.hitTestPage(pos.x, pos.y, p))
      .filter(hit => hit.area !== 'none');
    const index = hits.length <= 1 ? 0 : (edtSvc.isShiftActive ? 1 : 0);

    return hits[index] ?? { area: 'none' };
  }

  private hitTestPage(x: number, y: number, p: Page): HitInfo {
    const edtSvc = this.edtSvc;
    // const c = imgSvc.c;
    // const [centerX, centerY] = [c.width * p.xc, c.height * p.yc];
    // const [width, height] = [c.width * p.width, c.height * p.height];
    const { centerX, centerY, width, height } = edtSvc.getPageRectPx(p);
    const angle = degreeToRadian(p.angle);

    const hw = width / 2;
    const hh = height / 2;

    const dx = x - centerX;
    const dy = y - centerY;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const withinXWithTolerance = Math.abs(localX) <= hw + this.edgeHitTolerance / 2;
    const withinYWithTolerance = Math.abs(localY) <= hh + this.edgeHitTolerance / 2;
    const withinX = Math.abs(localX) <= hw;
    const withinY = Math.abs(localY) <= hh;

    // Corners and rotates
    const corners: { x: number; y: number; name: CornerName }[] = [
      { x: -hw - edtSvc.cornerSize / 2, y: -hh - edtSvc.cornerSize / 2, name: 'nw' },
      { x: hw + edtSvc.cornerSize / 2,  y: -hh - edtSvc.cornerSize / 2, name: 'ne' },
      { x: hw + edtSvc.cornerSize / 2,  y: hh + edtSvc.cornerSize / 2,  name: 'se' },
      { x: -hw - edtSvc.cornerSize / 2, y: hh + edtSvc.cornerSize / 2,  name: 'sw' }
    ];

    for (const corner of corners) {
      const dxC = localX - corner.x;
      const dyC = localY - corner.y;
      const distCorner = Math.hypot(dxC, dyC);

      // Corners
      if (distCorner <= this.cornerHitTolerance) {
        const userCorner = this.localCornerToUserCorner(corner.name, p.angle);
        return { area: 'corner', page: p, corner: userCorner };
      }

      const distToCorner = Math.hypot(localX - corner.x, localY - corner.y);
      if (
        distToCorner < this.rotateHandleOffset
        || distToCorner > this.rotateHitTolerance
        || (withinX && withinY)
      ) {
        continue;
      }

      // Rotates
      const userCorner = this.localCornerToUserCorner(corner.name, p.angle);
      return { area: 'rotate', page: p, corner: userCorner };
    }

    if (!withinXWithTolerance || !withinYWithTolerance) {
      return { area: 'none' };
    }

    // Edge detection in user space (not local)
    const nearLeftOrRight = Math.abs(Math.abs(localX) - (hw + 6)) <= this.edgeHitTolerance;
    const nearTopOrBottom = Math.abs(Math.abs(localY) - (hh + 6)) <= this.edgeHitTolerance;

    if (nearLeftOrRight && !nearTopOrBottom) {
      const localSide = localX > 0 ? 'right' : 'left';
      const userSide = this.localEdgeSideToUserSide(localSide, p.angle);
      return { area: 'edge', page: p, edgeOrientation: 'vertical', edgeSide: userSide };
    }

    if (nearTopOrBottom && !nearLeftOrRight) {
      const localSide = localY > 0 ? 'bottom' : 'top';
      const userSide = this.localEdgeSideToUserSide(localSide, p.angle);
      return { area: 'edge', page: p, edgeOrientation: 'horizontal', edgeSide: userSide };
    }

    // Inside rect
    if (withinX && withinY) {
      return { area: 'inside', page: p };
    }

    // Else
    return { area: 'none' };
  }

  private localEdgeSideToUserSide(localSide: 'left' | 'right' | 'top' | 'bottom', angleDeg: number) {
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

  private localCornerToUserCorner(local: CornerName, angleDeg: number): CornerName {
    const a = angleDeg;

    if (a >= -45 && a <= 45) return local;

    if (a > 45 && a <= 135) {
      const map90: { [key: string]: CornerName } = { nw: 'ne', ne: 'se', se: 'sw', sw: 'nw' };
      return map90[local];
    }

    if (a > 135 || a <= -135) {
      const map180: { [key: string]: CornerName } = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
      return map180[local];
    }

    const map270: { [key: string]: CornerName } = { nw: 'sw', sw: 'se', se: 'ne', ne: 'nw' };
    return map270[local];
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

    const userCorner = this.localCornerToUserCorner(corner, angleDeg);

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
    const edtSvc = this.edtSvc;

    const rect = edtSvc.c.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const { x, y, scale } = edtSvc.viewport;

    // Invert the viewport transform: screen = world * scale + (x,y)  =>  world = (screen - (x,y)) / scale
    return {
      x: (localX - x) / scale,
      y: (localY - y) / scale,
    };
  }

  private dragPage(e: MouseEvent): void {    
    const edtSvc = this.edtSvc;
    if (!edtSvc.selectedPage) return;

    // const { width, height } = imgSvc.c;
    const { width, height } = edtSvc.imageRect;
    const start = edtSvc.dragStartPage;
    const mousePos = this.getMousePos(e);
    if (!start || !mousePos || !edtSvc.dragStartMouse) return;
    const page = edtSvc.selectedPage;

    // const dx = (e.clientX - imgSvc.dragStartMouse.x) / width;
    // const dy = (e.clientY - imgSvc.dragStartMouse.y) / height;
    const dx = (mousePos.x - edtSvc.dragStartMouse.x) / width;
    const dy = (mousePos.y - edtSvc.dragStartMouse.y) / height;

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

    edtSvc.selectedPage = updatedPage;
    edtSvc.lastSelectedPage = updatedPage;
    edtSvc.currentPages = edtSvc.currentPages.map(p =>
      p._id === updatedPage._id ? updatedPage : p
    );

    edtSvc.pageWasEdited = true;
    edtSvc.imgWasEdited.set(true);
    edtSvc.sthWasEdited = true;
    edtSvc.redrawImageOnCanvas();
    if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
    edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
  }

  private rotatePage(cursor: string, ev: MouseEvent, el: HTMLElement): void {
    const edtSvc = this.edtSvc;
    if (!edtSvc.rotationStartPage) return;

    if (edtSvc.startHit?.corner === 'ne') cursor = this.rotateCursorTopRight;
    if (edtSvc.startHit?.corner === 'nw') cursor = this.rotateCursorTopLeft;
    if (edtSvc.startHit?.corner === 'se') cursor = this.rotateCursorBottomRight;
    if (edtSvc.startHit?.corner === 'sw') cursor = this.rotateCursorBottomLeft;
    el.style.cursor = cursor;
    
    const startPage = edtSvc.rotationStartPage;
    
    // const rect = el.getBoundingClientRect();
    // const cx = imgSvc.c.width * startPage.xc;
    // const cy = imgSvc.c.height * startPage.yc;

    // const dx = ev.clientX - rect.left - cx;
    // const dy = ev.clientY - rect.top - cy;

    // const rect = el.getBoundingClientRect();
    // const { x: ix, y: iy, width: iw, height: ih } = imgSvc.imageRect;

    // const cx = ix + iw * startPage.xc;
    // const cy = iy + ih * startPage.yc;

    // const mouseX = ev.clientX - rect.left;
    // const mouseY = ev.clientY - rect.top;

    // const dx = mouseX - cx;
    // const dy = mouseY - cy;

    const { centerX, centerY } = edtSvc.getPageRectPx(startPage);
    const mouse = this.getMousePos(ev);
    if (!mouse) return;

    const dx = mouse.x - centerX;
    const dy = mouse.y - centerY;

    const currentMouseAngle = Math.atan2(dy, dx);

    let delta = currentMouseAngle - edtSvc.rotationStartMouseAngle;

    let proposedAngle = startPage.angle + radianToDegree(delta);
    proposedAngle = clamp(proposedAngle, -45, 45);
    edtSvc.rotationDirection = Math.sign((proposedAngle - startPage.angle) || proposedAngle);

    const canRotate = (angle: number) => {
      const bounds = edtSvc.computeBounds(startPage.xc, startPage.yc, startPage.width, startPage.height, angle);
      return bounds.left >= 0 && bounds.right <= 1 && bounds.top >= 0 && bounds.bottom <= 1;
    }

    if (!canRotate(proposedAngle)) {
      const step = (proposedAngle - startPage.angle) > 0 ? edtSvc.incrementAngle : -edtSvc.incrementAngle;

      let temp = startPage.angle;
      while (canRotate(temp + step)) temp += step;

      proposedAngle = temp;
    }

    // Build updated page
    if (!edtSvc.selectedPage) return;

    const bounds = edtSvc.computeBounds(startPage.xc, startPage.yc, startPage.width, startPage.height, proposedAngle);
    const updatedPage: Page = {
      ...edtSvc.selectedPage,
      angle: proposedAngle,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    };

    // Update state
    edtSvc.selectedPage = updatedPage;
    edtSvc.lastSelectedPage = updatedPage;
    edtSvc.currentPages = edtSvc.currentPages.map(p =>
      p._id === updatedPage._id ? updatedPage : p
    );

    edtSvc.pageWasEdited = true;
    edtSvc.imgWasEdited.set(true);
    edtSvc.sthWasEdited = true;
    edtSvc.redrawImageOnCanvas();
    if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
    edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
  }

  private resizePage(ev: MouseEvent, el: HTMLElement): void {
    const edtSvc = this.edtSvc;
    const mode = edtSvc.resizeMode;
    const startPage = edtSvc.resizeStartPage;
    if (!mode || !startPage) return;

    el.style.cursor = edtSvc.resizeCursor;

    const updated = structuredClone(startPage);
    
    if (mode.area === 'edge') {
      this.applyEdgeResize(updated, startPage, mode.edgeSide!, ev);
    }

    if (mode.area === 'corner') {
      this.applyCornerResize(updated, startPage, mode.corner!, ev);
    }

    edtSvc.pageWasEdited = true;
    edtSvc.imgWasEdited.set(true);
    edtSvc.sthWasEdited = true;
  }

  private applyEdgeResize(p: Page, start: Page, userSide: EdgeSide, ev: MouseEvent) {
    // const c = this.imagesService.c;
    // const cw = c.width;
    // const ch = c.height;
    const rect = this.edtSvc.imageRect;
    const cw = rect.width;
    const ch = rect.height;
    const ratio = cw / ch;
    const inverseRatio = ch / cw;

    const startMouse = this.edtSvc.resizeStartMouse;
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

    const edtSvc = this.edtSvc;
    edtSvc.selectedPage = p;
    edtSvc.currentPages = edtSvc.currentPages.map(page => page._id === p._id ? p : page);
    edtSvc.redrawImageOnCanvas();
    if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
    edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
  }

  private applyCornerResize(p: Page, start: Page, userCorner: CornerName, ev: MouseEvent) {
    // const c = this.imagesService.c;
    // const cw = c.width;
    // const ch = c.height;
    const rect = this.edtSvc.imageRect;
    const cw = rect.width;
    const ch = rect.height;
    const ratio = cw / ch;
    const inverseRatio = ch / cw;
    
    const startMouse = this.edtSvc.resizeStartMouse;
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

    const edtSvc = this.edtSvc;
    edtSvc.selectedPage = p;
    edtSvc.currentPages = edtSvc.currentPages.map(page => page._id === p._id ? p : page);
    edtSvc.redrawImageOnCanvas();
    if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
    edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
  }

  private stopDragRotateResize(): void {
    const edtSvc = this.edtSvc;
    if (edtSvc.isDragging || edtSvc.isRotating || edtSvc.isResizing) {
      edtSvc.isDragging = false;
      edtSvc.dragStartPage = null;
      edtSvc.dragStartMouse = null;
      
      edtSvc.isRotating = false;
      edtSvc.rotationStartPage = null;
      edtSvc.rotationStartMouseAngle = 0;
    
      edtSvc.isResizing = false;
      edtSvc.resizeStartPage = null;
      edtSvc.resizeStartMouse = null;
      edtSvc.resizeMode = null;
      
      edtSvc.redrawImageOnCanvas();
      if (edtSvc.showPredictions) edtSvc.currentPredictedPages.forEach(p => edtSvc.drawPagePredicted(p));
      edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));  
      return;
    }
  }
}
