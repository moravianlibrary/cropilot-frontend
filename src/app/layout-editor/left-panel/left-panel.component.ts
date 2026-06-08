import { Component, effect, ElementRef, inject, viewChild, viewChildren } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { ImageItem } from '../../app.types';
import { LoaderComponent } from '../../components/loader/loader.component';
import { NgClass } from '../../../../node_modules/@angular/common';
import { MenuComponent } from "../../components/menu/menu.component";
import { flagMessages } from '../../app.config';
import { AuthService } from '../../services/auth.service';
import { DashboardService } from '../../services/dashboard.service';
import { OverlayScrollbars } from 'overlayscrollbars';
import { LocalStorageService } from '../../services/local-storage.service';
import { IconComponent } from "../../components/icon/icon.component";

@Component({
  selector: 'app-left-panel-editor',
  imports: [LoaderComponent, NgClass, MenuComponent, IconComponent],
  templateUrl: './left-panel.component.html',
  styleUrl: './left-panel.component.scss'
})
export class LeftPanelComponent {
  edtSvc = inject(EditorService);
  dashSvc = inject(DashboardService);
  authSvc = inject(AuthService);
  private storage = inject(LocalStorageService);

  thumbnailsScroll = viewChild<ElementRef<HTMLDivElement>>('thumbnailsScroll');
  private osInstance?: ReturnType<typeof OverlayScrollbars>;


  /* ------------------------------
    LAZY IMAGES LOADING
  ------------------------------ */
  images = viewChildren<ElementRef<HTMLImageElement>>('lazyImg');

  private observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const img = entry.target as HTMLImageElement;
      const id = img.dataset['id']!;
      const targetImg = this.edtSvc.images().find(img => img._id === id);

      if (targetImg?.thumbnailUrl) {
        img.src = targetImg.thumbnailUrl;
        this.observer.unobserve(img);
        return;
      }

      this.edtSvc.fetchThumbnail(id).subscribe(thumbnail => {
        const thumbnailUrl = URL.createObjectURL(thumbnail);

        img.src = thumbnailUrl;

        this.edtSvc.images.update(prev =>
          prev.map(img =>
            img._id === id
              ? {
                  ...img,
                  thumbnailUrl: thumbnailUrl
                }
              : img
          )
        );

        this.observer.unobserve(img);
      });
    });
  });

  imagesChange = effect(() => {
    this.observeNewImages();

    const thumbnailsScroll = this.thumbnailsScroll()?.nativeElement as HTMLDivElement;
    if (!thumbnailsScroll) return;
    this.osInstance = OverlayScrollbars(thumbnailsScroll, {
      overflow: { x: 'hidden', y: 'scroll' },
      scrollbars: {
        theme: 'os-theme-orezy',
        autoHide: 'leave',
        autoHideDelay: 250,
        dragScroll: true,
        clickScroll: true,
      },
    });
    thumbnailsScroll.classList.remove('os-pending');
  });

  ngOnDestroy(): void {
    this.observer.disconnect();
  }

  private observeNewImages(): void {
    this.images().forEach(img => this.observer.observe(img.nativeElement));
  }


  /* ------------------------------
    CLICKS
  ------------------------------ */
  backToMyGroupsTitles(groupId: string): void {
    this.dashSvc.dashboardPage.set('titles');
    window.location.href = `${this.authSvc.baseUri}/group/${groupId}`;
  }

  backToHomepage(): void {
    this.dashSvc.dashboardPage.set('groups');
  }

  clickThumbnail(image: ImageItem): void {
    const edtSvc = this.edtSvc;
    if (image._id === edtSvc.mainImageItem()._id) return;
    
    edtSvc.updateImagesByCurrentPages();
    edtSvc.setMainImage(image);

    if (edtSvc.rememberLastSelectedImageOfLastOpenTitle) {
      edtSvc.lastSelectedImageId = image._id;
      this.storage.set('lastSelectedImageId', `${image._id}`);
      return;
    }
    
    this.storage.remove('lastSelectedImageId');
  }

  getStatus(image: ImageItem): 'edited' | 'error' | 'warning' | 'success' {
    if (image.edited) return 'edited';

    const errorFlags = [
      'page_count_mismatch',
      'no_prediction',
      'prediction_overlap',
    ];
    if (image.flags.some(f => errorFlags.includes(f))) {
      return 'error';
    }

    const warningFlags = [
      'low_confidence',
      'odd_dimensions',
    ];
    if (image.flags.some(f => warningFlags.includes(f))) {
      return 'warning';
    }

    return 'success';
  }

  getStatusIconTooltip(image: ImageItem): string {
    if (image.edited) {
      return 'Upraveno';
    }

    const flags = image.flags;

    let matchedMessages = Object.entries(flagMessages)
      .filter(([flag]) => flags.includes(flag))
      .map(([, message]) => message);

    if (matchedMessages.length === 0) {
      return 'OK';
    }

    if (matchedMessages.length > 1 && flags.includes('low_confidence')) {
      matchedMessages = matchedMessages.filter(msg => msg !== flagMessages['low_confidence']);
    }

    if (matchedMessages.length === 1) {
      return matchedMessages[0];
    }

    const messages = [...matchedMessages];

    if (messages.length === 2) {
      return messages.join(' a ');
    }

    const last = messages[messages.length - 1];
    const secondLast = messages[messages.length - 2];

    return `${messages.join(', ')}, ${secondLast} a ${last}`;
  }
}
