import { HttpClient, HttpEventType } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { UiService } from './ui.service';
import { t } from '../i18n/i18n';
import { downloadBlob, safeFileName } from '../utils/crop-export';

// Size of an empty ZIP (end-of-central-directory record only).
const EMPTY_ZIP_SIZE = 22;

// Whole-title crop download: the backend cuts every saved crop from the stored
// scans and streams them as one ZIP (GET /{title_id}/crop-previews, title
// managers only). Used by the editor's ☰ menu and the title detail drawer.
@Injectable({
  providedIn: 'root'
})
export class CropDownloadService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private ui = inject(UiService);

  // Title being downloaded and the bytes received so far (the size is not
  // known up front, the archive is streamed).
  titleDownload = signal<{ titleId: string; loaded: number } | null>(null);

  async downloadTitle(titleId: string, titleName: string): Promise<void> {
    if (this.titleDownload()) return;

    this.titleDownload.set({ titleId, loaded: 0 });
    const toastId = this.ui.showToast(t('Připravuji ořezy titulu…'), { type: 'info', duration: 10 * 60 * 1000 });

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        this.http.get(`${this.auth.apiUrl}/${titleId}/crop-previews`, {
          headers: this.auth.authHeaders('*/*'),
          responseType: 'blob',
          observe: 'events',
          reportProgress: true
        }).subscribe({
          next: event => {
            if (event.type === HttpEventType.DownloadProgress) this.titleDownload.set({ titleId, loaded: event.loaded });
            if (event.type === HttpEventType.Response) resolve(event.body ?? new Blob());
          },
          error: reject
        });
      });

      if (blob.size <= EMPTY_ZIP_SIZE) {
        this.ui.showToast(t('Titul nemá žádné ořezy ke stažení.'), { type: 'info' });
        return;
      }

      downloadBlob(blob, `${safeFileName(titleName || titleId)}_nahled.zip`);
      this.ui.showToast(t('Ořezy titulu byly staženy jako JPEG náhled.'), { type: 'success' });
    } catch (err) {
      this.ui.showToast(t('Ořezy titulu se nepodařilo stáhnout. Zkuste to znovu.'), { type: 'error' });
      console.error(err);
    } finally {
      this.ui.dismissToast(toastId);
      this.titleDownload.set(null);
    }
  }
}
