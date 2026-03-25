import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { MainComponent } from '../../layout-editor/main/main.component';
import { BottomPanelComponent } from '../../layout-editor/bottom-panel/bottom-panel.component';
import { LeftPanelComponent } from '../../layout-editor/left-panel/left-panel.component';
import { RightPanelComponent } from '../../layout-editor/right-panel/right-panel.component';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, Subscription, switchMap, tap, throwError } from 'rxjs';
import { GridMode, ImageItem, PageNumberType, ScanType, TitleDetail } from '../../app.types';
import { AuthService } from '../../services/auth.service';
import { DialogComponent } from '../../components/dialog/dialog.component';
import { UiService } from '../../services/ui.service';

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
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private paramsOnBookId = new Subscription();

  mainWrapper = viewChild<ElementRef<HTMLDivElement>>('mainWrapper');

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
        switchMap(() => edtSvc.fetchScans(edtSvc.book())),
        catchError(err => {
          err.status === 403
            ? this.router.navigate(['/forbidden'])
            : this.router.navigate(['/not-found']);
          console.error('Fetch error:', err);
          return throwError(() => err);
        })
      )
      .subscribe((title: TitleDetail) => {
        const imgItems: ImageItem[] = title.scans;
        edtSvc.loadingLeft = false;
        edtSvc.images.set(imgItems);
        edtSvc.originalImages.set(imgItems);

        edtSvc.gridMode.set(localStorage.getItem('gridMode') as GridMode ?? 'when-rotating');
        edtSvc.gridRadio.set(edtSvc.gridMode());
        edtSvc.outlineTransparent = localStorage.getItem('outlineTransparent') === 'true';
        edtSvc.selectedFilter = localStorage.getItem('filterScanTypeStart') as ScanType ?? 'all';
        edtSvc.scanTypeRadio.set(edtSvc.selectedFilter);
        edtSvc.selectedPageNumberFilter.set(localStorage.getItem('filterPageNumberStart') as PageNumberType ?? null);
        edtSvc.pageNumberRadio.set(edtSvc.selectedPageNumberFilter() ?? 'all');
        edtSvc.setDisplayedImages();
        
        const imageList = edtSvc.displayedImagesFinal();
        if (!imageList.length) edtSvc.loadingMain.set(false);
        const newImage = imageList.find(img => img._id === edtSvc.mainImageItem()._id) || imageList[0] || { url: '' };
        edtSvc.setMainImage(newImage);
      });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.mainWrapper()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.paramsOnBookId.unsubscribe();
  }
}
