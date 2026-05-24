import { Component, inject } from '@angular/core';
import { DashboardService } from '../../services/dashboard.service';
import { getDate } from '../../utils/utils';
import { permissionDict, titleStateDict } from '../../app.config';
import { AuthService } from '../../services/auth.service';
import { FormsModule } from '@angular/forms';
import { UiService } from '../../services/ui.service';
import { SelectComponent } from '../select/select.component';

@Component({
  selector: 'app-drawer',
  imports: [FormsModule, SelectComponent],
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.scss',
  host: { '[class.open]': 'uiSvc.drawerOpen()' },
})
export class DrawerComponent {
  dashSvc = inject(DashboardService);
  authSvc = inject(AuthService);
  uiSvc = inject(UiService);

  getDate = getDate;
  permissionDict = permissionDict;
  titleStateDict = titleStateDict;

  copied: Record<string, boolean> = {};
  private copiedTimers: Record<string, number> = {};

  copy(key: string, text: string): void {
    navigator.clipboard.writeText(text);

    this.copied[key] = true;
    window.clearTimeout(this.copiedTimers[key]);
    this.copiedTimers[key] = window.setTimeout(() => this.copied[key] = false, 1200);
  }

  drawerEditAction(): void {
    const dashSvc = this.dashSvc;
    switch (dashSvc.dashboardPage()) {
      case 'groups':
        dashSvc.editGroupDialog();
        break;
      case 'users':
        dashSvc.editUserDialog();
        break;
    }
  }

  drawerDeleteAction(): void {
    const dashSvc = this.dashSvc;
    switch (dashSvc.dashboardPage()) {
      case 'groups':
        dashSvc.deleteGroupDialog();
        break;
      // case 'titles':
      //   dashSvc.deleteTitleDialog();
      //   break;
      case 'users':
        dashSvc.deleteUserDialog();
        break;
    }
  }
}
