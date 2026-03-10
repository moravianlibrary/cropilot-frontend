import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { DimColor, GridMode, HitInfo, ImageItem, ImageRect, MousePos, Page, PageNumberType, ScanType, TitleDetail, Viewport } from '../app.types';
import { catchError, Observable } from 'rxjs';
import { clamp, degreeToRadian, getColor, roundToDecimals, scrollToSelectedImage } from '../utils/utils';
import { EnvironmentService } from './environment.service';
import { dimColorDict, gridColor, transparentColor } from '../app.config';
import { AuthService } from './auth.service';
import { UiService } from './ui.service';

@Injectable({
  providedIn: 'root'
})
export class EditorService {
  private http = inject(HttpClient);
  private envService = inject(EnvironmentService);
  private authSvc = inject(AuthService);
  private uiSvc = inject(UiService);
  
  private get apiUrl(): string { return this.envService.get('serverBaseUrl') };


  /* ------------------------------
    STATE
  ------------------------------ */
  book = signal<string>('');
  selectedFilter: ScanType | null = 'all';
  selectedPageNumberFilter = signal<PageNumberType | null>(null);
  clickedPageNumberFilter: boolean = false;

  images = signal<ImageItem[]>([]);
  originalImages = signal<ImageItem[]>([]);
  displayedImages = signal<ImageItem[]>([]);
  displayedImagesPages = signal<ImageItem[]>([]);

  mainImageItem = signal<ImageItem>({ _id: '', url: '', thumbnailUrl: '', edited: false, flags: [], pages: [] });
  emptyImageItem: ImageItem = { _id: '', url: '', edited: false, flags: [], pages: [] };
  imgWasEdited = signal<boolean>(false);

  c!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D;
  imageRect: ImageRect = { x: 0, y: 0, width: 0, height: 0 };

  currentIndex = computed<number>(() => this.displayedImagesFinal().findIndex(img => img._id === this.mainImageItem()._id));
  mainImage: HTMLImageElement | null = null;
  loadingLeft: boolean = false;
  loadingMain = signal<boolean>(false);
  loadingFirstCurrentPage = signal<boolean>(false);

  // Interactions
  pageWasEdited: boolean = false;
  currentPages: Page[] = [];
  selectedPage: Page | null = null;
  lastSelectedPage: Page | null = null;
  clickedDiffPage: boolean | null = null;

  pageId!: string;
  hitPage!: Page | null;
  startHit: HitInfo | null = null;
  mousePos!: { x: number; y: number } | null;
  cursor: string = 'initial';

  // Hover
  lastPageCursorIsInside: Page | null = null;
  isShiftActive: boolean = false;

  // Drag
  isDragging: boolean = false;
  dragStartPage: Page | null = null;
  dragStartMouse: MousePos | null = null;
  
  // Rotate
  isRotating: boolean = false;
  rotationStartPage: Page | null = null;
  rotationStartMouseAngle: number = 0;
  gridMode = signal<GridMode>('when-rotating');

  // Resize
  isResizing: boolean = false;
  resizeStartPage: Page | null = null;
  resizeStartMouse: MousePos | null = null;
  resizeMode: HitInfo | null = null;
  resizeCursor!: string;
  
  // Inputs
  lastLeftInput: number = 0;
  lastTopInput: number = 0;
  lastWidthInput: number = 0;
  lastHeightInput: number = 0;
  increment: number = 0.001;
  incrementAngle: number = this.increment * 100;
  decimals: number = 2;
  rotationDirection: number = 1;
  
  // Zoom
  viewport: Viewport = { x: 0, y: 0, scale: 1 };
  zoomFactor: number = 0.005;
  btnZoomFactor = this.zoomFactor * 40;
  minZoom: number = 1;
  maxZoom: number = 5;
  snapped: boolean = false;
  isPanning: boolean = false;
  panPrevX: number = 0;
  panPrevY: number = 0;

  // Other
  dimColor = signal<DimColor>('Černá');
  outlineTransparent: boolean = false;
  pageOutlineWidthPrimary: number = 3;
  pageOutlineWidthSecondary: number = 1;
  cornerOutlineWidth: number = this.pageOutlineWidthPrimary - 1;
  cornerSize: number = 6;
  maxPages: number = 2;


  /* ------------------------------
    DERIVED STATE
  ------------------------------ */
  flaggedImages = computed<ImageItem[]>(() => this.images().filter(img => !img.edited && img.flags.length));
  notFlaggedImages = computed<ImageItem[]>(() => this.images().filter(img => !img.edited && !img.flags.length));
  editedImages = computed<ImageItem[]>(() => this.images().filter(img => img.edited));
  displayedImagesFinal = computed<ImageItem[]>(() => this.selectedPageNumberFilter() ? this.displayedImagesPages() : this.displayedImages());


  /* ------------------------------
    API
  ------------------------------ */
  fetchScans(id: string): Observable<TitleDetail> {
    return this.http.get<TitleDetail>(`${this.apiUrl}/${id}/scans`, { headers: this.authSvc.authHeaders('json', true) });
  }

