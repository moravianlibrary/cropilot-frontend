import { Component, ElementRef, HostListener, inject, viewChild } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { MainComponent } from '../../layout-editor/main/main.component';
import { BottomPanelComponent } from '../../layout-editor/bottom-panel/bottom-panel.component';
import { LeftPanelComponent } from '../../layout-editor/left-panel/left-panel.component';
import { RightPanelComponent } from '../../layout-editor/right-panel/right-panel.component';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, map, Observable, of, Subscription, switchMap, tap, throwError } from 'rxjs';
import { DefaultFitMode, DimColor, GridColorLabel, GridDensityLabel, GridLineWidthLabel, GridMode, ImageItem, OutlineWidthLabel, PageNumberType, ScanType, TitleDetail } from '../../app.types';
import { AuthService } from '../../services/auth.service';
import { DialogComponent } from '../../components/dialog/dialog.component';
import { UiService } from '../../services/ui.service';
import { Title } from '@angular/platform-browser';
import { scrollToElement, waitForElement } from '../../utils/utils';
import { LocalStorageService } from '../../services/local-storage.service';

@Component({
  selector: 'app-editor',
  imports: [MainComponent, BottomPanelComponent, LeftPanelComponent, RightPanelComponent, DialogComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent {
  editor = inject(EditorService);
  auth = inject(AuthService);
  ui = inject(UiService);
  private storage = inject(LocalStorageService);
  private router = inject(Router);
  private title = inject(Title);
  private activatedRoute = inject(ActivatedRoute);
  private paramsOnBookId = new Subscription();

  mainWrapper = viewChild<ElementRef<HTMLDivElement>>('mainWrapper');

  // Changes not saved alert
  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent) {
    // Read-only users can't save, so don't warn them about unsaved changes.
    if (this.editor.sthWasEdited && this.auth.canWriteTitle()) {
      event.preventDefault();
      return false;
    }

    return true;
  }

  ngOnInit() {
    const editor = this.editor;
    
    // Subscribe to params
    this.paramsOnBookId = this.activatedRoute.paramMap
      .pipe(
        map(params => params.get('book_id') || ''),
        tap(book_id => {
          if (!book_id) {
            this.router.navigate(['/not-found']);
            return;
          };

          editor.book.set(book_id);
          editor.loadingLeft = true;
          editor.loadingMain.set(true);
        }),
        switchMap(() => {
          editor.showPredictions = !!this.storage.get('showPredictions', null, true);
          const book = editor.book();
          
          const requests: [Observable<TitleDetail | null>, Observable<TitleDetail>] = [
            editor.showPredictions
              ? editor.fetchPredictedScans(book)
              : of(null),
            editor.fetchScans(book)];

          return forkJoin(requests);
        }),
        catchError(err => {
          err.status === 403
            ? this.router.navigate(['/forbidden'])
            : this.router.navigate(['/not-found']);
          console.error('Fetch error:', err);
          return throwError(() => err);
        })
      )
      .subscribe(async ([resPredicted, res]) => {

        // Set tab title
        this.title.setTitle(`${res.external_id} | CROPILOT`);

        // Set images
        const imgItems: ImageItem[] = res.scans.map(img => editor.normalizeImageForDisplay(img));
        const imgItemsPredicted: ImageItem[] | undefined = resPredicted?.scans?.map(img => editor.normalizeImageForDisplay(img));
        editor.loadingLeft = false;
        editor.images.set(imgItems);
        editor.originalImages.set(imgItems);
        editor.predictedImages.set(imgItemsPredicted ?? []);
        editor.predictedOrientedImages.set(imgItemsPredicted ?? []);

        // Set settings stuff
        editor.dimColor.set(this.storage.get('dimColor', 'Černá', true) as DimColor);
        editor.dimRadio.set(editor.dimColor());
        editor.gridMode.set(this.storage.get('gridMode', 'when-rotating', true) as GridMode);
        editor.gridRadio.set(editor.gridMode());
        editor.gridDensityLabel.set(this.storage.get('gridDensityLabel', 'Hustá', true) as GridDensityLabel);
        editor.gridDensityRadio.set(editor.gridDensityLabel());
        editor.gridColorLabel.set(this.storage.get('gridColorLabel', 'Modrá', true) as GridColorLabel);
        editor.gridColorRadio.set(editor.gridColorLabel());
        editor.gridLineWidthLabel.set(this.storage.get('gridLineWidthLabel', 'Tenká', true) as GridLineWidthLabel);
        editor.gridLineWidthRadio.set(editor.gridLineWidthLabel());
        editor.outlineWidthLabel.set(this.storage.get('outlineWidthLabel', 'Silný', true) as OutlineWidthLabel);
        editor.outlineRadio.set(editor.outlineWidthLabel());
        editor.outlineDashed = !!this.storage.get('outlineDashed', false, true);
        const storedDefaultFitMode = this.storage.get<DefaultFitMode>('defaultFitMode', 'page', true) ?? 'page';
        const defaultFitMode = ['page', 'selection'].includes(storedDefaultFitMode)
          ? storedDefaultFitMode
          : 'page';
        editor.defaultFitMode.set(defaultFitMode);
        editor.defaultFitModeRadio.set(defaultFitMode);
        editor.rememberLastSelectedImageOfLastOpenTitle = !!this.storage.get('rememberLastSelectedImageOfLastOpenTitle', null, true);
        editor.lastSelectedImageId = this.storage.get('lastSelectedImageId', '', true) ?? '';
        editor.selectedFilter = this.storage.get('filterScanTypeStart', 'all', true) as ScanType;
        editor.scanTypeRadio.set(editor.selectedFilter);
        editor.selectedPageNumberFilter.set(this.storage.get('filterPageNumberStart', 'all', true) as PageNumberType);
        editor.pageNumberRadio.set(editor.selectedPageNumberFilter() ?? 'all');
        
        // Set displayed images and main image
        editor.setDisplayedImages();
        const imageList = editor.displayedImagesFinal();
        if (!imageList.length) editor.loadingMain.set(false);
        const shouldUseLastSelectedImage = res._id === this.storage.get('lastTitleId', '', true) && editor.rememberLastSelectedImageOfLastOpenTitle;
        const newImage = shouldUseLastSelectedImage
          ? (imageList.find(img => img._id === editor.lastSelectedImageId) ?? imageList[0])
          : (imageList.find(img => img._id === editor.mainImageItem()._id) || imageList[0] || { url: '' });
        editor.setMainImage(newImage);
        if (shouldUseLastSelectedImage) {
          const el = await waitForElement(`#thumbnail-wrapper-${editor.lastSelectedImageId}`);
          scrollToElement(el);
        }

        // Store titleId
        this.storage.set('lastTitleId', res._id);
        if (!shouldUseLastSelectedImage) this.storage.remove('lastSelectedImageId');
        if (this.auth.canReadGroup()) this.storage.set('backFromTitleId', res._id);
      });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.mainWrapper()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.paramsOnBookId.unsubscribe();
  }
}
