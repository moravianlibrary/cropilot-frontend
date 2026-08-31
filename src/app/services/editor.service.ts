import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { DefaultFitMode, DimColor, GridColorLabel, GridDensityLabel, GridLineWidthLabel, GridMode, HitInfo, ImageItem, ImageRect, MousePos, OutlineWidthLabel, Page, PageNumberType, ScanType, TitleDetail, UpdateImagePayload, Viewport, ImageOrientation, RotationScope } from '../app.types';
import { catchError, Observable, throwError } from 'rxjs';
import { clamp, degreeToRadian, getColor, roundToDecimals, scrollToSelectedImage } from '../utils/utils';
import { EnvironmentService } from './environment.service';
import { dimColorDict, gridColorDict, gridDensityDict, gridLineWidthDict, outlineWidthDict, predictedColor, transparentColor } from '../app.config';
import { AuthService } from './auth.service';
import { UiService } from './ui.service';
import { LocalStorageService } from './local-storage.service';

@Injectable({
  providedIn: 'root'
})
export class EditorService {
  private http = inject(HttpClient);
  private env = inject(EnvironmentService);
  private auth = inject(AuthService);
  private ui = inject(UiService);
  private storage = inject(LocalStorageService);
  
  private get apiUrl(): string { return this.env.get('serverBaseUrl') };


  // ========== STATE ==========
  book = signal<string>('');
  selectedFilter: ScanType | null = 'all';
  selectedPageNumberFilter = signal<PageNumberType | null>(null);
  clickedPageNumberFilter: boolean = false;

  images = signal<ImageItem[]>([]);
  originalImages = signal<ImageItem[]>([]);
  displayedImages = signal<ImageItem[]>([]);
  displayedImagesPages = signal<ImageItem[]>([]);
  predictedImages = signal<ImageItem[]>([]);
  predictedOrientedImages = signal<ImageItem[]>([]);
  sthWasEdited: boolean = false;

  mainImageItem = signal<ImageItem>({ _id: '', url: '', thumbnailUrl: '', edited: false, flags: [], pages: [] });
  titleExternalId = signal<string>('');
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
  private mainImageLoadId: number = 0;

  // Interactions
  pageWasEdited: boolean = false;
  currentPredictedPages: Page[] = [];
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
  orientation = signal<ImageOrientation>(0);
  rotationScope = signal<RotationScope>('current');

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
  btnZoomStep: number = 0.2;
  minZoom: number = 0.95;
  maxZoom: number = 5;
  defaultFitMode = signal<DefaultFitMode>('page');
  snapped: boolean = false;
  isPanning: boolean = false;
  panPrevX: number = 0;
  panPrevY: number = 0;

  // Draw page parameters
  dimColor = signal<DimColor>('Černá');
  gridDensityLabel = signal<GridDensityLabel>('Hustá');
  gridColorLabel = signal<GridColorLabel>('Modrá');
  gridLineWidthLabel = signal<GridLineWidthLabel>('Tenká');
  outlineWidthLabel = signal<OutlineWidthLabel>('Silný');
  outlineDashed: boolean = false;
  dashLength: number = 6;
  dashGapLength: number = 4;
  pageOutlineWidthSecondary: number = 1;
  cornerOutlineWidth: number = outlineWidthDict[this.outlineWidthLabel()] - 1;
  cornerSize: number = 6;
  showPredictions: boolean = false;
  
  // Max pages per image
  maxPages: number = 2;

  // Last selected scan
  lastSelectedImageId: string = '';

  // Flagged ("Podezřelé") scans the user has already viewed in this session.
  // Kept in memory ONLY and intentionally never persisted, so a page refresh
  // brings every flagged scan back.
  reviewedFlaggedIds = signal<Set<string>>(new Set<string>());

  // Ids of every scan that was flagged when the document was opened. This is
  // the membership of the "Podezřelé" filter for the whole session: reviewed
  // and edited scans stay in it (greyed out), they are never removed.
  flaggedIdsAtLoad = signal<Set<string>>(new Set<string>());

  // A scan only counts as reviewed after it has been on screen for at least
  // this long, so quickly arrowing past scans does not mark them.
  private readonly reviewDwellMs = 500;
  private currentShownAt = 0;


  // ========== DERIVED STATE ==========
  // The "Podezřelé" list: every scan that was flagged when the document opened,
  // including ones since reviewed or edited (those show greyed out but stay).
  flaggedImages = computed<ImageItem[]>(() => {
    const flagged = this.flaggedIdsAtLoad();
    return this.images().filter(img => flagged.has(img._id));
  });

  // Flagged scans still awaiting attention (not yet reviewed and not edited) —
  // the (decreasing) number shown next to the "Podezřelé" filter. Reviewed and
  // edited scans stay in the list (greyed out); they just stop counting here.
  flaggedRemaining = computed<number>(() => {
    const flagged = this.flaggedIdsAtLoad();
    const reviewed = this.reviewedFlaggedIds();
    return this.images().filter(img => flagged.has(img._id) && !img.edited && !reviewed.has(img._id)).length;
  });
  notFlaggedImages = computed<ImageItem[]>(() => this.images().filter(img => !img.edited && !img.flags.length));
  editedImages = computed<ImageItem[]>(() => this.images().filter(img => img.edited));
  displayedImagesFinal = computed<ImageItem[]>(() => this.selectedPageNumberFilter() ? this.displayedImagesPages() : this.displayedImages());


  // ========== API ==========
  fetchScans(id: string): Observable<TitleDetail> {
    return this.http.get<TitleDetail>(`${this.apiUrl}/${id}/scans`, { headers: this.auth.authHeaders('json', true) });
  }

  fetchPredictedScans(id: string): Observable<TitleDetail> {
    return this.http.get<TitleDetail>(`${this.apiUrl}/${id}/predicted-scans`, { headers: this.auth.authHeaders('json', true) });
  }

