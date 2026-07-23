import { Component, inject } from '@angular/core';
import { DashboardService } from '../../services/dashboard.service';
import { getDate } from '../../utils/utils';
import { permissionDict, titleStateDict } from '../../app.config';
import { AuthService } from '../../services/auth.service';
import { FormsModule } from '@angular/forms';
import { UiService } from '../../services/ui.service';
import { SelectComponent } from '../select/select.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-drawer',
  imports: [FormsModule, SelectComponent, IconComponent],
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.scss',
  host: { '[class.open]': 'ui.drawerOpen()' },
})
export class DrawerComponent {
  dashboard = inject(DashboardService);
  auth = inject(AuthService);
  ui = inject(UiService);

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
    const dashboard = this.dashboard;
    switch (dashboard.dashboardPage()) {
      case 'groups':
        dashboard.editGroupDialog();
        break;
      case 'users':
        dashboard.editUserDialog();
        break;
    }
  }

  drawerDeleteAction(): void {
    const dashboard = this.dashboard;
    switch (dashboard.dashboardPage()) {
      case 'groups':
        dashboard.deleteGroupDialog();
        break;
      case 'users':
        dashboard.deleteUserDialog();
        break;
    }
  }
}
