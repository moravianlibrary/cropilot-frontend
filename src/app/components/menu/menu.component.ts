import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { Component, ElementRef, inject, input, viewChild } from '@angular/core';
import { NgClass } from '../../../../node_modules/@angular/common';
import { EditorService } from '../../services/editor.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-menu',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgClass],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss'
})
export class MenuComponent {
  edtSvc = inject(EditorService);
  authSvc = inject(AuthService);
  type = input('menu-primary');


  /* ------------------------------
    TOGGLE BEHAVIOR
  ------------------------------ */
  menu = viewChild<ElementRef<HTMLElement>>('menu');
  show = false;

  toggleMenu(): void {
    this.show = !this.show;
  }

  onSettingsClick(): void {
    this.edtSvc.openSettingsDialog();
    this.show = false;
  }

  onShortcutsClick(): void {
    this.edtSvc.openShortcutsDialog();
    this.show = false;
  }

  onResetDocClick(): void {
    this.edtSvc.openResetDocDialog();
    this.show = !this.authSvc.canWriteTitle();
  }

  onResetScanClick(): void {
    this.edtSvc.openResetScanDialog();
    this.show = !this.authSvc.canWriteTitle();
  }
}
