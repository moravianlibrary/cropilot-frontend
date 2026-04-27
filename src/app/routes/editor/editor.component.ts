import { Component, ElementRef, HostListener, inject, viewChild } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { MainComponent } from '../../layout-editor/main/main.component';
import { BottomPanelComponent } from '../../layout-editor/bottom-panel/bottom-panel.component';
import { LeftPanelComponent } from '../../layout-editor/left-panel/left-panel.component';
import { RightPanelComponent } from '../../layout-editor/right-panel/right-panel.component';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, map, Observable, of, Subscription, switchMap, tap, throwError } from 'rxjs';
import { DimColor, GridMode, ImageItem, OutlineWidthLabel, PageNumberType, ScanType, TitleDetail } from '../../app.types';
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
  edtSvc = inject(EditorService);
  authSvc = inject(AuthService);
  uiSvc = inject(UiService);
  private storage = inject(LocalStorageService);
  private router = inject(Router);
  private title = inject(Title);
  private activatedRoute = inject(ActivatedRoute);
  private paramsOnBookId = new Subscription();

  mainWrapper = viewChild<ElementRef<HTMLDivElement>>('mainWrapper');

  // Changes not saved alert
  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent) {
    if (this.edtSvc.sthWasEdited) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  ngOnInit() {
    const edtSvc = this.edtSvc;
    
    // Subscribe to params
    this.paramsOnBookId = this.activatedRoute.paramMap
      .pipe(
        map(params => params.get('book_id') || ''),
        tap(book_id => {
          if (!book_id) {
            this.router.navigate(['/not-found']);
            return;
          };

          edtSvc.book.set(book_id);
          edtSvc.loadingLeft = true;
          edtSvc.loadingMain.set(true);
        }),
        switchMap(() => {
          edtSvc.showPredictions = !!this.storage.get('showPredictions', null, true);
          const book = edtSvc.book();
          
          const requests: [Observable<TitleDetail | null>, Observable<TitleDetail>] = [
            edtSvc.showPredictions
              ? edtSvc.fetchPredictedScans(book)
              : of(null),
            edtSvc.fetchScans(book)];

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
        const imgItemsPredicted: ImageItem[] | undefined = resPredicted?.scans;
        const imgItems: ImageItem[] = res.scans;
        edtSvc.loadingLeft = false;
        edtSvc.images.set(imgItems);
        edtSvc.originalImages.set(imgItems);
        edtSvc.predictedImages.set(imgItemsPredicted ?? []);

        // Set settings stuff
        edtSvc.dimColor.set(this.storage.get('dimColor', 'Černá', true) as DimColor);
        edtSvc.dimRadio.set(edtSvc.dimColor());
        edtSvc.gridMode.set(this.storage.get('gridMode', 'when-rotating', true) as GridMode);
        edtSvc.gridRadio.set(edtSvc.gridMode());
        edtSvc.outlineWidthLabel.set(this.storage.get('outlineWidthLabel', 'Silný', true) as OutlineWidthLabel);
        edtSvc.outlineRadio.set(edtSvc.outlineWidthLabel());
        edtSvc.outlineDashed = !!this.storage.get('outlineDashed', false, true);
        edtSvc.rememberLastSelectedImageOfLastOpenTitle = !!this.storage.get('rememberLastSelectedImageOfLastOpenTitle', null, true);
        edtSvc.lastSelectedImageId = this.storage.get('lastSelectedImageId', '', true) ?? '';
        edtSvc.selectedFilter = this.storage.get('filterScanTypeStart', 'all', true) as ScanType;
        edtSvc.scanTypeRadio.set(edtSvc.selectedFilter);
        edtSvc.selectedPageNumberFilter.set(this.storage.get('filterPageNumberStart', 'all', true) as PageNumberType);
        edtSvc.pageNumberRadio.set(edtSvc.selectedPageNumberFilter() ?? 'all');
        
        // Set displayed images and main image
        edtSvc.setDisplayedImages();
        const imageList = edtSvc.displayedImagesFinal();
        if (!imageList.length) edtSvc.loadingMain.set(false);
        const shouldUseLastSelectedImage = res._id === this.storage.get('lastTitleId', '', true) && edtSvc.rememberLastSelectedImageOfLastOpenTitle;
        const newImage = shouldUseLastSelectedImage
          ? (imageList.find(img => img._id === edtSvc.lastSelectedImageId) ?? imageList[0])
          : (imageList.find(img => img._id === edtSvc.mainImageItem()._id) || imageList[0] || { url: '' });
        edtSvc.setMainImage(newImage);
        if (shouldUseLastSelectedImage) {
          const el = await waitForElement(`#thumbnail-wrapper-${edtSvc.lastSelectedImageId}`);
          scrollToElement(el);
        }

        // Store titleId
        this.storage.set('lastTitleId', res._id);
        if (!shouldUseLastSelectedImage) this.storage.remove('lastSelectedImageId');
        if (this.authSvc.canReadGroup()) this.storage.set('backFromTitleId', res._id);
      });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.mainWrapper()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.paramsOnBookId.unsubscribe();
  }
}
