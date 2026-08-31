import { Component, computed, effect, inject, signal } from '@angular/core';
import { DashboardService } from '../../services/dashboard.service';
import { getDate, getRelativeDate } from '../../utils/utils';
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
  getRelativeDate = getRelativeDate;
  permissionDict = permissionDict;
  titleStateDict = titleStateDict;

  // Group detail API key masking.
  showApiKey = signal<boolean>(false);

  constructor() {
    // Re-mask the API key whenever a different group detail is opened
    // or the drawer closes (reopening the same group must not reveal it).
    effect(() => {
      this.dashboard.selectedGroupDetail();
      this.ui.drawerOpen();
      this.showApiKey.set(false);
    });
  }

  toggleApiKey(): void {
    this.showApiKey.update(v => !v);
  }

  // Count of unsaved changes shown in the drawer footer.
  dirtyCount = computed<number>(() => {
    const page = this.ui.drawerContentType();

    if (page === 'titles') {
      return this.dashboard.titleDirtyCount();
    }

    if (page === 'groups') {
      return (this.dashboard.groupNonmembersDataChanged() ? 1 : 0)
        + this.dashboard.membersAdded().length
        + this.dashboard.membersUpdated().length
        + this.dashboard.membersRemoved().length;
    }

    if (page === 'users') {
      let count = this.dashboard.userNonmembersDataChanged() ? 1 : 0;
      const user = this.dashboard.selectedUser();
      if (user) {
        const before = new Map(user.permissions.map(p => [p.group_id, [...p.permission].sort().join(',')]));
        const after = this.dashboard.userPermissions();
        const afterIds = new Set(after.map(p => p.group_id));
        for (const id of before.keys()) if (!afterIds.has(id)) count++;
        for (const p of after) {
          const b = before.get(p.group_id);
          const now = [...p.permission].sort().join(',');
          if (b === undefined || b !== now) count++;
        }
      }
      return count;
    }

    return 0;
  });

  maskApiKey(key: string): string {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••••••••••${key.slice(-4)}`;
  }

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
    switch (this.ui.drawerContentType()) {
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
    switch (this.ui.drawerContentType()) {
      case 'groups':
        dashboard.deleteGroupDialog();
        break;
      case 'users':
        dashboard.deleteUserDialog();
        break;
      case 'titles': {
        const title = dashboard.selectedTitle();
        if (title) dashboard.deleteTitleDialog(title);
        break;
      }
    }
  }
}
