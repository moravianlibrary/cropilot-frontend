import { Component, effect, inject, input, output } from '@angular/core';
import { DimColor, GridMode, PageNumberType, ScanType } from '../../app.types';
import { EditorService } from '../../services/editor.service';
import { dimColorDict, filterPageNumberStartDict, filterScanTypeStartDict, gridModeDict } from '../../app.config';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../../services/dashboard.service';
import { AuthService } from '../../services/auth.service';
import { SelectComponent } from '../select/select.component';
import { UploadComponent } from '../upload/upload.component';
import { UiService } from '../../services/ui.service';
import { focusElement, waitForElement } from '../../utils/utils';

@Component({
  selector: 'app-dialog',
  imports: [FormsModule, SelectComponent, UploadComponent],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss'
})
export class DialogComponent {
  dashSvc = inject(DashboardService);
  edtSvc = inject(EditorService);
  authSvc = inject(AuthService);
  uiSvc = inject(UiService);
  
  open = input<boolean>(false);
  closed = output<void>();
  backdropClick = output<void>();

  autoFocus = effect(async () => {
    const open = this.open();
    if (open && this.uiSvc.dialogContent() && !['shortcuts', 'settings', 'new-password', 'edit-password'].includes(this.uiSvc.dialogContentType() ?? '')) {
      const el = await waitForElement('input:first-of-type', document.querySelector('app-dialog') as HTMLElement); 
      focusElement(el, 100);
    }
  });

  gridModeDict: Record<GridMode, string> = gridModeDict;
  gridModeDictKeys = Object.keys(gridModeDict) as GridMode[];
  
  dimColorDict: Record<DimColor, string> = dimColorDict;
  dimColorDictKeys = Object.keys(dimColorDict) as DimColor[];

  filterScanTypeStartDict: Record<ScanType, string> = filterScanTypeStartDict;
  filterScanTypeStartDictKeys = Object.keys(filterScanTypeStartDict) as ScanType[];

  filterPageNumberStartDict: Record<PageNumberType, string> = filterPageNumberStartDict;
  filterPageNumberStartDictKeys = Object.keys(filterPageNumberStartDict) as PageNumberType[];

  copied: boolean = false;
  private copiedTimer!: number;

  copy(): void {
    navigator.clipboard.writeText(this.dashSvc.newPassword());

    this.copied = true;
    window.clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => this.copied = false, 1200);
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(): void {
    this.backdropClick.emit();
    this.close();

    const edtSvc = this.edtSvc;
    if (this.uiSvc.dialogTitle() === 'Nastavení') this.edtSvc.gridRadio.set(edtSvc.gridMode());
  }
}