  fetchThumbnail(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${this.book()}/thumbnails?scan_id=${id}`, { 
      responseType: 'blob',
      headers: this.auth.authHeaders('*/*')
    });
  }

  fetchImage(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${this.book()}/files?scan_id=${id}`, { 
      responseType: 'blob',
      headers: this.auth.authHeaders('*/*')
    });
  }

  updatePages(id: string, payload: UpdateImagePayload[]): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`${this.apiUrl}/${id}/update-pages`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  reset(id: string): Observable<TitleDetail> {
    return this.http.patch<TitleDetail>(`${this.apiUrl}/${id}/reset`, {}, { headers: this.auth.authHeaders() });
  }


  // ========== API ACTIONS ==========
  saveChanges(): void {
    if (!this.auth.canWriteTitle()) return;
    if (this.pageWasEdited) this.updateCurrentPagesWithEdited();
    if (this.imgWasEdited()) this.updateImagesByEdited(this.mainImageItem()._id);
    this.selectedPage = null;
    this.applyDefaultZoom();
    this.updateMainImageItemAndImages();
    
    const editedImages: UpdateImagePayload[] = this.images()
      .filter(i => i.edited)
      .map(({ pages, ...i }) => ({
        ...i,
        orientation: this.normalizeOrientation(i.orientation),
        pages: pages.map(page => {
          const { xc, yc, width, height } = this.pageToOriginalOrientation(page, i.orientation);
          return { xc, yc, width, height, angle: page.angle };
        })
      }));
    this.updatePages(this.book(), editedImages).pipe(
      catchError(err => {
        this.ui.showToast('Při ukládání změn se něco pokazilo. Zkuste změny uložit znovu.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      })
    ).subscribe(() => {
      this.sthWasEdited = false;
      this.setDisplayedImages();
      this.ui.showToast('Změny byly úspěšně uloženy!', { type: 'success' });
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

    this.ui.showToast('Změny skenu byly úspěšně resetovány!', { type: 'success' });
  }

  resetDoc(): void {
    this.reset(this.book()).pipe(
      catchError(err => {
        this.ui.showToast('Při resetu změn dokumentu se něco pokazilo. Zkuste to znovu.', { type: 'error' });
        console.error('Fetch error:', err);
        return throwError(() => err);
      })
    ).subscribe((res: TitleDetail) => {
      const images: ImageItem[] = res.scans.map(img => this.normalizeImageForDisplay(img));
      
      this.images.set(images);
      this.originalImages.set(images);
      this.reviewedFlaggedIds.set(new Set<string>());
      this.flaggedIdsAtLoad.set(new Set(images.filter(img => img.flags.length).map(img => img._id)));
      
      if (this.selectedFilter === 'edited') this.selectedFilter = 'all';
      this.setDisplayedImages();
      this.setMainImage(this.displayedImagesFinal()[0]);

      this.ui.showToast('Změny dokumentu byly úspěšně resetovány!', { type: 'success' });
    });
  }


  // ========== LEFT PANEL ==========
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


  // ========== MAIN IMAGE LOGIC & DRAWING ==========
  /**
   * Mark the scan currently shown in the editor as reviewed when it is a
   * flagged ("Podezřelé") scan. Reviewing a flagged scan is nothing more than
   * looking at it for a moment: once the user moves on, the scan they just saw
   * is greyed out in the list and stops counting towards the "Podezřelé"
   * progress counter — but it stays in the list. A short dwell time guards
   * against marking scans that were only flicked past. This is deliberately
   * in-memory only, so refreshing the page restores every flagged scan.
   */
  private markCurrentFlaggedAsReviewed(): void {
    const current = this.mainImageItem();
    if (!current._id || current.edited || !this.flaggedIdsAtLoad().has(current._id)) return;
    if (this.reviewedFlaggedIds().has(current._id)) return;
    if (Date.now() - this.currentShownAt < this.reviewDwellMs) return;

    const reviewedId = current._id;
    this.reviewedFlaggedIds.update(prev => {
      const next = new Set(prev);
      next.add(reviewedId);
      return next;
    });
  }

  setMainImage(img: ImageItem): void {
    const loadId = ++this.mainImageLoadId;
    const bookId = this.book();

    if (img._id !== this.mainImageItem()._id) {
      this.rotationScope.set('current');
      // Moving away marks the scan we were on as reviewed (if eligible), then
      // we start timing how long the newly shown scan stays on screen.
      this.markCurrentFlaggedAsReviewed();
      this.currentShownAt = Date.now();
    }

    this.loadingMain.set(true);
    this.loadingFirstCurrentPage.set(true);

    this.c.style.visibility = 'hidden';
    this.mainImage = null;

    const applyFinalImage = async (updated: ImageItem) => {
      if (loadId !== this.mainImageLoadId) return;

      const page = this.clickedDiffPage ? this.lastSelectedPage : this.selectedPage;
      if (this.pageWasEdited && page) {
        page.edited = true;
        this.pageWasEdited = false;
      }
      this.selectedPage = null;
      this.resetZoom();

      const rendered = await this.renderCanvas(updated, loadId);
      if (loadId !== this.mainImageLoadId) return;

      this.loadingMain.set(false);
      if (!rendered) return;

      if (this.imgWasEdited()) {
        await this.ui.waitForFalse(this.imgWasEdited);
        this.setDisplayedImages();
        if (this.clickedPageNumberFilter) this.clickedPageNumberFilter = false; // Don't move image to edited when click on page number filter
      }
    };

    if (img.url) {
      void applyFinalImage(img);
      return;
    }

    if (!img._id) {
      this.loadingMain.set(false);
      return;
    }

    this.fetchImage(img._id).subscribe({
      next: blob => {
        if (blob.type.includes('tiff')) this.ui.showToast('Nepodařilo se zobrazit sken, protože je ve formátu TIFF.', { type: 'error' });

        const url = URL.createObjectURL(blob);
        if (bookId !== this.book()) {
          URL.revokeObjectURL(url);
          return;
        }

        this.cacheImageUrl(img._id, url);

        void applyFinalImage({ ...img, url });
      },
      error: err => {
        if (loadId !== this.mainImageLoadId) return;
        this.loadingMain.set(false);
        console.error('Failed to fetch image.', err);
      }
    });
  }

  cancelMainImageLoad(): void {
    this.mainImageLoadId++;
    this.mainImage = null;
    this.loadingMain.set(false);
    if (this.c) this.c.style.visibility = 'hidden';
  }

  private cacheImageUrl(id: string, url: string): void {
    const updateUrl = (images: ImageItem[]): ImageItem[] =>
      images.map(image => image._id === id ? { ...image, url } : image);

    this.images.update(updateUrl);
    this.originalImages.update(updateUrl);
    this.displayedImages.update(updateUrl);
    this.displayedImagesPages.update(updateUrl);
  }

  private renderCanvas(imgItem: ImageItem, loadId: number): Promise<boolean> {
    const imageUrl = imgItem.url;
    if (!imageUrl) {
      this.c.style.visibility = 'hidden';
      return Promise.resolve(false);
    }

    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        if (loadId !== this.mainImageLoadId || !this.c.isConnected) {
          resolve(false);
          return;
        }

        this.mainImage = img;
        this.fitAndDrawImage(img, imgItem);
        this.c.style.visibility = 'visible';
        resolve(true);
      };

      img.onerror = () => {
        if (loadId === this.mainImageLoadId) {
          this.c.style.visibility = 'hidden';
          console.error('Failed to load image.');
        }
        resolve(false);
      };

      img.src = imageUrl;
    });
  }

  private fitAndDrawImage(img: HTMLImageElement, imgItem: ImageItem): void {
    const { c, ctx } = this;

    this.resizeCanvasToEditor();
    this.updateImageRect(img, imgItem.orientation);

    this.viewport = { x: 0, y: 0, scale: 1 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    
    this.applyViewportTransform(ctx);
    this.drawOrientedImage(imgItem.orientation);

    // Predicted pages
    if (this.showPredictions) {
      this.currentPredictedPages = [];

      this.predictedOrientedImages()
        .find(img => img._id === imgItem._id)
        ?.pages
        ?.forEach(page => {
          const updatedPage = this.correctPageBounds(page);

          this.currentPredictedPages.push(updatedPage);
          this.drawPagePredicted(updatedPage);
        });
    }

    // Pages
    this.currentPages = [];

    this.images()
      .find(img => img._id === imgItem._id)
      ?.pages
      ?.forEach(page => {
        const updatedPage = this.correctPageBounds(page);

        this.currentPages.push(updatedPage);
        this.drawPageInitial(updatedPage);
        this.loadingFirstCurrentPage.set(false);
      });

    const lastMainImageItemName = this.mainImageItem()._id;

    // Set the current image (with its orientation) BEFORE applyDefaultZoom so
    // the redraw it triggers (redrawImageOnCanvas -> drawOrientedImage() with no
    // argument) reads the new orientation instead of the previous scan's. Not
    // doing this repaints the freshly loaded scan with the old orientation,
    // leaving it visibly wrong until an unrelated redraw (e.g. a resize) fixes it.
    this.mainImageItem.set({ ...imgItem });

    this.applyDefaultZoom();

    this.mainImageItem.set({ ...imgItem, url: c.toDataURL('image/jpeg') });

    if (
      imgItem._id && lastMainImageItemName && imgItem._id !== lastMainImageItemName
      && this.imgWasEdited() && !this.clickedPageNumberFilter
    ) {
      this.updateImagesByEdited(lastMainImageItemName);
    }
  }

  private correctPageBounds<T extends {
    xc: number;
    yc: number;
    width: number;
    height: number;
    angle: number;
  }>(page: T): T & {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } {
    const { left, right, top, bottom } = this.computeBounds(
      page.xc,
      page.yc,
      page.width,
      page.height,
      page.angle
    );

    let xc = page.xc;
    let yc = page.yc;
    let width = page.width;
    let height = page.height;

    let correctedLeft = left;
    let correctedRight = right;
    let correctedTop = top;
    let correctedBottom = bottom;

    if (left < 0) {
      correctedLeft = 0;
      xc += Math.abs(left / 2);
      width -= Math.abs(left);
    }

    if (right > 1) {
      correctedRight = 1;
      xc -= Math.abs((right - 1) / 2);
      width -= right - 1;
    }

    if (top < 0) {
      correctedTop = 0;
      yc += Math.abs(top / 2);
      height -= Math.abs(top);
    }

    if (bottom > 1) {
      correctedBottom = 1;
      yc -= Math.abs((bottom - 1) / 2);
      height -= bottom - 1;
    }

    return {
      ...page,
      xc: roundToDecimals(xc, 4),
      yc: roundToDecimals(yc, 4),
      width: roundToDecimals(width, 4),
      height: roundToDecimals(height, 4),
      left: roundToDecimals(correctedLeft, 4),
      right: roundToDecimals(correctedRight, 4),
      top: roundToDecimals(correctedTop, 4),
      bottom: roundToDecimals(correctedBottom, 4),
    };
  }

  drawPagePredicted(p: Page): void {
    const { ctx } = this;

    const { centerX, centerY, width, height } = this.getPageRectPx(p);
    
    ctx.save();

    ctx.translate(centerX, centerY);
    ctx.rotate(degreeToRadian(p.angle));

    // Outline
    ctx.strokeStyle = `${predictedColor}B2`;
    const pageOutlineWidth = !this.selectedPage
      ? outlineWidthDict['Silný']
      : this.pageOutlineWidthSecondary;
    ctx.lineWidth = pageOutlineWidth;
    ctx.strokeRect(
      -width / 2 - pageOutlineWidth / 2,
      -height / 2 - pageOutlineWidth / 2,
      width + pageOutlineWidth,
      height + pageOutlineWidth
    );

    ctx.restore();
  }

  private drawPageInitial(p: Page): void {
    const { ctx } = this;

    const { centerX, centerY, width, height } = this.getPageRectPx(p);
    
    ctx.save();

    ctx.translate(centerX, centerY);
    ctx.rotate(degreeToRadian(p.angle));

    // Outline — nothing is selected here (initial paint), so 'Žádný' still
    // shows a thin outline to keep crops visible.
    const outlineWidth = this.outlineWidthLabel() === 'Žádný'
      ? this.pageOutlineWidthSecondary
      : outlineWidthDict[this.outlineWidthLabel()];
    if (this.outlineDashed) ctx.setLineDash([this.dashLength, this.dashGapLength]);
    ctx.strokeStyle = getColor(p) + 'B2';
    ctx.lineWidth = outlineWidth;
    ctx.strokeRect(
      -width / 2 - outlineWidth / 2,
      -height / 2 - outlineWidth / 2,
      width + outlineWidth,
      height + outlineWidth
    );
    ctx.setLineDash([]);

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

  refitMainImageToCanvas(): void {
    if (!this.mainImage) return;

    this.resizeCanvasToEditor();
    this.updateImageRect(this.mainImage, this.mainImageItem().orientation);
    this.redrawAllPages();
  }

  normalizeImageForDisplay(img: ImageItem): ImageItem {
    const orientation = this.normalizeOrientation(img.orientation);
    if (orientation === 0) return { ...img, orientation };

    return {
      ...img,
      orientation,
      pages: img.pages.map(page => this.pageFromOriginalOrientation(page, orientation))
    };
  }

  private resizeCanvasToEditor(): void {
    const appMain = document.querySelector('app-main-editor') as HTMLElement;
    const appStyle = getComputedStyle(appMain);
    const appRect = appMain.getBoundingClientRect();

    this.c.width =
      appRect.width -
      (parseFloat(appStyle.paddingLeft) +
        parseFloat(appStyle.paddingRight) +
        parseFloat(appStyle.borderLeftWidth) +
        parseFloat(appStyle.borderRightWidth));

    this.c.height =
      appRect.height -
      (parseFloat(appStyle.paddingTop) +
        parseFloat(appStyle.paddingBottom) +
        parseFloat(appStyle.borderTopWidth) +
        parseFloat(appStyle.borderBottomWidth));
  }

  private updateImageRect(img: HTMLImageElement, orientation?: ImageOrientation): void {
    if (orientation || orientation === 0) this.orientation.set(orientation);
    const { width: orientedWidth, height: orientedHeight } = this.getOrientedImageSize(img, orientation);
    const imgRatio = orientedWidth / orientedHeight;
    const canvasRatio = this.c.width / this.c.height;

    let drawWidth: number = this.c.width;
    let drawHeight: number = this.c.height;

    imgRatio > canvasRatio
      ? drawHeight = this.c.width / imgRatio
      : drawWidth = this.c.height * imgRatio;

    this.imageRect = {
      x: (this.c.width - drawWidth) / 2,
      y: (this.c.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    };
  }

  private getOrientedImageSize(img: HTMLImageElement, orientation?: ImageOrientation): { width: number; height: number } {
    const normalized = this.normalizeOrientation(orientation);
    return normalized === 90 || normalized === 270
      ? { width: img.height, height: img.width }
      : { width: img.width, height: img.height };
  }

  private drawOrientedImage(orientationValue?: ImageOrientation): void {
    if (!this.mainImage) return;

    const { ctx } = this;
    const { x, y, width, height } = this.imageRect;
    const orientation = this.normalizeOrientation(orientationValue ?? this.mainImageItem().orientation);

    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(degreeToRadian(orientation));

    orientation === 90 || orientation === 270
      ? ctx.drawImage(this.mainImage, -height / 2, -width / 2, height, width)
      : ctx.drawImage(this.mainImage, -width / 2, -height / 2, width, height);

    ctx.restore();
  }

  private normalizeOrientation(orientation?: ImageOrientation): ImageOrientation {
    const normalized = (((orientation ?? 0) % 360 + 360) % 360) as ImageOrientation;
    return [0, 90, 180, 270].includes(normalized) ? normalized : 0;
  }

  private getInverseOrientation(orientation: ImageOrientation): ImageOrientation {
    switch (orientation) {
      case 90:
        return 270;
      case 180:
        return 180;
      case 270:
        return 90;
      case 0:
      default:
        return 0;
    }
  }

  private rotatePageGeometry(page: Page, degrees: 0 | 90 | 180 | 270): Page {
    let rotated: Page;

    switch (degrees) {
      case 90:
        rotated = {
          ...page,
          xc: 1 - page.yc,
          yc: page.xc,
          width: page.height,
          height: page.width,
        };
        break;

      case 180:
        rotated = {
          ...page,
          xc: 1 - page.xc,
          yc: 1 - page.yc,
        };
        break;

      case 270:
        rotated = {
          ...page,
          xc: page.yc,
          yc: 1 - page.xc,
          width: page.height,
          height: page.width,
        };
        break;

      case 0:
      default:
        rotated = { ...page };
        break;
    }

    const bounds = this.computeBounds(rotated.xc, rotated.yc, rotated.width, rotated.height, rotated.angle);

    return {
      ...rotated,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    };
  }

  private pageFromOriginalOrientation(page: Page, orientation?: ImageOrientation): Page {
    let transformed = { ...page };
    const turns = this.normalizeOrientation(orientation) / 90;

    for (let i = 0; i < turns; i++) {
      transformed = this.rotatePageCoordinates(transformed, 'right');
    }

    return transformed;
  }

  private pageToOriginalOrientation(page: Page, orientation?: ImageOrientation): Pick<Page, 'xc' | 'yc' | 'width' | 'height'> {
    let transformed = { ...page };
    const turns = this.normalizeOrientation(orientation) / 90;

    for (let i = 0; i < turns; i++) {
      transformed = this.rotatePageCoordinates(transformed, 'left');
    }

    return {
      xc: roundToDecimals(transformed.xc, 4),
      yc: roundToDecimals(transformed.yc, 4),
      width: roundToDecimals(transformed.width, 4),
      height: roundToDecimals(transformed.height, 4),
    };
  }

  private rotatePageCoordinates(page: Page, direction: 'left' | 'right'): Page {
    return direction === 'right'
      ? {
          ...page,
          xc: 1 - page.yc,
          yc: page.xc,
          left: 1 - page.bottom,
          right: 1 - page.top,
          top: page.left,
          bottom: page.right,
          width: page.height,
          height: page.width,
        }
      : {
          ...page,
          xc: page.yc,
          yc: 1 - page.xc,
          left: page.top,
          right: page.bottom,
          top: 1 - page.right,
          bottom: 1 - page.left,
          width: page.height,
          height: page.width,
        };
  }


  // ========== ZOOMING ==========
  private applyViewportTransform(ctx: CanvasRenderingContext2D): void {
    const { x, y, scale } = this.viewport;
    ctx.setTransform(scale, 0, 0, scale, x, y);
  }

  resetZoom(): void {
    this.viewport = { x: 0, y: 0, scale: 1 };
    this.snapped = false;

    this.redrawAllPages();
  }

  // Default zooming
  setZoomAt(screenX: number, screenY: number, newScale: number): void {
    this.snapped = false;
    
    const oldScale = this.viewport.scale;
    const scale = clamp(newScale, this.minZoom, this.maxZoom);
    
    if (scale === oldScale) return;
    if (scale === 1) {
      this.resetZoom();
      return;
    }

    const worldX = (screenX - this.viewport.x) / oldScale;
    const worldY = (screenY - this.viewport.y) / oldScale;

    this.viewport.x = screenX - worldX * scale;
    this.viewport.y = screenY - worldY * scale;
    this.viewport.scale = scale;

    this.clampViewportToMinZoomEnvelope();
    this.redrawAllPages();
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.snapped = false;
    
    this.viewport.x += dxScreen;
    this.viewport.y += dyScreen;

    this.clampViewportToMinZoomEnvelope();
    this.redrawAllPages();
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
    const currentScale = roundToDecimals(this.viewport.scale, 2);
    const scale = type === 'in'
      ? currentScale < 1
        ? 1
        : currentScale + this.btnZoomStep
      : currentScale <= 1
        ? this.minZoom
        : Math.max(1, currentScale - this.btnZoomStep);

    this.setZoomAt(x, y, roundToDecimals(scale, 2));
  }

  fitZoomToPages(safePadding: number = 32): void {
    if (!this.c || !this.currentPages.length) return;

    const { width: canvasWidth, height: canvasHeight } = this.c;
    const { x, y, width, height } = this.imageRect;

    const left = Math.min(...this.currentPages.map(page => x + width * page.left));
    const right = Math.max(...this.currentPages.map(page => x + width * page.right));
    const top = Math.min(...this.currentPages.map(page => y + height * page.top));
    const bottom = Math.max(...this.currentPages.map(page => y + height * page.bottom));

    const boundsWidth = right - left;
    const boundsHeight = bottom - top;
    if (boundsWidth <= 0 || boundsHeight <= 0) return;

    const padding = Math.min(safePadding, canvasWidth / 4, canvasHeight / 4);
    const availableWidth = canvasWidth - 2 * padding;
    const availableHeight = canvasHeight - 2 * padding;
    const scale = clamp(
      Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
      this.minZoom,
      this.maxZoom
    );

    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;

    this.viewport = {
      scale,
      x: canvasWidth / 2 - centerX * scale,
      y: canvasHeight / 2 - centerY * scale,
    };

    this.snapped = false;
    this.clampViewportToMinZoomEnvelope();
    this.redrawAllPages();
  }

  applyDefaultZoom(): void {
    if (this.defaultFitMode() === 'selection' && this.currentPages.length) {
      this.fitZoomToPages();
      return;
    }

    this.resetZoom();
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

    this.redrawAllPages();
  }


  // ========== PREV / NEXT IMAGE ==========
  async showPrevImage(): Promise<void> {
    if (this.currentIndex() === 0 || !this.displayedImagesFinal().length) return;
    this.updateImagesByCurrentPages();
    this.showImage(-1);
    if (this.imgWasEdited()) {
      await this.ui.waitForFalse(this.imgWasEdited);
      this.setDisplayedImages();
    }
  }

  async showNextImage(): Promise<void> {
    const displayedImages = this.displayedImagesFinal();
    if (this.currentIndex() === displayedImages.length - 1 || !displayedImages.length) return;
    this.updateImagesByCurrentPages();
    this.showImage(1);
    if (this.imgWasEdited()) {
      await this.ui.waitForFalse(this.imgWasEdited);
      this.setDisplayedImages();
    }
  }

  async showFirstImage(): Promise<void> {
    if (this.currentIndex() === 0 || !this.displayedImagesFinal().length) return;
    this.updateImagesByCurrentPages();
    this.showImage(0);
    if (this.imgWasEdited()) {
      await this.ui.waitForFalse(this.imgWasEdited);
      this.setDisplayedImages();
    }
  }

  async showLastImage(): Promise<void> {
    const displayedImages = this.displayedImagesFinal();
    if (this.currentIndex() === displayedImages.length - 1 || !displayedImages.length) return;
    this.updateImagesByCurrentPages();
    this.showImage(1000);
    if (this.imgWasEdited()) {
      await this.ui.waitForFalse(this.imgWasEdited);
      this.setDisplayedImages();
    }
  }

  private showImage(offset: number): void {
    const displayedImages = this.displayedImagesFinal();
    const length = displayedImages.length;
    const newImage = [0, 1000].includes(offset)
      ? displayedImages[offset === 0 ? 0 : length - 1]
      : length === 1
        ? this.emptyImageItem
        : displayedImages[(this.currentIndex() + offset + length) % length];
    
    this.setMainImage(newImage);

    if (length === 1) {
      this.setDisplayedImages();
      this.mainImageItem.set(this.emptyImageItem);
    }
    scrollToSelectedImage(newImage._id);
  }


  // ========== ROTATING ==========
  rotate(orientation: ImageOrientation): void {
    if (this.rotationScope() === 'all') {
      this.rotateAll(orientation);
      return;
    }

    if (!this.auth.canEditTitle() || !this.displayedImagesFinal().length || !this.mainImage) return;
    if (orientation === this.orientation()) return;
    if (this.pageWasEdited) this.updateCurrentPagesWithEdited();

    const currentImage = this.mainImageItem();
    const currentOrientation = this.orientation();

    const originalPredictedPages = this.predictedImages().find(img => img._id === currentImage._id)?.pages;

    const basePages = currentOrientation === 0
      ? this.currentPages
      : this.currentPages.map(p => this.rotatePageGeometry(p, this.getInverseOrientation(currentOrientation)));

    this.updateImageRect(this.mainImage, orientation);

    this.selectedPage = null;
    this.lastSelectedPage = null;
    this.lastPageCursorIsInside = null;

    this.currentPages = basePages.map(p => this.rotatePageGeometry(p, orientation));
    if (originalPredictedPages) this.currentPredictedPages = originalPredictedPages.map(p => this.rotatePageGeometry(p, orientation));

    this.mainImageItem.set({
      ...currentImage,
      orientation,
      edited: true,
      pages: this.currentPages,
    });

    const updateCurrentImage = (images: ImageItem[]): ImageItem[] =>
      images.map(img =>
        img._id === currentImage._id
          ? {
              ...img,
              orientation,
              edited: true,
              pages: this.currentPages,
            }
          : img
      );

    this.images.update(updateCurrentImage);
    this.displayedImages.update(updateCurrentImage);
    this.displayedImagesPages.update(updateCurrentImage);

    this.predictedOrientedImages.update(prev =>
      prev.map(img =>
        img._id === currentImage._id
          ? {
              ...img,
              orientation,
              edited: false,
              pages: this.currentPredictedPages,
            }
          : img
      )
    );

    this.applyDefaultZoom();
    this.updateMainImageItem();

    this.imgWasEdited.set(true);
    this.sthWasEdited = true;
  }

  isOrientationActive(orientation: ImageOrientation): boolean {
    if (this.rotationScope() === 'current') {
      return this.orientation() === orientation;
    }

    const images = this.images();
    return images.length > 0
      && images.every(image => this.normalizeOrientation(image.orientation) === orientation);
  }

  private rotateAll(orientation: ImageOrientation): void {
    if (!this.auth.canEditTitle() || !this.images().length || !this.mainImage) return;

    if (this.pageWasEdited) this.updateCurrentPagesWithEdited();
    this.updateImagesByCurrentPages();

    const currentImageId = this.mainImageItem()._id;
    if (this.imgWasEdited()) this.updateImagesByEdited(currentImageId);

    const changedImageIds = new Set(
      this.images()
        .filter(image => this.normalizeOrientation(image.orientation) !== orientation)
        .map(image => image._id)
    );

    if (!changedImageIds.size) return;

    const updateOrientation = (image: ImageItem, edited: boolean): ImageItem => {
      const currentOrientation = this.normalizeOrientation(image.orientation);
      if (currentOrientation === orientation) return image;

      const pagesInOriginalOrientation = currentOrientation === 0
        ? image.pages
        : image.pages.map(page =>
            this.rotatePageGeometry(page, this.getInverseOrientation(currentOrientation))
          );

      return {
        ...image,
        orientation,
        edited,
        pages: pagesInOriginalOrientation.map(page =>
          this.rotatePageGeometry(page, orientation)
        ),
      };
    };

    const updatedImages = this.images().map(image =>
      updateOrientation(image, true)
    );
    const imagesById = new Map(updatedImages.map(image => [image._id, image]));

    this.images.set(updatedImages);
    this.displayedImages.update(images =>
      images.map(image => imagesById.get(image._id) ?? image)
    );
    this.displayedImagesPages.update(images =>
      images.map(image => imagesById.get(image._id) ?? image)
    );

    const updatedPredictedImages = this.predictedOrientedImages().map(image =>
      updateOrientation(image, false)
    );
    this.predictedOrientedImages.set(updatedPredictedImages);

    const updatedCurrentImage = imagesById.get(currentImageId);
    if (!updatedCurrentImage) return;

    this.updateImageRect(this.mainImage, orientation);

    this.selectedPage = null;
    this.lastSelectedPage = null;
    this.lastPageCursorIsInside = null;
    this.currentPages = updatedCurrentImage.pages;
    this.currentPredictedPages =
      updatedPredictedImages.find(image => image._id === currentImageId)?.pages ?? [];

    this.mainImageItem.set({
      ...updatedCurrentImage,
      url: this.mainImageItem().url,
    });

    this.applyDefaultZoom();
    this.updateMainImageItem();

    this.imgWasEdited.set(changedImageIds.has(currentImageId));
    this.sthWasEdited = true;
  }



  // ========== PAGE LOGIC ==========
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
    this.redrawAllPages(hoveredPageId);
  }

  updateHoverPage(): void {
    if (!this.auth.canEditTitle()) return;
    
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
    const outlineWidthLabel = this.outlineWidthLabel();
    const isSelectedPage = this.selectedPage?._id === p._id;
    // 'Žádný' hides the outline only on the focused (selected) crop; when nothing
    // is selected, fall back to a thin outline so crops stay visible in the overview.
    const hideOutline = outlineWidthLabel === 'Žádný' && isSelectedPage;
    const pageOutlineWidth = isPageNotSelectedWhileOtherIs || outlineWidthLabel === 'Žádný'
      ? this.pageOutlineWidthSecondary
      : outlineWidthDict[outlineWidthLabel];
    
    ctx.save();

    ctx.translate(centerX, centerY);
    ctx.rotate(degreeToRadian(p.angle));

    // Outline
    {
      if (this.outlineDashed) ctx.setLineDash([this.dashLength, this.dashGapLength]);

      ctx.strokeStyle = hideOutline
        ? transparentColor
        : color + (isPageNotSelectedWhileOtherIs ? '77' : 'B2');
      ctx.lineWidth = pageOutlineWidth;
      ctx.strokeRect(
        -width / 2 - pageOutlineWidth / 2,
        -height / 2 - pageOutlineWidth / 2,
        width + pageOutlineWidth,
        height + pageOutlineWidth
      );

      ctx.setLineDash([]);
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
      const gridSpacing = gridDensityDict[this.gridDensityLabel()];
      const hw = width / 2;
      const hh = height / 2;
      const left = -hw;
      const top = -hh;
      const right = hw;
      const bottom = hh;

      ctx.save();
      ctx.beginPath();

      // Keep the configured visual line width stable while the canvas is scaled.
      const sx = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
      ctx.lineWidth = gridLineWidthDict[this.gridLineWidthLabel()] / sx;

      ctx.strokeStyle = gridColorDict[this.gridColorLabel()];

      // Align to half-pixel in local space so thin canvas lines stay crisp.
      // Also ensure the first line starts exactly at the top-left corner.
      const xStart = left + gridSpacing + 0.5;
      const yStart = top + gridSpacing + 0.5;

      // Vertical lines
      for (let x = xStart; x <= right; x += gridSpacing) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }

      // Horizontal lines
      for (let y = yStart; y <= bottom; y += gridSpacing) {
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
      ctx.strokeStyle = p._id === this.selectedPage?._id && outlineWidthLabel === 'Žádný'
        ? transparentColor
        : color + 'B2';
      const cornerOutlineWidth = pageOutlineWidth - 1;
      ctx.lineWidth = cornerOutlineWidth;

      for (const c of corners) {
        const outlineOffset = outlineWidthLabel === 'Žádný' ? 0 : cornerOutlineWidth;
        const negativeOffset = this.cornerSize + outlineOffset;

        const offsetX = c.x < 0 ? -negativeOffset : outlineOffset;
        const offsetY = c.y < 0 ? -negativeOffset : outlineOffset;

        ctx.fillRect(c.x + offsetX, c.y + offsetY, this.cornerSize, this.cornerSize);
        ctx.strokeRect(
          c.x + offsetX - cornerOutlineWidth / 2,
          c.y + offsetY - cornerOutlineWidth / 2,
          this.cornerSize + cornerOutlineWidth,
          this.cornerSize + cornerOutlineWidth
        );
      }
    }

    ctx.restore();
  }
  
  addPage(): void {
    if (!this.auth.canEditTitle() || this.currentPages.length >= this.maxPages || !this.displayedImagesFinal().length) return;

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
    this.redrawAllPages();

    this.applyDefaultZoom();
  }

  removePage(): void {
    this.currentPages = this.currentPages.filter(p => p !== this.selectedPage);
    if (this.currentPages.length) this.currentPages = this.currentPages.map(p => ({ ...p, type: 'single' }));
    this.selectedPage = null;
    this.redrawAllPages();
    this.updateMainImageItem();
    this.pageWasEdited = true;
    this.imgWasEdited.set(true);
    this.sthWasEdited = true;
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

  redrawImageOnCanvas(): void {
    const { c, ctx } = this;
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    
    if (!this.mainImage) return;

    this.applyViewportTransform(ctx);
    this.drawOrientedImage();

    if (this.selectedPage) {
      this.dimOutside(this.selectedPage);
    }
  }

  redrawAllPages(hoveredPageId?: string): void {
    this.redrawImageOnCanvas();
    if (this.showPredictions) this.currentPredictedPages.forEach(p => this.drawPagePredicted(p));
    this.currentPages.forEach(p => this.drawPage(p, hoveredPageId));
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


  // ========== DIALOG ACTIONS ==========
  gridRadio = signal<GridMode>('when-rotating');
  gridDensityRadio = signal<GridDensityLabel>('Hustá');
  gridColorRadio = signal<GridColorLabel>('Modrá');
  gridLineWidthRadio = signal<GridLineWidthLabel>('Tenká');
  outlineRadio = signal<OutlineWidthLabel>('Silný');
  dimRadio = signal<DimColor>('Černá');
  scanTypeRadio = signal<ScanType>('all');
  pageNumberRadio = signal<PageNumberType>('all');
  defaultFitModeRadio = signal<DefaultFitMode>('page');

  openSettingsDialog(): void {
    const ui = this.ui;
    this.resetSettingsDraft();
    
    ui.dialogWidth.set(600);
    ui.dialogTitle.set('Nastavení');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('settings');
    ui.dialogDescription.set(null);
    ui.dialogButtons.set([
      { 
        label: 'Reset',
        action: () => {
          this.showPredictions = false;
          this.storage.remove('showPredictions');
          this.gridRadio.set('when-rotating');
          this.gridMode.set('when-rotating');
          this.storage.set('gridMode', 'when-rotating');
          this.gridDensityRadio.set('Hustá');
          this.gridDensityLabel.set('Hustá');
          this.storage.set('gridDensityLabel', 'Hustá');
          this.gridColorRadio.set('Modrá');
          this.gridColorLabel.set('Modrá');
          this.storage.set('gridColorLabel', 'Modrá');
          this.gridLineWidthRadio.set('Tenká');
          this.gridLineWidthLabel.set('Tenká');
          this.storage.set('gridLineWidthLabel', 'Tenká');
          this.outlineRadio.set('Silný');
          this.outlineWidthLabel.set('Silný');
          this.storage.set('outlineWidthLabel', 'Silný');
          this.outlineDashed = false;
          this.storage.set('outlineDashed', false);
          this.storage.remove('outlineTransparent');
          this.dimColor.set('Černá');
          this.dimRadio.set('Černá');
          this.storage.set('dimColor', 'Černá');
          this.scanTypeRadio.set('all');
          this.storage.set('filterScanTypeStart', 'all');
          this.pageNumberRadio.set('all');
          this.storage.set('filterPageNumberStart', 'all');
          this.defaultFitMode.set('page');
          this.defaultFitModeRadio.set('page');
          this.storage.set('defaultFitMode', 'page');
          this.applyDefaultZoom();
          ui.closeDialog();
          ui.showToast('Nastavení bylo resetováno.', { type: 'success' });
        }
      },
      {
        label: 'Uložit',
        primary: true,
        action: () => {
          ui.closeDialog();
          this.saveSettings();
        }
      }
    ]);

    ui.openDialog();
  }

  resetSettingsDraft(): void {
    this.gridRadio.set(this.gridMode());
    this.gridDensityRadio.set(this.gridDensityLabel());
    this.gridColorRadio.set(this.gridColorLabel());
    this.gridLineWidthRadio.set(this.gridLineWidthLabel());
    this.outlineRadio.set(this.outlineWidthLabel());
    this.dimRadio.set(this.dimColor());
    this.scanTypeRadio.set(this.selectedFilter ?? 'all');
    this.pageNumberRadio.set(this.selectedPageNumberFilter() ?? 'all');
    this.defaultFitModeRadio.set(this.defaultFitMode());
  }

  togglePredictions(): void {
    this.showPredictions = !this.showPredictions;
  }

  toggleOutlineDashed(): void {
    this.outlineDashed = !this.outlineDashed;
  }

  saveSettings(): void {
    this.storage.set('showPredictions', this.showPredictions);
    const gridRadio = this.gridRadio();
    this.gridMode.set(gridRadio);
    this.storage.set('gridMode', gridRadio);
    const gridDensityRadio = this.gridDensityRadio();
    this.gridDensityLabel.set(gridDensityRadio);
    this.storage.set('gridDensityLabel', gridDensityRadio);
    const gridColorRadio = this.gridColorRadio();
    this.gridColorLabel.set(gridColorRadio);
    this.storage.set('gridColorLabel', gridColorRadio);
    const gridLineWidthRadio = this.gridLineWidthRadio();
    this.gridLineWidthLabel.set(gridLineWidthRadio);
    this.storage.set('gridLineWidthLabel', gridLineWidthRadio);
    const outlineRadio = this.outlineRadio();
    this.outlineWidthLabel.set(outlineRadio);
    this.storage.set('outlineWidthLabel', outlineRadio);
    this.storage.set('outlineDashed', this.outlineDashed);
    const dimRadio = this.dimRadio();
    this.dimColor.set(dimRadio);
    this.storage.set('dimColor', dimRadio);
    
    this.lastSelectedImageId = this.mainImageItem()._id;
    this.storage.set('lastSelectedImageId', `${this.lastSelectedImageId}`);

    this.storage.set('filterScanTypeStart', this.scanTypeRadio());
    this.storage.set('filterPageNumberStart', this.pageNumberRadio());
    const defaultFitModeRadio = this.defaultFitModeRadio();
    this.defaultFitMode.set(defaultFitModeRadio);
    this.storage.set('defaultFitMode', defaultFitModeRadio);
    this.applyDefaultZoom();
    this.ui.showToast('Nastavení bylo uloženo.', { type: 'success' });
  }

  openShortcutsDialog(): void {
    const ui = this.ui;

    ui.dialogWidth.set(680);
    ui.dialogTitle.set('Klávesové zkratky');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('shortcuts');
    ui.dialogDescription.set(null);
    ui.dialogButtons.set([]);

    ui.openDialog();
  }

  openResetDocDialog(): void {
    if (!this.auth.canWriteTitle()) return;
    const ui = this.ui;
    
    ui.dialogWidth.set(680);
    ui.dialogTitle.set('Opravdu chcete resetovat změny dokumentu?');
    ui.dialogContent.set(false);
    ui.dialogContentType.set(null);
    ui.dialogDescription.set('Reset změn se týká celého dokumentu.');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Resetovat celý dokument',
        primary: true,
        destructive: true,
        action: () => {
          ui.closeDialog();
          this.resetDoc();
        }
      }
    ]);

    ui.openDialog();
  }

  openResetScanDialog(): void {
    if (!this.auth.canWriteTitle()) return;
    const ui = this.ui;

    ui.dialogWidth.set(680);
    ui.dialogTitle.set('Opravdu chcete resetovat změny skenu?');
    ui.dialogContent.set(false);
    ui.dialogContentType.set(null);
    ui.dialogDescription.set('Reset změn se týká aktuálního skenu.');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Resetovat změny skenu',
        primary: true,
        destructive: true,
        action: () => {
          ui.closeDialog();
          this.resetScan();
        }
      }
    ]);

    ui.openDialog();
  }


  // ========== KEYBOARD SHORTCUTS ==========
  private isHandledKey(key: string): boolean {
    return [
      '+', 'ě', 'Ě', '1', '2',                              // Select left / right page OR + Alt / Cmd = filters number of pages
      'Escape',                                             // Unselect page
      'Backspace', 'Delete',                                // Remove page
      'p', 'P',                                             // Add page
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',    // Drag selected page x, y by 1; not selected prev/next scan
      'PageDown', 'PageUp',                                 // (+ PageUp / PageDown)
      'Home', 'End',                                        // First / last scan
      'm', 'M',                                             // Mřížka / grid
      'o', 'O',                                             // Obrys / outline
      'c', 'C',                                             // Clona (barva)
      'Enter', 'b', 'B',                                    // Next scan, + control/cmd = uložit vše
      'F1', 'F2', 'F3', 'F4',                               // Filters
      'Shift',                                              // + arrows = change width / height by 1
      'Control', 'Meta',                                    // + R = reset změn skenu; + shift + R = reset změn dokumentu
      'a', 'A', 's', 'S',                                   // Rotate page by 1
      'd', 'D', 'f', 'F', 'g', 'G', 'h', 'H',               // Rotate scan
      'k', 'K',                                             // Shortcuts
      'q', 'Q', 'w', 'W', 'e', 'E', 'r', 'R',               // Zooming
      'Tab',                                                // Cycle through current pages
      'j', 'J'                                              // Show predictions
    ].includes(key);
  }

  async onKeyDown(event: KeyboardEvent): Promise<void> {
    const key = event.key;
    if (!this.isHandledKey(key) || (event.target as HTMLElement).tagName === 'INPUT') return;
    event.preventDefault();
    event.stopPropagation();
    const dialogOpen = this.ui.dialogOpen();
    const canWriteTitle = this.auth.canWriteTitle();
    // Editing shortcuts are available in read mode too; only saving is restricted.
    const canEditTitle = this.auth.canEditTitle();

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
      
      if (!canEditTitle) return;
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
      this.redrawAllPages();
      this.updateMainImageItem();
    }

    // Unselect page
    if (canEditTitle && key === 'Escape') {
      if (dialogOpen) {
        this.ui.dialogOpen.set(false);
        this.ui.dialogOpened = false;
        if (this.ui.dialogTitle() === 'Nastavení') this.resetSettingsDraft();
        return;
      }
      
      if (this.pageWasEdited) this.updateCurrentPagesWithEdited();
      this.lastSelectedPage = this.selectedPage;
      this.selectedPage = null;
      this.lastPageCursorIsInside = null;
      this.redrawAllPages();
      this.updateMainImageItem();
    }

    // Remove selected page
    if (canEditTitle && ['Backspace', 'Delete'].includes(key) && !dialogOpen && this.selectedPage) this.removePage();

    // Add page
    if (canEditTitle && ['p', 'P'].includes(key) && !dialogOpen && this.currentPages.length < this.maxPages) this.addPage();

    // Show predictions
    if (this.auth.isAdmin() && ['j', 'J'].includes(key) && !dialogOpen) {
      this.showPredictions = !this.showPredictions;
      this.storage.set('showPredictions', this.showPredictions);
      window.location.reload();
    }

    // Change grid mode
    if (canEditTitle && ['m', 'M'].includes(key) && this.selectedPage &&!dialogOpen) {
      this.gridMode.set(!this.isRotating
        ? this.gridMode() === 'always' ? 'when-rotating' : 'always'
        : this.gridMode() === 'never' ? 'when-rotating' : 'never');
      const gridMode = this.gridMode();
      this.gridRadio.set(gridMode);
      this.storage.set('gridMode', gridMode);
      this.redrawAllPages();
    };

    // Outline width
    if (canEditTitle && ['o', 'O'].includes(key) && this.selectedPage && !dialogOpen) {
      const outlineWidthLabel = this.outlineWidthLabel();
      this.outlineWidthLabel.set(outlineWidthLabel === 'Silný' ? 'Střední' : (outlineWidthLabel === 'Střední' ? 'Tenký' : (outlineWidthLabel === 'Tenký' ? 'Žádný' : 'Silný')));
      const outlineWidthLabel2 = this.outlineWidthLabel();
      this.outlineRadio.set(outlineWidthLabel2);
      this.storage.set('outlineWidthLabel', outlineWidthLabel2);
      this.redrawAllPages();
    }

    // Dimming color
    if (canEditTitle && ['c', 'C'].includes(key) && this.selectedPage && !event.ctrlKey && !event.metaKey && !dialogOpen) {
      this.dimColor.update(prev => prev === 'Černá' ? 'Červená' : (prev === 'Červená' ? 'Bílá' : (prev === 'Bílá' ? 'Žádná' : 'Černá')));
      this.dimRadio.set(this.dimColor());
      this.storage.set('dimColor', this.dimColor());
      this.redrawAllPages();
    }

    // Prev/next scan
    if (((['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && !this.selectedPage) || ['PageDown', 'PageUp'].includes(key)) && !dialogOpen) {
      const prevKeys = new Set(['PageUp', 'ArrowLeft', 'ArrowUp']);
      const nextKeys = new Set(['PageDown', 'ArrowRight', 'ArrowDown']);

      const isAllowedArrow = !this.selectedPage && (prevKeys.has(key) || nextKeys.has(key));
      const isPageKey = key === 'PageUp' || key === 'PageDown';

      if (isPageKey || isAllowedArrow) prevKeys.has(key) ? this.showPrevImage() : this.showNextImage();
    }

    // First/last scan
    if ((['Home', 'End'].includes(key)) && !dialogOpen) {
      const isHomeKey = key === 'Home';
      isHomeKey ? this.showFirstImage() : this.showLastImage();
    }

    // Drag/move page
    if (canEditTitle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && this.selectedPage && !event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && !dialogOpen) {
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
      this.sthWasEdited = true;
      this.selectedPage = updatedPage;
      this.lastSelectedPage = updatedPage;
      this.currentPages = this.currentPages.map(p =>p._id === updatedPage._id ? updatedPage : p);

      this.redrawAllPages();
    }

    // Change page width / height
    if (canEditTitle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && event.shiftKey && this.selectedPage && !dialogOpen) {
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
      this.sthWasEdited = true;
      this.redrawAllPages();
    }

    // Rotate page by 1
    if (canEditTitle && ['a', 'A', 's', 'S'].includes(key) && this.selectedPage && !dialogOpen) {
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
      this.sthWasEdited = true;
      this.redrawAllPages();
    }

    // Rotate scan
    if (canEditTitle && ['d', 'D', 'f', 'F', 'g', 'G', 'h', 'H'].includes(key) && !dialogOpen) {
      if (['d', 'D'].includes(key)) this.rotate(270);
      if (['f', 'F'].includes(key)) this.rotate(0);
      if (['g', 'G'].includes(key)) this.rotate(90);
      if (['h', 'H'].includes(key)) this.rotate(180);
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
    if (['Enter', 'b', 'B'].includes(key) && !event.ctrlKey && !event.metaKey && !dialogOpen) {
      if (!canWriteTitle) {
        this.showNextImage();
        return;
      }

      const mostRightPage = this.currentPages.reduce((max, page) => page.xc > max.xc ? page : max);

      if (this.selectedPage && this.selectedPage !== mostRightPage && this.currentPages.length > 1) {
        if (this.pageWasEdited) this.updateCurrentPagesWithEdited();
        
        const potentialNewIndex = this.currentPages.findIndex(p => p._id === this.selectedPage?._id) + 1;
        const newIndex = potentialNewIndex === this.currentPages.length ? 0 : potentialNewIndex;
        this.selectedPage = this.currentPages[newIndex];
        this.lastPageCursorIsInside = this.selectedPage;
        this.redrawAllPages();
        return;
      }
      
      if (
        this.currentPages.length < 2
        || (this.currentPages.length === this.maxPages && this.selectedPage === mostRightPage)
      ) {
        this.showNextImage();
        await this.ui.waitForFalse(this.loadingFirstCurrentPage);
        this.selectedPage = this.currentPages.reduce((min, page) => page.xc < min.xc ? page : min);
        this.lastPageCursorIsInside = this.selectedPage;
        this.redrawAllPages();
        this.updateMainImageItem();
      }
    }

    // Uložit vše
    if (canWriteTitle && key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      if (!dialogOpen) {
        this.saveChanges();
        return;
      }
      
      switch (this.ui.dialogTitle()) {
        case 'Nastavení':
          this.saveSettings();
          break;
        case 'Opravdu chcete resetovat změny dokumentu?':
          this.resetDoc();
          break;
        case 'Opravdu chcete resetovat změny skenu?':
          this.resetScan();
          break;
      }

      this.ui.closeDialog();
    };

    // Reset změn dokumentu a skenu
    {
      if (
        !dialogOpen &&
        ((key === 'R' && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey)
        || (key === 'R' && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey))
      ) {
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
      if (dialogOpen && this.ui.dialogTitle() === 'Klávesové zkratky') {
        this.ui.dialogOpen.set(false);
        this.ui.dialogOpened = false;
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
      this.redrawAllPages();
    };

    // Copy text
    if (['c', 'C'].includes(key) && (event.ctrlKey || event.metaKey) && !dialogOpen) {
      const selection = window.getSelection()?.toString();
      if (selection) navigator.clipboard.writeText(selection);
    }
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
      && this.selectedPage && !this.ui.dialogOpen()
    ) {
      this.isRotating = false;
      this.redrawAllPages();
    }
  }
}
