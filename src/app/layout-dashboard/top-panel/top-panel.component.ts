import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { userRolesDict } from '../../app.config';
import { DashboardService } from '../../services/dashboard.service';
import { Router } from '@angular/router';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../../components/icon/icon.component';
import { TPipe } from '../../i18n/t.pipe';
import { LangSwitchComponent } from '../../components/lang-switch/lang-switch.component';
import { SegmentedControlComponent, SegmentedControlOption } from '../../components/segmented-control/segmented-control.component';
import { lang, Lang, setLang } from '../../i18n/i18n';

@Component({
  selector: 'app-top-panel-dashboard',
  imports: [IconComponent, TPipe, LangSwitchComponent, SegmentedControlComponent, CdkConnectedOverlay, CdkOverlayOrigin],
  templateUrl: './top-panel.component.html',
  styleUrl: './top-panel.component.scss'
})
export class TopPanelComponent {
  auth = inject(AuthService);
  ui = inject(UiService);
  dashboard = inject(DashboardService);
  router = inject(Router);

  userRolesDict = userRolesDict;

  // ========== USER MENU ==========
  // Click on the user chip opens a menu with the user info, language choice and logout.
  userMenuOpen = false;
  userMenuOrigin = viewChild('userMenuOrigin', { read: ElementRef });

  // Right-aligned under the chip
  userMenuPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 }
  ];

  // Language names stay in their own language (not translated).
  langOptions: SegmentedControlOption[] = [
    { value: 'cs', label: 'Čeština' },
    { value: 'en', label: 'English' }
  ];
  lang = lang;

  setLang(value: Lang): void {
    setLang(value);
  }

  // A click on the chip itself toggles the menu; don't let the outside-click close it first.
  closeUserMenu(event: MouseEvent): void {
    const origin = this.userMenuOrigin()?.nativeElement as HTMLElement | undefined;
    if (origin?.contains(event.target as Node)) return;
    this.userMenuOpen = false;
  }

  logout(): void {
    this.userMenuOpen = false;
    this.auth.logout();
  }
}
