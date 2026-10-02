import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { Component, ElementRef, inject, input, viewChild } from '@angular/core';
import { NgClass } from '../../../../node_modules/@angular/common';
import { EditorService } from '../../services/editor.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../icon/icon.component';
import { TPipe } from '../../i18n/t.pipe';

@Component({
  selector: 'app-menu',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgClass, IconComponent, TPipe],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss'
})
export class MenuComponent {
  editor = inject(EditorService);
  auth = inject(AuthService);
  type = input('menu-primary');


  // ========== TOGGLE BEHAVIOR ==========
  menu = viewChild<ElementRef<HTMLElement>>('menu');
  show = false;

  toggleMenu(): void {
    this.show = !this.show;
  }

  onSettingsClick(): void {
    this.editor.openSettingsDialog();
    this.show = false;
  }

  onShortcutsClick(): void {
    this.editor.openShortcutsDialog();
    this.show = false;
  }

  onResetDocClick(): void {
    this.editor.openResetDocDialog();
    this.show = false;
  }

  onResetScanClick(): void {
    this.editor.openResetScanDialog();
    this.show = false;
  }
}