  fetchThumbnail(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${this.book()}/thumbnails?scan_id=${id}`, { 
      responseType: 'blob',
      headers: this.authSvc.authHeaders('*/*')
    });
  }

  fetchImage(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${this.book()}/files?scan_id=${id}`, { 
      responseType: 'blob',
      headers: this.authSvc.authHeaders('*/*')
    });
  }

  updatePages(id: string, payload: any[]): any {
    return this.http.patch(`${this.apiUrl}/${id}/update-pages`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  reset(id: string): Observable<TitleDetail> {
    return this.http.patch<TitleDetail>(`${this.apiUrl}/${id}/reset`, {}, { headers: this.authSvc.authHeaders() });
  }


  /* ------------------------------
    API ACTIONS
  ------------------------------ */
  saveChanges(): void {
    if (!this.authSvc.canWriteTitle()) return;
    if (this.pageWasEdited) this.updateCurrentPagesWithEdited();
    if (this.imgWasEdited()) this.updateImagesByEdited(this.mainImageItem()._id);
    this.selectedPage = null;
    this.resetZoom();
    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));
    this.updateMainImageItemAndImages();
    
    const editedImages = this.images()
      .filter(i => i.edited)
      .map(({ pages, ...i }) => ({
        ...i,
        pages: pages.map(({ xc, yc, width, height, angle }) => ({ xc, yc, width, height, angle }))
      }));
    this.updatePages(this.book(), editedImages)
      .subscribe({
        next: () => {
          this.setDisplayedImages();
          this.uiSvc.showToast('Změny byly úspěšně uloženy!', { type: 'success' });
        },
        error: (err: Error) => {
          this.uiSvc.showToast('Při ukládání změn se něco pokazilo. Zkuste změny uložit znovu.', { type: 'error' });
          console.error(err);
          throw err;
        }
      });
  }

  resetScan(): void {
    if (!this.displayedImagesFinal().length) return;

    const mainImageItemBefore = this.mainImageItem();
    this.mainImageItem.set(this.originalImages().find(img => img._id === mainImageItemBefore._id) ?? mainImageItemBefore);
    const mainImageItemAfter = this.mainImageItem();
    this.images.update(prev =>
      prev.map(img => img._id === mainImageItemAfter._id
        ? mainImageItemAfter
        : img
      )
    );

    this.setDisplayedImages();
    scrollToSelectedImage(mainImageItemAfter._id);
    this.setMainImage(mainImageItemAfter);

    this.imgWasEdited.set(false);

    this.uiSvc.showToast('Změny skenu byly úspěšně resetovány!', { type: 'success' });
  }

  resetDoc(): void {
    this.reset(this.book()).pipe(
      catchError(err => {
        this.uiSvc.showToast('Při resetu změn dokumentu se něco pokazilo. Zkuste to znovu.', { type: 'error' });
        console.error('Fetch error:', err);
        throw err;
      })
    ).subscribe((res: TitleDetail) => {
      const images: ImageItem[] = res.scans;
      
      this.images.set(images);
      this.originalImages.set(images);
      
      if (this.selectedFilter === 'edited') this.selectedFilter = 'all';
      this.setDisplayedImages();
      this.setMainImage(this.displayedImagesFinal()[0]);

      this.uiSvc.showToast('Změny dokumentu byly úspěšně resetovány!', { type: 'success' });
    });
  }


  /* ------------------------------
    LEFT PANEL
  ------------------------------ */
  setDisplayedImages(): void {
    switch (this.selectedFilter) {
      case 'all':
        this.displayedImages.set(this.images());
        break;
      case 'flagged':
        this.displayedImages.set(this.flaggedImages());
        break;
      case 'edited':
        this.displayedImages.set(this.editedImages());
        break;
      case 'ok':
        this.displayedImages.set(this.notFlaggedImages());
        break;
    }

    switch (this.selectedPageNumberFilter()) {
      case 'all':
        this.displayedImagesPages.set(this.displayedImages());
        break;
      case 'single':
        this.displayedImagesPages.set(this.displayedImages().filter(img => img.pages.length === 1));
        break;
      case 'double':
        this.displayedImagesPages.set(this.displayedImages().filter(img => img.pages.length === 2));
        break;
      default:
        this.displayedImagesPages.set([]);
        break;
    }
  }

  switchFilter(filter: ScanType): void {
    this.updateImagesByCurrentPages();
    
    this.selectedFilter = filter;
    
    const mainImageItemId = this.mainImageItem()._id;
    if (this.imgWasEdited()) {
      this.updateImagesByEdited(mainImageItemId ?? '');
      // this.uiSvc.showToast('Sken byl přesunut do Upravených.');
    }

    this.setDisplayedImages();

    const imageList = this.displayedImagesFinal();
    const newImage = imageList.find(img => img._id === mainImageItemId) || imageList[0] || { url: '' };
    this.setMainImage(newImage);

    scrollToSelectedImage(newImage._id, 100);
  }

  togglePageNumberFilter(filter: PageNumberType | null): void {
    this.clickedPageNumberFilter = true;
    this.updateImagesByCurrentPages();
    
    this.selectedPageNumberFilter.update(prev => prev === filter ? null : filter);
    
    const mainImageItemId = this.mainImageItem()._id;

    this.setDisplayedImages();

    const imageList = this.displayedImagesFinal();
    const newImage = imageList.find(img => img._id === mainImageItemId) || imageList[0] || { url: '' };
    this.setMainImage(newImage);

    scrollToSelectedImage(newImage._id, 100);
    this.clickedPageNumberFilter = false;
  }

  pageImagesNumber(number: number): number {
    return this.displayedImages().filter(img => img.pages.length === number).length;
  }


  /* ------------------------------
    MAIN IMAGE LOGIC & DRAWING
  ------------------------------ */
  setMainImage(img: ImageItem): void {
    this.loadingMain.set(true);
    this.loadingFirstCurrentPage.set(true);

    this.c.style.visibility = 'hidden';

    const applyFinalImage = async (updated: ImageItem) => {
      const page = this.clickedDiffPage ? this.lastSelectedPage : this.selectedPage;
      if (this.pageWasEdited && page) {
        page.edited = true;
        this.pageWasEdited = false;
      }
      this.selectedPage = null;
      this.resetZoom();
      this.renderCanvas(updated);
      this.loadingMain.set(false);

      if (this.imgWasEdited()) {
        await this.uiSvc.waitForFalse(this.imgWasEdited);
        this.setDisplayedImages();
        if (this.clickedPageNumberFilter) this.clickedPageNumberFilter = false; // Don't move image to edited when click on page number filter
      }
    };

    if (img.url) {
      applyFinalImage(img);
      return;
    }

    if (!img._id) {
      this.loadingMain.set(false);
      return;
    }

    this.fetchImage(img._id).subscribe(blob => {
      if (blob.type.includes('tiff')) this.uiSvc.showToast('Nepodařilo se zobrazit sken, protože je ve formátu TIFF.', { type: 'error' });

      const url = URL.createObjectURL(blob);

      this.images.update(prev =>
        prev.map(image =>
          image._id === img._id ? { ...image, url } : image
        )
      );

      applyFinalImage({ ...img, url });
    });
  }

  private renderCanvas(imgItem: ImageItem): void {
    if (imgItem.url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imgItem.url;
      this.mainImage = img;

      img.onload = () => this.fitAndDrawImage(img, imgItem);
      img.onerror = () => console.error('Failed to load image.');

      this.c.style.visibility = 'visible';
      return;
    }

    this.c.style.visibility = 'hidden';
  }

  private fitAndDrawImage(img: HTMLImageElement, imgItem: ImageItem): void {
    const { c, ctx } = this;

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
    this.imageRect = {
      x: offsetX,
      y: offsetY,
      width: drawWidth,
      height: drawHeight,
    };

    this.viewport = { x: 0, y: 0, scale: 1 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    
    this.applyViewportTransform(ctx);
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    // Pages
    this.currentPages = [];
    this.images()
      .find(img => img._id === imgItem._id)
      ?.pages
      ?.forEach(p => {
        const { left, right, top, bottom } = this.computeBounds(p.xc, p.yc, p.width, p.height, p.angle);
        
        // Correction of edges going outside canvas (should be done on BE)
        let correctXc = p.xc;
        let correctYc = p.yc;
        let correctWidth = p.width;
        let correctHeight = p.height;
        let correctLeft = left;
        let correctRight = right;
        let correctTop = top;
        let correctBottom = bottom;
        
        if (left < 0) {
          correctLeft = 0;
          correctXc += Math.abs(left / 2);
          correctWidth -= Math.abs(left);
        }

        if (right > 1) {
          correctRight = 1;
          correctXc -= Math.abs((right - 1) / 2);
          correctWidth -= right - 1;
        }

        if (top < 0) {
          correctTop = 0;
          correctYc += Math.abs(top / 2);
          correctHeight -= Math.abs(top);
        }

        if (bottom > 1) {
          correctBottom = 1;
          correctYc -= Math.abs((bottom - 1) / 2);
          correctHeight -= bottom - 1;
        }
        
        const updatedPage = {
          ...p,
          xc: roundToDecimals(correctXc, 4),
          yc: roundToDecimals(correctYc, 4),
          width: roundToDecimals(correctWidth, 4),
          height: roundToDecimals(correctHeight, 4),
          left: roundToDecimals(correctLeft, 4),
          right: roundToDecimals(correctRight, 4),
          top: roundToDecimals(correctTop, 4),
          bottom: roundToDecimals(correctBottom, 4)
        }
        
        this.currentPages.push(updatedPage);
        this.drawPageInitial(updatedPage);
        this.loadingFirstCurrentPage.set(false);
      });
    
    const lastMainImageItemName = this.mainImageItem()._id;

    this.mainImageItem.set({ ...imgItem, url: c.toDataURL('image/jpeg') });

    if (
      imgItem._id && lastMainImageItemName && imgItem._id !== lastMainImageItemName
      && this.imgWasEdited() && !this.clickedPageNumberFilter
    ) {
      this.updateImagesByEdited(lastMainImageItemName);
    }
  }

  private dimOutside(p: Page) {
    const { c, ctx } = this;
    
    const angle = degreeToRadian(p.angle);

    ctx.save();

    // Outside rect
    ctx.beginPath();
    const { x, y, width: iw, height: ih } = this.imageRect;
    ctx.rect(x, y, iw, ih);

    ctx.save();

    // Inner rect
    const { centerX, centerY, width, height } = this.getPageRectPx(p);
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    ctx.rect(-width/2, -height/2, width, height);
    ctx.restore();

    ctx.clip('evenodd');

    ctx.fillStyle = `rgba(${dimColorDict[this.dimColor()]})`;
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.restore();
  }

  private drawPageInitial(p: Page): void {
    const { ctx } = this;

    const { centerX, centerY, width, height } = this.getPageRectPx(p);
    
    ctx.save();

    ctx.translate(centerX, centerY);
    ctx.rotate(degreeToRadian(p.angle));

    // Outline
    ctx.strokeStyle = getColor(p) + 'B2';
    ctx.lineWidth = this.pageOutlineWidthPrimary;
    ctx.strokeRect(
      -width / 2 - this.pageOutlineWidthPrimary / 2,
      -height / 2 - this.pageOutlineWidthPrimary / 2,
      width + this.pageOutlineWidthPrimary,
      height + this.pageOutlineWidthPrimary
    );

    ctx.restore();
  }

  getPageRectPx(p: Page): { centerX: number; centerY: number; width: number; height: number } {
    const { x, y, width, height } = this.imageRect;

    const w = width * p.width;
    const h = height * p.height;
    const cx = x + width * p.xc;
    const cy = y + height * p.yc;

    return { centerX: cx, centerY: cy, width: w, height: h };
  }


  /* ------------------------------
    ZOOMING
  ------------------------------ */
  private applyViewportTransform(ctx: CanvasRenderingContext2D): void {
    const { x, y, scale } = this.viewport;
    ctx.setTransform(scale, 0, 0, scale, x, y);
  }

  resetZoom(): void {
    this.viewport = { x: 0, y: 0, scale: 1 };
    this.snapped = false;

    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));
  }

  // Default zooming
  setZoomAt(screenX: number, screenY: number, newScale: number): void {
    this.snapped = false;
    
    const oldScale = this.viewport.scale;
    const scale = clamp(newScale, this.minZoom, this.maxZoom);
    
    if (scale === oldScale) return;
    if (scale <= 1) {
      this.resetZoom();
      return;
    }

    const worldX = (screenX - this.viewport.x) / oldScale;
    const worldY = (screenY - this.viewport.y) / oldScale;

    this.viewport.x = screenX - worldX * scale;
    this.viewport.y = screenY - worldY * scale;
    this.viewport.scale = scale;

    this.clampViewportToMinZoomEnvelope();
    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.snapped = false;
    
    this.viewport.x += dxScreen;
    this.viewport.y += dyScreen;

    this.clampViewportToMinZoomEnvelope();
    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));
  }

  private clampViewportToMinZoomEnvelope(): void {
    const { width: cw, height: ch } = this.c;

    const s = this.viewport.scale;
    const mz = this.minZoom;

    const marginX = (cw / mz - cw) / 2;
    const marginY = (ch / mz - ch) / 2;

    const wx0 = -marginX;
    const wx1 = cw + marginX;
    const wy0 = -marginY;
    const wy1 = ch + marginY;

    const xA = -s * wx0;
    const xB = cw - s * wx1;

    const yA = -s * wy0;
    const yB = ch - s * wy1;

    const minX = Math.min(xA, xB);
    const maxX = Math.max(xA, xB);
    const minY = Math.min(yA, yB);
    const maxY = Math.max(yA, yB);

    this.viewport.x = clamp(this.viewport.x, minX, maxX);
    this.viewport.y = clamp(this.viewport.y, minY, maxY);
  }

  // Buttons and keyboard shortcuts
  zoom(type: 'in' | 'out'): void {
    const x = this.c.width / 2;
    const y = this.c.height / 2;
    const scale = this.viewport.scale * (1 + (type === 'in' ? 1 : -1) * this.btnZoomFactor);

    this.setZoomAt(x, y, scale);
  }

  // Zoom-snap to selected page
  zoomSnap(type: 'in' | 'out'): void {
    if (type === 'in') {
      if (!this.selectedPage) return;
      if (!this.snapped) this.snapZoomToSelectedPage();
      return;
    }

    this.resetZoom();
    this.snapped = false;
  }

  private snapZoomToSelectedPage(minPad: number = 30): void {
    const { c } = this;
    if (!c || !this.selectedPage) return;

    const cw = c.width;
    const ch = c.height;

    // Page bounds in world coords
    const { centerX, centerY, width: pw, height: ph } = this.getPageRectPx(this.selectedPage);
    const pl = centerX - pw / 2;
    const pr = centerX + pw / 2;
    const pt = centerY - ph / 2;
    const pb = centerY + ph / 2;

    // Default (unzoomed, s=1) paddings in world px
    const padL = pl;
    const padR = cw - pr;
    const padT = pt;
    const padB = ch - pb;

    // Snapping not allowed if 3–4 paddings are below minPad
    const smallCount =
      (padL < minPad ? 1 : 0) +
      (padR < minPad ? 1 : 0) +
      (padT < minPad ? 1 : 0) +
      (padB < minPad ? 1 : 0);

    if (smallCount >= 3) {
      return;
    }

    // Determine scan orientation from how the image sits in the canvas:
    // vertical scan: image fills height (no top/bottom margin), but not width
    const eps = 1; // px tolerance
    const verticalScan =
      Math.abs(this.imageRect.y) <= eps &&
      Math.abs((this.imageRect.y + this.imageRect.height) - ch) <= eps &&
      this.imageRect.width < cw - eps;

    const horizontalScan =
      Math.abs(this.imageRect.x) <= eps &&
      Math.abs((this.imageRect.x + this.imageRect.width) - cw) <= eps &&
      this.imageRect.height < ch - eps;

    // Primary axis: vertical scan => enforce vertical paddings, horizontal scan => enforce horizontal paddings
    // If unclear, default to whichever dimension is closer to "fills"
    const primary: 'y' | 'x' = verticalScan ? 'y' : horizontalScan ? 'x' : (this.imageRect.height >= this.imageRect.width ? 'y' : 'x');

    // Helper: choose desired pads on an axis
    const desiredPads = (a: number, b: number) => {
      // a,b are the two default pads on that axis (e.g., top/bottom)
      if (a >= minPad && b >= minPad) {
        return { aKeep: minPad, bKeep: minPad };
      }

      if (a < minPad && b >= minPad) {
        return { aKeep: a, bKeep: minPad };
      }

      if (a >= minPad && b < minPad) {
        return { aKeep: minPad, bKeep: b };
      }
      
      return { aKeep: a, bKeep: b };
    };

    // Compute scale from primary axis only
    let s = 1;

    if (primary === 'y') {
      const { aKeep: tKeep, bKeep: bKeep } = desiredPads(padT, padB);
      const desiredWorldH = ph + tKeep + bKeep;
      s = ch / desiredWorldH;

      // Ensure secondary axis keeps some padding too
      const secPad = Math.min(minPad, padL, padR);
      const maxSFromSecondary = cw / (pw + 2 * secPad);

      s = Math.min(s, maxSFromSecondary);
    } else {
      const { aKeep: lKeep, bKeep: rKeep } = desiredPads(padL, padR);
      const desiredWorldW = pw + lKeep + rKeep;
      s = cw / desiredWorldW;

      const secPad = Math.min(minPad, padT, padB);
      const maxSFromSecondary = ch / (ph + 2 * secPad);

      s = Math.min(s, maxSFromSecondary);
    }
    
    // Don't zoom if snapping would create extra outer padding
    if (s <= 1) return;

    // World window size at this scale
    const ww = cw / s;
    const wh = ch / s;

    // Now choose world window origin (vx, vy) per-axis:
    //  - If one default pad < minPad, keep it EXACT (so origin is pinned).
    //  - Else:
    //     - On primary axis: enforce the chosen keep pad(s) (minPad or original).
    //     - On secondary axis: try center; if impossible, clamp (keeps smaller default side).
    let vx = 0;
    let vy = 0;

    // X axis positioning
    {
      if (padL < minPad) {
        vx = 0; // left pad stays padL exactly
      } else if (padR < minPad) {
        vx = cw - ww; // right pad stays padR exactly
      } else {
        if (primary === 'x') {
          // enforce left keep pad (minPad or original) by placing window so leftPad == lKeep
          const { aKeep: lKeep } = desiredPads(padL, padR);
          vx = pl - lKeep;
        } else {
          // secondary axis: try to center, then clamp (case 1 step 2/3)
          const vxCentered = (pl + pr) / 2 - ww / 2;
          vx = vxCentered;
        }
      }

      // Must stay inside default canvas world
      vx = clamp(vx, 0, cw - ww);
    }

    // Y axis positioning
    {
      if (padT < minPad) {
        vy = 0; // top pad stays padT exactly
      } else if (padB < minPad) {
        vy = ch - wh; // bottom pad stays padB exactly
      } else {
        if (primary === 'y') {
          const { aKeep: tKeep } = desiredPads(padT, padB);
          vy = pt - tKeep;
        } else {
          // secondary axis: try to center, then clamp
          const vyCentered = (pt + pb) / 2 - wh / 2;
          vy = vyCentered;
        }
      }

      vy = clamp(vy, 0, ch - wh);
    }

    // Convert world-window -> viewport transform
    this.viewport = {
      scale: s,
      x: -vx * s,
      y: -vy * s,
    };

    this.snapped = true;

    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));
  }


  /* ------------------------------
    PREV / NEXT IMAGE
  ------------------------------ */
  async showPrevImage(): Promise<void> {
    if (this.currentIndex() === 0 || !this.displayedImagesFinal().length) return;
    this.updateImagesByCurrentPages();
    this.showImage(-1);
    if (this.imgWasEdited()) {
      await this.uiSvc.waitForFalse(this.imgWasEdited);
      this.setDisplayedImages();
    }
  }

  async showNextImage(): Promise<void> {
    const displayedImages = this.displayedImagesFinal();
    if (this.currentIndex() === displayedImages.length - 1 || !displayedImages.length) return;
    this.updateImagesByCurrentPages();
    this.showImage(1);
    if (this.imgWasEdited()) {
      await this.uiSvc.waitForFalse(this.imgWasEdited);
      this.setDisplayedImages();
    }
  }

  markImageOK(): void {
    if (this.currentPages.find(p => p.edited) || this.imgWasEdited() || !this.displayedImagesFinal().length) return;
    
    this.imgWasEdited.set(false);
    this.images.update(prev =>
      prev.map(img => img._id === this.mainImageItem()._id
        ? { 
            ...img,
            flags: [],
            pages: this.currentPages.map(p => ({
              ...p,
              flags: []
            }))
          }
        : img
      )
    );

    this.showImage(1);
    this.uiSvc.showToast('Sken byl přesunut do OK.');
  }

  private showImage(offset: number): void {
    const displayedImages = this.displayedImagesFinal();
    const newIndex = ((this.currentIndex() + offset + displayedImages.length) % displayedImages.length);
    const newImage = displayedImages.length !== 1 ? displayedImages[newIndex] : this.emptyImageItem;
    this.setMainImage(newImage);

    if (displayedImages.length === 1) {
      this.setDisplayedImages();
      this.mainImageItem.set(this.emptyImageItem);
    }
    scrollToSelectedImage(newImage._id);
  }


  /* ------------------------------
    PAGE LOGIC
  ------------------------------ */
  pageIdCursorInside(): string {
    const pos = this.mousePos;
    if (!pos) return '';

    const hits = this.currentPages.filter(p => this.isPointInPage(pos.x, pos.y, p));
    const hit = this.selectedPage && hits.includes(this.selectedPage)
      ? this.selectedPage
      : hits[hits.length === 1 ? 0 : (this.isShiftActive ? 1 : 0)];

    return hit?._id ?? '';
  }

  isPointInPage(x: number, y: number, p: Page): boolean {
    const { centerX, centerY, width, height } = this.getPageRectPx(p);
    const angle = degreeToRadian(p.angle);
    const [halfW, halfH] = [width / 2, height / 2];
    const dx = x - centerX;
    const dy = y - centerY;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH;
  }

  hoveringPage(hoveredPageId: string): void {
    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p, hoveredPageId));
  }

  updateHoverPage(): void {
    if (!this.authSvc.canWriteTitle()) return;
    
    const insidePage = Boolean(this.pageId);
    if (!this.isDragging && !this.isRotating && insidePage) {
      this.pageId = this.pageIdCursorInside();
      this.lastPageCursorIsInside = this.currentPages.find(p => p._id === this.pageId) ?? null;
      this.hoveringPage(this.hitPage?._id === this.selectedPage?._id ? this.selectedPage?._id ?? '' : this.pageId);
    }
  }

  computeBounds(xc: number, yc: number, width: number, height: number, angle: number): { 
    left: number,
    right: number,
    top: number,
    bottom: number
  } {
    const rad = degreeToRadian(angle);
    const { x: ix, y: iy, width: iw, height: ih } = this.imageRect;
    const hw = (width * iw) / 2;
    const hh = (height * ih) / 2;
    const corners = [
      { x: -hw, y: -hh },
      { x: hw,  y: -hh },
      { x: hw,  y: hh  },
      { x: -hw, y: hh  },
    ];
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const centerX = ix + xc * iw;
    const centerY = iy + yc * ih;
    const rotated = corners.map(pt => ({
      x: centerX + pt.x * cos - pt.y * sin,
      y: centerY + pt.x * sin + pt.y * cos,
    }));
    const xs = rotated.map(p => p.x);
    const ys = rotated.map(p => p.y);

    return {
      left:  (Math.min(...xs) - ix) / iw,
      right: (Math.max(...xs) - ix) / iw,
      top:   (Math.min(...ys) - iy) / ih,
      bottom:(Math.max(...ys) - iy) / ih,
    }
  }
  
  drawPage(p: Page, hoveredId?: string): void {
    const { ctx } = this;

    const { centerX, centerY, width, height } = this.getPageRectPx(p);
    const color = getColor(p);
    const isPageNotSelectedWhileOtherIs = this.currentPages.length > 1 && this.selectedPage && p !== this.selectedPage;
    const pageOutlineWidth = isPageNotSelectedWhileOtherIs ? this.pageOutlineWidthSecondary : this.pageOutlineWidthPrimary;
    
    ctx.save();

    ctx.translate(centerX, centerY);
    ctx.rotate(degreeToRadian(p.angle));

    // Outline
    {
      ctx.strokeStyle = p._id === this.selectedPage?._id && this.outlineTransparent
        ? transparentColor
        : color + (isPageNotSelectedWhileOtherIs ? '77' : 'B2');
      ctx.lineWidth = pageOutlineWidth;
      ctx.strokeRect(
        -width / 2 - pageOutlineWidth / 2,
        -height / 2 - pageOutlineWidth / 2,
        width + pageOutlineWidth,
        height + pageOutlineWidth
      );
    }

    // Hover
    if (p._id === hoveredId && this.selectedPage?._id !== p._id) {
      ctx.fillStyle = color + '10';
      ctx.fillRect(-width / 2, -height / 2, width, height);
    }

    // Grid
    if (this.selectedPage?._id === p._id && (
      (this.gridMode() === 'when-rotating' && this.isRotating)
      || this.gridMode() === 'always'
    )) {
      const hw = width / 2;
      const hh = height / 2;
      const left = -hw;
      const top = -hh;
      const right = hw;
      const bottom = hh;

      const spacing = 40;

      ctx.save();
      ctx.beginPath();

      // 1px lines that stay 1px even if scaled elsewhere (optional, harmless if not scaled)
      const sx = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
      ctx.lineWidth = 1 / sx;

      ctx.strokeStyle = gridColor;

      // To make 1px lines crisp on canvas, align to half-pixel in local space.
      // Also ensure the first line starts exactly at the top-left corner.
      const xStart = left + spacing + 0.5;
      const yStart = top + spacing + 0.5;

      // Vertical lines
      for (let x = xStart; x <= right; x += spacing) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }

      // Horizontal lines
      for (let y = yStart; y <= bottom; y += spacing) {
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }

      ctx.stroke();
      ctx.restore();
    }

    // Corner squares
    if (this.selectedPage?._id === p._id && !this.isDragging) {
      const hw = width / 2;
      const hh = height / 2;

      const corners = [
        { x: -hw, y: -hh },
        { x: hw,  y: -hh },
        { x: hw,  y: hh },
        { x: -hw, y: hh }
      ];

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = p._id === this.selectedPage?._id && this.outlineTransparent
        ? transparentColor
        : color + 'B2';
      ctx.lineWidth = this.cornerOutlineWidth;

      for (const c of corners) {
        const outlineOffset = this.outlineTransparent ? 0 : this.cornerOutlineWidth;
        const negativeOffset = this.cornerSize + outlineOffset;

        const offsetX = c.x < 0 ? -negativeOffset : outlineOffset;
        const offsetY = c.y < 0 ? -negativeOffset : outlineOffset;

        ctx.fillRect(c.x + offsetX, c.y + offsetY, this.cornerSize, this.cornerSize);
        ctx.strokeRect(
          c.x + offsetX - this.cornerOutlineWidth / 2,
          c.y + offsetY - this.cornerOutlineWidth / 2,
          this.cornerSize + this.cornerOutlineWidth,
          this.cornerSize + this.cornerOutlineWidth
        );
      }
    }

    ctx.restore();
  }
  
  addPage(): void {
    if (!this.authSvc.canWriteTitle() || this.currentPages.length >= this.maxPages || !this.displayedImagesFinal().length) return;

    if (this.pageWasEdited) this.updateCurrentPagesWithEdited();

    const addedPage: Page = {
      _id: `${this.mainImageItem()._id}-${this.currentPages.length + 1}`,
      xc: .5,
      yc: .5,
      left: .5 - .2,
      right: .5 + .2,
      top: .5 - .425,
      bottom: .5 + .425,
      width: .4,
      height: .85,
      angle: 0,
      edited: true,
      flags: []
    };
    
    this.currentPages.push(addedPage);
    this.selectedPage = this.currentPages[this.currentPages.length - 1];
    this.imgWasEdited.set(true);
    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));

    this.resetZoom();
  }

  removePage(): void {
    this.currentPages = this.currentPages.filter(p => p !== this.selectedPage);
    if (this.currentPages.length) this.currentPages = this.currentPages.map(p => ({ ...p, type: 'single' }));
    this.selectedPage = null;
    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));
    this.updateMainImageItem();
    this.pageWasEdited = true;
    this.imgWasEdited.set(true);
  }

  redrawImageOnCanvas(): void {
    const { c, ctx } = this;
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    
    if (!this.mainImage) return;

    this.applyViewportTransform(ctx);
    const { x, y, width, height } = this.imageRect;
    ctx.drawImage(this.mainImage, x, y, width, height);

    if (this.selectedPage) {
      this.dimOutside(this.selectedPage);
    }
  }

  updateCurrentPagesWithEdited(): void {
    this.currentPages = this.currentPages.map(p => p._id === (this.clickedDiffPage ? this.lastSelectedPage : this.selectedPage)?._id
      ? { ...p, edited: true }
      : p
    );
    this.pageWasEdited = false;
  }

  updateMainImageItemAndImages(): void {
    this.updateMainImageItem();
    this.updateImagesByCurrentPages();
  }

  updateMainImageItem(): void {
    this.mainImageItem.set({ ...this.mainImageItem(), url: this.c.toDataURL('image/jpeg') });
  }

  updateImagesByCurrentPages(): void {
    this.images.update(prev =>
      prev.map(img => img._id === this.mainImageItem()._id
        ? { 
            ...img,
            pages: this.currentPages
          }
        : img
      )
    );
  }

  updateImagesByEdited(imgId: string): void {
    this.images.update(prev =>
      prev.map(img => img._id === imgId
        ? { 
            ...img,
            edited: true
          }
        : img
      )
    );
    this.imgWasEdited.set(false);
  }


  /* ------------------------------
    DIALOG ACTIONS
  ------------------------------ */
  gridRadio = signal<GridMode>('when-rotating');
  dimRadio = signal<DimColor>('Černá');
  scanTypeRadio = signal<ScanType>('all');
  pageNumberRadio = signal<PageNumberType>('all');

  openSettingsDialog(): void {
    const uiSvc = this.uiSvc;
    
    uiSvc.dialogWidth.set(680);
    uiSvc.dialogTitle.set('Nastavení');
    uiSvc.dialogContent.set(true);
    uiSvc.dialogContentType.set('settings');
    uiSvc.dialogDescription.set(null);
    uiSvc.dialogButtons.set([
      { 
        label: 'Reset',
        action: () => {
          this.gridRadio.set('when-rotating');
          this.gridMode.set('when-rotating');
          localStorage.setItem('gridMode', 'when-rotating');
          this.outlineTransparent = false;
          localStorage.setItem('outlineTransparent', 'false');
          this.dimColor.set('Černá');
          this.dimRadio.set('Černá');
          localStorage.setItem('dimColor', 'Černá');
          this.scanTypeRadio.set('all');
          localStorage.setItem('filterScanTypeStart', 'all');
          this.pageNumberRadio.set('all');
          localStorage.setItem('filterPageNumberStart', 'all');
          this.redrawImageOnCanvas();
          this.currentPages.forEach(p => this.drawPage(p));
          uiSvc.closeDialog();
          uiSvc.showToast('Nastavení bylo resetováno.', { type: 'success' });
        }
      },
      {
        label: 'Uložit',
        primary: true,
        action: () => {
          uiSvc.closeDialog();
          this.saveSettings();
        }
      }
    ]);

    uiSvc.openDialog();
  }

  toggleOutline(): void {
    this.outlineTransparent = !this.outlineTransparent;
    localStorage.setItem('outlineTransparent', `${this.outlineTransparent}`);
  }

  saveSettings(): void {
    const gridRadio = this.gridRadio();
    this.gridMode.set(gridRadio);
    localStorage.setItem('gridMode', gridRadio);
    const dimRadio = this.dimRadio();
    this.dimColor.set(dimRadio);
    localStorage.setItem('dimColor', dimRadio);
    localStorage.setItem('filterScanTypeStart', this.scanTypeRadio());
    localStorage.setItem('filterPageNumberStart', this.pageNumberRadio());
    this.redrawImageOnCanvas();
    this.currentPages.forEach(p => this.drawPage(p));
    this.uiSvc.showToast('Nastavení bylo uloženo.', { type: 'success' });
  }

  openShortcutsDialog(): void {
    const uiSvc = this.uiSvc;

    uiSvc.dialogWidth.set(680);
    uiSvc.dialogTitle.set('Klávesové zkratky');
    uiSvc.dialogContent.set(true);
    uiSvc.dialogContentType.set('shortcuts');
    uiSvc.dialogDescription.set(null);
    uiSvc.dialogButtons.set([]);

    uiSvc.openDialog();
  }

  openResetDocDialog(): void {
    if (!this.authSvc.canWriteTitle()) return;
    const uiSvc = this.uiSvc;
    
    uiSvc.dialogWidth.set(680);
    uiSvc.dialogTitle.set('Opravdu chcete resetovat změny dokumentu?');
    uiSvc.dialogContent.set(false);
    uiSvc.dialogContentType.set(null);
    uiSvc.dialogDescription.set('Reset změn se týká celého dokumentu.');
    uiSvc.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Resetovat celý dokument',
        primary: true,
        destructive: true,
        action: () => {
          uiSvc.closeDialog();
          this.resetDoc();
        }
      }
    ]);

    uiSvc.openDialog();
  }

  openResetScanDialog(): void {
    if (!this.authSvc.canWriteTitle()) return;
    const uiSvc = this.uiSvc;

    uiSvc.dialogWidth.set(680);
    uiSvc.dialogTitle.set('Opravdu chcete resetovat změny skenu?');
    uiSvc.dialogContent.set(false);
    uiSvc.dialogContentType.set(null);
    uiSvc.dialogDescription.set('Reset změn se týká aktuálního skenu.');
    uiSvc.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Resetovat změny skenu',
        primary: true,
        destructive: true,
        action: () => {
          uiSvc.closeDialog();
          this.resetScan();
        }
      }
    ]);

    uiSvc.openDialog();
  }

  openSaveChangesDialog(): void {
    if (!this.authSvc.canWriteTitle()) return;
    const uiSvc = this.uiSvc;
    
    uiSvc.dialogWidth.set(680);
    uiSvc.dialogTitle.set('Opravdu chcete uložit změny?');
    uiSvc.dialogContent.set(false);
    uiSvc.dialogContentType.set(null);
    uiSvc.dialogDescription.set(null);
    uiSvc.dialogButtons.set([
      { label: 'Ne, zrušit' },
      {
        label: 'Ano, uložit změny',
        primary: true,
        action: () => {
          uiSvc.closeDialog();
          this.saveChanges();
        }
      }
    ]);

    uiSvc.openDialog();
  }


  // TO DO: REFACTOR!
  /* ------------------------------
    KEYBOARD SHORTCUTS
  ------------------------------ */
  private isHandledKey(key: string): boolean {
    return [
      '+', 'ě', 'Ě', '1', '2',                              // Select left / right page OR + Alt / Cmd = filters number of pages
      'Escape',                                             // Unselect page
      'Backspace', 'Delete',                                // Remove page
      'p', 'P',                                             // Add page
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',    // Drag selected page x, y by 1; not selected prev/next scan
      'PageDown', 'PageUp',                                 // (+ PageUp / PageDown)
      'm', 'M',                                             // Mřížka / grid
      'o', 'O',                                             // Obrys / outline
      'c', 'C',                                             // Clona (barva)
      'Enter',                                              // Next scan, + control/cmd = uložit změny
      'F1', 'F2', 'F3', 'F4',                               // Filters
      'Shift',                                              // + arrows = change width / height by 1
      'Control', 'Meta',                                    // + R = reset změn skenu; + shift + R = reset změn dokumentu
      'a', 'A', 's', 'S',                                   // Rotate by 1
      'k', 'K',                                             // Shortcuts
      'q', 'Q', 'w', 'W', 'e', 'E', 'r', 'R',               // Zooming
      'Tab'                                                 // Cycle through current pages
    ].includes(key);
  }

  async onKeyDown(event: KeyboardEvent): Promise<void> {
    const key = event.key;
    if (!this.isHandledKey(key) || (event.target as HTMLElement).tagName === 'INPUT') return;
    event.preventDefault();
    event.stopPropagation();
    const dialogOpen = this.uiSvc.dialogOpen();
    const canWriteTitle = this.authSvc.canWriteTitle();

    // Update hover page
    if (key === 'Shift') {
      this.isShiftActive = true;
      this.updateHoverPage();
    }

    // Select left / right page OR Filters number of pages
    if ((key === '+' || key === 'ě' || key === 'Ě' || key === '1' || key === '2') && !event.ctrlKey && !dialogOpen) {
      if (event.altKey || event.metaKey) {
        if ((['+', '1'].includes(key) && this.pageImagesNumber(1) === 0) || ['ě', 'Ě', '2'].includes(key) && this.pageImagesNumber(2) === 0) return;
        this.togglePageNumberFilter(['+', '1'].includes(key) ? 'single' : 'double');
        return;
      }
      
      if (!canWriteTitle) return;
      if (this.pageWasEdited) this.updateCurrentPagesWithEdited();
      this.lastSelectedPage = this.selectedPage;
      const isLeftKey = key === '+' || key === '1';
      this.selectedPage = this.currentPages.length
        ? this.currentPages.reduce((best, p) =>
            isLeftKey
              ? p.xc < best.xc ? p : best
              : p.xc > best.xc ? p : best
          )
        : null;
      this.clickedDiffPage = this.lastSelectedPage && this.selectedPage && this.lastSelectedPage !== this.selectedPage;
      this.lastPageCursorIsInside = this.selectedPage;
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
      this.updateMainImageItem();
    }

    // Unselect page
    if (canWriteTitle && key === 'Escape') {
      if (dialogOpen) {
        this.uiSvc.dialogOpen.set(false);
        this.uiSvc.dialogOpened = false;
        if (this.uiSvc.dialogTitle() === 'Nastavení') this.gridRadio.set(this.gridMode());
        return;
      }
      
      if (this.pageWasEdited) this.updateCurrentPagesWithEdited();
      this.lastSelectedPage = this.selectedPage;
      this.selectedPage = null;
      this.lastPageCursorIsInside = null;
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
      this.updateMainImageItem();
    }

    // Remove selected page
    if (canWriteTitle && ['Backspace', 'Delete'].includes(key) && !dialogOpen && this.selectedPage) this.removePage();
    
    // Add page
    if (canWriteTitle && ['p', 'P'].includes(key) && !dialogOpen && this.currentPages.length < this.maxPages) this.addPage();

    // Change grid mode
    if (canWriteTitle && ['m', 'M'].includes(key) && this.selectedPage &&!dialogOpen) {
      this.gridMode.set(!this.isRotating
        ? this.gridMode() === 'always' ? 'when-rotating' : 'always'
        : this.gridMode() === 'never' ? 'when-rotating' : 'never');
      this.gridRadio.set(this.gridMode());
      localStorage.setItem('gridMode', this.gridMode());
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    };

    // Outline transparency
    if (canWriteTitle && ['o', 'O'].includes(key) && this.selectedPage && !dialogOpen) {
      this.outlineTransparent = !this.outlineTransparent;
      localStorage.setItem('outlineTransparent', String(this.outlineTransparent));
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    }

    // Dimming color
    if (canWriteTitle && ['c', 'C'].includes(key) && this.selectedPage && !dialogOpen) {
      this.dimColor.update(prev => prev === 'Černá' ? 'Červená' : 'Černá');
      this.dimRadio.set(this.dimColor());
      localStorage.setItem('dimColor', this.dimColor());
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    }

    // Prev/next scan
    if (((['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && !this.selectedPage) || ['PageDown', 'PageUp'].includes(key)) && !dialogOpen) {
      const prevKeys = new Set(['PageUp', 'ArrowLeft', 'ArrowUp']);
      const nextKeys = new Set(['PageDown', 'ArrowRight', 'ArrowDown']);

      const isAllowedArrow = !this.selectedPage && (prevKeys.has(key) || nextKeys.has(key));
      const isPageKey = key === 'PageUp' || key === 'PageDown';

      if (isPageKey || isAllowedArrow) prevKeys.has(key) ? this.showPrevImage() : this.showNextImage();
    }

    // Drag/move page
    if (canWriteTitle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && this.selectedPage && !event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && !dialogOpen) {
      const start = this.selectedPage;
      const isHorizontal = ['ArrowLeft', 'ArrowRight'].includes(key);
      const sign = ['ArrowRight','ArrowDown'].includes(key) ? 1 : -1;

      const delta = this.increment * sign/*  * (event.shiftKey ? 10 : 1) */;

      const axis = isHorizontal
        ? { c: 'xc' as const, min: 'left' as const, max: 'right' as const }
        : { c: 'yc' as const, min: 'top' as const, max: 'bottom' as const };

      let newC = start[axis.c] + delta;
      let newMin = start[axis.min] + delta;
      let newMax = start[axis.max] + delta;

      if (newMin < 0) {
        const offset = -newMin;
        newC += offset;
        newMax += offset;
        newMin = 0;
      }
      if (newMax > 1) {
        const offset = newMax - 1;
        newC -= offset;
        newMin -= offset;
        newMax = 1;
      }

      const updatedPage: Page = {
        ...start,
        [axis.c]: newC,
        [axis.min]: newMin,
        [axis.max]: newMax
      };

      this.pageWasEdited = true;
      this.imgWasEdited.set(true);
      this.selectedPage = updatedPage;
      this.lastSelectedPage = updatedPage;
      this.currentPages = this.currentPages.map(p =>p._id === updatedPage._id ? updatedPage : p);

      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    }

    // Change page width / height
    if (canWriteTitle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && event.shiftKey && this.selectedPage && !dialogOpen) {
      if (['ArrowLeft', 'ArrowRight'].includes(key)) {
        const cw = this.c.width;
        const ch = this.c.height;
        const ratio = cw / ch;
        const inverseRatio = ch / cw;
        
        const page = this.selectedPage;
        const lastWidth = page.width;
        const sign = key === 'ArrowRight' ? 1 : -1;
        const delta = this.increment * sign/*  * (event.shiftKey ? 10 : 1) */;
        let value = lastWidth + delta;

        const handleAligned = (isHorizontal: boolean, reverse: boolean) => {
          value = clamp(value, 0, isHorizontal
            ? reverse ? page.right : 1 - page.left
            : (reverse ? page.bottom : (1 - page.top)) * inverseRatio);
          
          if (isHorizontal) {
            page.xc = value === 0 ? page.left : page.xc + delta / 2;
            reverse
              ? page.left = clamp(value === 0 ? page.right : page.left + delta)
              : page.right = clamp(value === 0 ? page.left : page.right + delta);
          } else {
            page.yc = value === 0 ? page.top : page.yc + (delta / 2) * ratio;
            reverse
              ? page.top = clamp(value * ratio >= page.bottom ? 0 : page.top + delta * ratio)
              : page.bottom = clamp(page.bottom + delta * ratio);
          }

          page.width = value;
        };

        const handleRotated = (angle: number) => {
          const getOrientation = (angle: number) => {
            if (angle > 0 && angle < 90)  return { signX: +1, signY: +1, ref: 'bottom-right', baseAngle: angle };
            if (angle > 90)               return { signX: -1, signY: +1, ref: 'bottom-left',  baseAngle: angle - 90 };
            if (angle < -90)              return { signX: -1, signY: -1, ref: 'top-left',     baseAngle: -angle - 90 };
            if (angle < 0 && angle > -90) return { signX: +1, signY: -1, ref: 'top-right',    baseAngle: -angle };
            return null;
          };

          const o = getOrientation(angle);
          if (!o) return;

          value = clamp(value);
          const rad = degreeToRadian(o.baseAngle);
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const toRight = o.signX > 0;
          const toBottom = o.signY > 0;
          const goniom = toRight ? cos : sin;
          const inverseGoniom = toRight ? sin : cos;

          const pageWidthOriginal = page.width;
          const pageLeftOriginal = page.left;
          const pageRightOriginal = page.right;
          const pageTopOriginal = page.top;
          const pageBottomOriginal = page.bottom;

          const dW = delta;
          const limitSide = toRight ? 'right' : 'left';
          const reverseLimitSide = toRight ? 'left' : 'right';
          let newSide = page[limitSide] + dW * (toRight ? cos : -sin);
          page[limitSide] = value === 0 ? page[reverseLimitSide] + Math.sin(degreeToRadian(Math.abs(page.angle))) * page.height * inverseRatio * (toRight ? 1 : -1) : newSide;
          let dX = (dW / 2) * goniom;
          
          page.width = value;
          let adjustedDeltaWidth = dW;
          let adjustedDeltaX = dX;

          if (toRight ? newSide > 1 : newSide < 0) {
            page.width = pageWidthOriginal + ((toRight ? 1 - pageRightOriginal : pageLeftOriginal) / goniom);
            page[limitSide] = toRight ? 1 : 0;
            adjustedDeltaWidth = page.width - lastWidth;
            adjustedDeltaX = (adjustedDeltaWidth / 2) * goniom;
          }

          let deltaY = (adjustedDeltaWidth / 2) * inverseGoniom;
          let adjustedDeltaY = deltaY;
          const secondLimitSide = toBottom ? 'bottom' : 'top';
          const secondReverseLimitSide = toBottom ? 'top' : 'bottom';
          let secondNewSide = page[secondLimitSide] + adjustedDeltaWidth * inverseGoniom * ratio * o.signY;
          page[secondLimitSide] = value === 0 ? page[secondReverseLimitSide] + Math.cos(degreeToRadian(Math.abs(page.angle))) * page.height * (toBottom ? 1 : -1) : secondNewSide;

          if (toBottom ? secondNewSide > 1 : secondNewSide < 0) {
            page.width = pageWidthOriginal + ((toBottom ? (1 - pageBottomOriginal) : pageTopOriginal) / inverseGoniom) * inverseRatio;
            page[secondLimitSide] = toBottom ? 1 : 0;
            adjustedDeltaWidth = page.width - lastWidth;
            adjustedDeltaX = (adjustedDeltaWidth / 2) * goniom;
            adjustedDeltaY = (adjustedDeltaWidth / 2) * inverseGoniom;
            toRight
              ? page.right = pageRightOriginal + adjustedDeltaWidth * cos
              : page.left = pageLeftOriginal - adjustedDeltaWidth * sin;
          }

          page.xc = (page.left + page.right) / 2;
          page.yc = (page.top + page.bottom) / 2;
          
        };

        // --- Dispatch by angle ---
        switch (page.angle) {
          case 0:
            handleAligned(true, false);
            break;
          case -180:
            handleAligned(true, true);
            break;
          case 90:
            handleAligned(false, false);
            break;
          case -90:
            handleAligned(false, true);
            break;
          default:
            handleRotated(page.angle);
            break;
        }
      }

      if (['ArrowUp', 'ArrowDown'].includes(key)) {
        const cw = this.c.width;
        const ch = this.c.height;
        const ratio = cw / ch;
        const inverseRatio = ch / cw;
        
        const page = this.selectedPage;
        const lastHeight = page.height;
        const sign = key === 'ArrowDown' ? 1 : -1;
        const delta = this.increment * sign/*  * (event.shiftKey ? 10 : 1) */;
        let value = lastHeight + delta;

        const handleAlignedHeight = (isHorizontal: boolean, reverse: boolean) => {
          value = clamp(value, 0, isHorizontal
            ? reverse ? page.bottom : 1 - page.top
            : (reverse ? page.right : (1 - page.left)) * ratio);
          
          if (isHorizontal) {
            page.yc = value === 0 ? page.top : page.yc + delta / 2;
            reverse
              ? page.top = clamp(value === 0 ? page.bottom : page.top + delta)
              : page.bottom = clamp(value === 0 ? page.top : page.bottom + delta);
          } else {
            page.xc = value === 0 ? page.left : page.xc + (delta / 2) * inverseRatio;
            reverse
              ? page.left = clamp(value * inverseRatio >= page.right ? 0 : page.left + delta * inverseRatio)
              : page.right = clamp(page.right + delta * inverseRatio);
          }

          page.height = value;
        };

        const handleRotatedHeight = (angle: number) => {
          const getOrientation = (angle: number) => {
            if (angle > 0 && angle < 90)  return { signX: -1, signY: +1, ref: 'bottom-left', baseAngle: 90 - angle };
            if (angle > 90)               return { signX: -1, signY: -1, ref: 'top-left',  baseAngle: angle - 90 };
            if (angle < -90)              return { signX: +1, signY: -1, ref: 'top-right', baseAngle: 180 + angle };
            if (angle < 0 && angle > -90) return { signX: +1, signY: +1, ref: 'bottom-right',    baseAngle: -angle };
            return null;
          };

          const o = getOrientation(angle);
          if (!o) return; 

          value = clamp(value);
          const rad = degreeToRadian(o.baseAngle);
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const toRight = o.signX > 0;
          const toBottom = o.signY > 0;
          const goniom = toRight ? cos : sin;
          const inverseGoniom = toRight ? sin : cos;

          const pageHeightOriginal = page.height;
          const pageLeftOriginal = page.left;
          const pageRightOriginal = page.right;
          const pageTopOriginal = page.top;
          const pageBottomOriginal = page.bottom;

          const dH = delta;
          const limitSide = toBottom ? 'bottom' : 'top';
          const reverseLimitSide = toBottom ? 'top' : 'bottom';
          let newSide = page[limitSide] + dH * goniom * o.signY;
          page[limitSide] = value === 0 ? page[reverseLimitSide] + Math.sin(degreeToRadian(Math.abs(page.angle))) * page.width * ratio * (toBottom ? 1 : -1) : newSide;
          let dY = (dH / 2) * goniom;
          
          page.height = value;
          let adjustedDeltaHeight = dH;
          let adjustedDeltaY = dY;

          if (toBottom ? newSide > 1 : newSide < 0) {
            page.height = pageHeightOriginal + ((toBottom ? 1 - pageBottomOriginal : pageTopOriginal) / goniom);
            page[limitSide] = toBottom ? 1 : 0;
            adjustedDeltaHeight = page.height - lastHeight;
            adjustedDeltaY = (adjustedDeltaHeight / 2) * goniom;
          }

          let deltaX = (adjustedDeltaHeight / 2) * inverseGoniom;
          let adjustedDeltaX = deltaX;
          const secondLimitSide = toRight ? 'right' : 'left';
          const secondReverseLimitSide = toRight ? 'left' : 'right';
          let secondNewSide = page[secondLimitSide] + adjustedDeltaHeight * inverseGoniom * inverseRatio * o.signX;
          page[secondLimitSide] = value === 0 ? page[secondReverseLimitSide] + Math.cos(degreeToRadian(Math.abs(page.angle))) * page.width * (toRight ? 1 : -1) : secondNewSide;

          if (toRight ? secondNewSide > 1 : secondNewSide < 0) {
            page.height = pageHeightOriginal + ((toRight ? (1 - pageRightOriginal) : pageLeftOriginal) / inverseGoniom) * ratio;
            page[secondLimitSide] = toRight ? 1 : 0;
            adjustedDeltaHeight = page.height - lastHeight;
            adjustedDeltaY = (adjustedDeltaHeight / 2) * goniom;
            adjustedDeltaX = (adjustedDeltaHeight / 2) * inverseGoniom;
            toBottom
              ? page.bottom = pageBottomOriginal + adjustedDeltaHeight * cos
              : page.top = pageTopOriginal - adjustedDeltaHeight * sin;
          }

          page.xc = (page.left + page.right) / 2;
          page.yc = (page.top + page.bottom) / 2;
        };

        // --- Dispatch by angle ---
        switch (page.angle) {
          case 0:
            handleAlignedHeight(true, false);
            break;
          case -180:
            handleAlignedHeight(true, true);
            break;
          case 90:
            handleAlignedHeight(false, true);
            break;
          case -90:
            handleAlignedHeight(false, false);
            break;
          default:
            handleRotatedHeight(page.angle);
            break;
        }
      }

      this.pageWasEdited = true;
      this.imgWasEdited.set(true);
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    }

    // Rotate
    if (canWriteTitle && ['a', 'A', 's', 'S'].includes(key) && this.selectedPage && !dialogOpen) {
      const page = this.selectedPage;
      const sign = ['s', 'S'].includes(key) ? 1 : -1;
      const delta = this.incrementAngle * sign/*  * (event.shiftKey ? 10 : 1) */;
      const value = page.angle + delta;
      const newAngle = clamp(value, -45, 45);

      const canRotatePage = (page: Page, newAngle: number): boolean => {
        const bounds = this.computeBounds(page.xc, page.yc, page.width, page.height, newAngle);
        return (
          bounds.left >= 0 &&
          bounds.right <= 1 &&
          bounds.top >= 0 &&
          bounds.bottom <= 1
        );
      }

      this.rotationDirection = Math.sign((newAngle - page.angle) || newAngle);
      if (canRotatePage(page, newAngle)) {
        page.angle = newAngle;
      } else {
        const step = this.rotationDirection * (0.1 ** this.decimals);
        let tempAngle = page.angle;
        while (canRotatePage(page, tempAngle + step)) {
          tempAngle += step;
        }
        page.angle = tempAngle;
      }

      const bounds = this.computeBounds(page.xc, page.yc, page.width, page.height, page.angle);

      page.left = bounds.left;
      page.right = bounds.right;
      page.top = bounds.top;
      page.bottom = bounds.bottom;

      this.pageWasEdited = true;
      this.imgWasEdited.set(true);
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    }

    // Zooming
    if (['q', 'Q', 'w', 'W', 'e', 'E', 'r', 'R'].includes(key) && !dialogOpen) {
      if (['q', 'Q'].includes(key)) {
        // this.selectedPage && event.shiftKey ? this.zoomSnap('in') : this.zoom('in');
        this.zoom('in');
        return;
      }
      
      if (['w', 'W'].includes(key)) {
        // event.shiftKey ? this.zoomSnap('out') : this.zoom('out');
        this.zoom('out');
        return;
      }

      if (['e', 'E'].includes(key)) {
        this.selectedPage && this.zoomSnap('in');
        return;
      }

      if (['r', 'R'].includes(key) && !event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey) {
        this.resetZoom();
        return;
      }
    }

    // Next scan based on number of current pages and selected page
    if (key === 'Enter' && !event.ctrlKey && !event.metaKey && !dialogOpen) {
      if (!canWriteTitle) {
        this.showNextImage();
        return;
      }
      
      if (
        this.currentPages.length < 2
        || (
          this.currentPages.length === this.maxPages
          && this.selectedPage === this.currentPages.reduce((max, page) => page.xc > max.xc ? page : max)
        )
      ) {
        this.showNextImage();
        await this.uiSvc.waitForFalse(this.loadingFirstCurrentPage);
        this.selectedPage = this.currentPages.reduce((min, page) => page.xc < min.xc ? page : min);
        this.lastPageCursorIsInside = this.selectedPage;
        this.redrawImageOnCanvas();
        this.currentPages.forEach(p => this.drawPage(p));
        this.updateMainImageItem();
      }
    }

    // Uložit změny
    if (canWriteTitle && key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      if (!dialogOpen) {
        // this.openFinishDialog();
        this.saveChanges();
        return;
      }
      
      switch (this.uiSvc.dialogTitle()) {
        case 'Nastavení':
          this.saveSettings();
          break;
        case 'Opravdu chcete resetovat změny dokumentu?':
          this.resetDoc();
          break;
        case 'Opravdu chcete resetovat změny skenu?':
          this.resetScan();
          break;
        case 'Opravdu chcete uložit změny?':
          this.saveChanges();
          break;
      }

      this.uiSvc.closeDialog();
    };

    // Reset změn dokumentu a skenu
    {
      if (
        !dialogOpen &&
        ((key === 'R' && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey)
        || (key === 'R' && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey))
      ) {
        // this.openResetDoc();
      } else if (
        !dialogOpen &&
        ((key === 'r' && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
        || (key === 'r' && event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey))
      ) {
        this.openResetScanDialog();
      }
    }

    // Switch filter
    if (['F1', 'F2', 'F3', 'F4'].includes(key) && !dialogOpen) {
      const filterByKey: { [filter: string]: ScanType } = {
        F1: 'all',
        F2: 'flagged',
        F3: 'edited',
        F4: 'ok'
      };

      const filter = filterByKey[key];
      if (filter) {
        this.selectedFilter = filter;
        this.switchFilter(this.selectedFilter);
      }
    }

    // Toggle shortcuts
    if (['k', 'K'].includes(key)) {
      if (dialogOpen && this.uiSvc.dialogTitle() === 'Klávesové zkratky') {
        this.uiSvc.dialogOpen.set(false);
        this.uiSvc.dialogOpened = false;
        return;
      }

      if (!dialogOpen) {
        this.openShortcutsDialog();
      }
    };

    // Cycle through current pages
    if (['Tab'].includes(key) && this.selectedPage && this.currentPages.length > 1 && !dialogOpen) {      
      if (this.pageWasEdited) this.updateCurrentPagesWithEdited();

      const potentialNewIndex = this.currentPages.findIndex(p => p._id === this.selectedPage?._id) + 1;
      const newIndex = potentialNewIndex === this.currentPages.length ? 0 : potentialNewIndex;
      this.selectedPage = this.currentPages[newIndex];
      this.lastPageCursorIsInside = this.selectedPage;
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    };
  }

  onKeyUp(event: KeyboardEvent): void {
    const key = event.key;
    if (!['Shift', 'Control', 'Meta', 'Alt'].includes(key) || (event.target as HTMLElement).tagName === 'INPUT') return;
    
    // Change hover
    if (key === 'Shift') {
      this.isShiftActive = false;
      this.updateHoverPage();
    }

    // Is rotating OFF
    if (
      (((event.ctrlKey || event.metaKey) && key === 'Alt') || (['Control', 'Meta'].includes(key) && event.altKey))
      && this.selectedPage && !this.uiSvc.dialogOpen()
    ) {
      this.isRotating = false;
      this.redrawImageOnCanvas();
      this.currentPages.forEach(p => this.drawPage(p));
    }
  }
}
