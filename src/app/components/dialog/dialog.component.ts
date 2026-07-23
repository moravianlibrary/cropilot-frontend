import { Component, effect, inject, input, output, signal } from '@angular/core';
import { DefaultFitMode, DimColor, GridColorLabel, GridDensityLabel, GridLineWidthLabel, GridMode, OutlineWidthLabel, PageNumberType, ScanType } from '../../app.types';
import { EditorService } from '../../services/editor.service';
import { defaultFitModeDict, dimColorDict, filterPageNumberStartDict, filterScanTypeStartDict, gridColorDict, gridDensityDict, gridLineWidthDict, gridModeDict, outlineWidthDict } from '../../app.config';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../../services/dashboard.service';
import { AuthService } from '../../services/auth.service';
import { SelectComponent } from '../select/select.component';
import { UploadComponent } from '../upload/upload.component';
import { UiService } from '../../services/ui.service';
import { focusElement, waitForElement } from '../../utils/utils';
import { IconComponent } from '../icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentedControlOption,
  SegmentedControlValue
} from '../segmented-control/segmented-control.component';

@Component({
  selector: 'app-dialog',
  imports: [FormsModule, SelectComponent, UploadComponent, IconComponent, SegmentedControlComponent],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss'
})
export class DialogComponent {
  dashboard = inject(DashboardService);
  editor = inject(EditorService);
  auth = inject(AuthService);
  ui = inject(UiService);
  
  open = input<boolean>(false);
  closed = output<void>();
  backdropClick = output<void>();

  focusTimer!: ReturnType<typeof setTimeout>;

  autoFocus = effect(() => {
    const open = this.open();
    const dialogContent = this.ui.dialogContent();
    const dialogContentType = this.ui.dialogContentType();
    if (open && dialogContent && !['shortcuts', 'settings'].includes(dialogContentType ?? '')) {
      if (this.focusTimer) clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(async () => {
        const el = await waitForElement('input:first-of-type', document.querySelector('app-dialog') as HTMLElement);
        focusElement(el);
      }, 100);
    }
  });

  gridModeDict: Record<GridMode, string> = gridModeDict;
  gridModeDictKeys = Object.keys(gridModeDict) as GridMode[];

  gridDensityDict: Record<GridDensityLabel, number> = gridDensityDict;
  gridDensityDictKeys = Object.keys(gridDensityDict) as GridDensityLabel[];

  gridColorDict: Record<GridColorLabel, string> = gridColorDict;
  gridColorDictKeys = Object.keys(gridColorDict) as GridColorLabel[];

  gridLineWidthDict: Record<GridLineWidthLabel, number> = gridLineWidthDict;
  gridLineWidthDictKeys = Object.keys(gridLineWidthDict) as GridLineWidthLabel[];

  outlineWidthDict: Record<OutlineWidthLabel, number> = outlineWidthDict;
  outlineWidthDictKeys = Object.keys(outlineWidthDict) as OutlineWidthLabel[];
  
  dimColorDict: Record<DimColor, string> = dimColorDict;
  dimColorDictKeys = Object.keys(dimColorDict) as DimColor[];

  filterScanTypeStartDict: Record<ScanType, string> = filterScanTypeStartDict;
  filterScanTypeStartDictKeys = Object.keys(filterScanTypeStartDict) as ScanType[];

  filterPageNumberStartDict: Record<PageNumberType, string> = filterPageNumberStartDict;
  filterPageNumberStartDictKeys = Object.keys(filterPageNumberStartDict) as PageNumberType[];

  defaultFitModeDict: Record<DefaultFitMode, string> = defaultFitModeDict;
  defaultFitModeDictKeys = Object.keys(defaultFitModeDict) as DefaultFitMode[];

  settingsTab = signal<'editor' | 'behavior'>('editor');

  gridModeOptions: SegmentedControlOption[] = this.gridModeDictKeys.map(value => ({
    value,
    label: this.gridModeDict[value]
  }));

  gridDensityOptions: SegmentedControlOption[] = this.gridDensityDictKeys.map(value => ({
    value,
    label: value
  }));

  gridColorOptions: SegmentedControlOption[] = this.gridColorDictKeys.map(value => ({
    value,
    label: value,
    color: this.gridColorDict[value]
  }));

  gridLineWidthOptions: SegmentedControlOption[] = this.gridLineWidthDictKeys.map(value => ({
    value,
    label: value,
    lineWidth: this.gridLineWidthDict[value]
  }));

  outlineWidthOptions: SegmentedControlOption[] = [...this.outlineWidthDictKeys]
    .sort((a, b) => this.outlineWidthDict[a] - this.outlineWidthDict[b])
    .map(value => ({
      value,
      label: value,
      lineWidth: this.outlineWidthDict[value]
    }));

  dimColorOptions: SegmentedControlOption[] = this.dimColorDictKeys.map(value => ({
    value,
    label: value,
    color: value === 'Žádná' ? undefined : `rgba(${this.dimColorDict[value]})`
  }));

  scanTypeOptions: SegmentedControlOption[] = this.filterScanTypeStartDictKeys.map(value => ({
    value,
    label: this.filterScanTypeStartDict[value]
  }));

  pageNumberOptions: SegmentedControlOption[] = this.filterPageNumberStartDictKeys.map(value => ({
    value,
    label: this.filterPageNumberStartDict[value]
  }));

  defaultFitModeOptions: SegmentedControlOption[] = this.defaultFitModeDictKeys.map(value => ({
    value,
    label: this.defaultFitModeDict[value],
    icon: value === 'page' ? 'fit-to-screen' : 'fit-to-crops'
  }));

  copied: boolean = false;
  private copiedTimer!: number;

  selectSettingsTab(tab: 'editor' | 'behavior'): void {
    this.settingsTab.set(tab);
  }

  setGridMode(value: SegmentedControlValue): void {
    this.editor.gridRadio.set(value as GridMode);
  }

  setGridDensity(value: SegmentedControlValue): void {
    this.editor.gridDensityRadio.set(value as GridDensityLabel);
  }

  setGridColor(value: SegmentedControlValue): void {
    this.editor.gridColorRadio.set(value as GridColorLabel);
  }

  setGridLineWidth(value: SegmentedControlValue): void {
    this.editor.gridLineWidthRadio.set(value as GridLineWidthLabel);
  }

  setOutlineWidth(value: SegmentedControlValue): void {
    this.editor.outlineRadio.set(value as OutlineWidthLabel);
  }

  setDimColor(value: SegmentedControlValue): void {
    this.editor.dimRadio.set(value as DimColor);
  }

  setScanType(value: SegmentedControlValue): void {
    this.editor.scanTypeRadio.set(value as ScanType);
  }

  setPageNumber(value: SegmentedControlValue): void {
    this.editor.pageNumberRadio.set(value as PageNumberType);
  }

  setDefaultFitMode(value: SegmentedControlValue): void {
    this.editor.defaultFitModeRadio.set(value as DefaultFitMode);
  }

  copy(): void {
    navigator.clipboard.writeText(this.dashboard.newPassword());

    this.copied = true;
    window.clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => this.copied = false, 1200);
  }

  close(): void {
    if (this.ui.dialogTitle() === 'Nastavení') this.editor.resetSettingsDraft();
    this.closed.emit();
  }

  onBackdropClick(): void {
    this.backdropClick.emit();
    this.close();

    if (['Úprava titulu', 'Smazat titul'].includes(this.ui.dialogTitle())) this.dashboard.selectedTitle.set(null);
  }
}
