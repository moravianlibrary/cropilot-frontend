import { Component, inject } from '@angular/core';
import { TopPanelComponent } from '../../layout-dashboard/top-panel/top-panel.component';
import { MainComponent } from '../../layout-dashboard/main/main.component';
import { DrawerComponent } from '../../components/drawer/drawer.component';
import { DashboardService } from '../../services/dashboard.service';
import { AuthService } from '../../services/auth.service';
import { EditorService } from '../../services/editor.service';
import { DialogComponent } from '../../components/dialog/dialog.component';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-dashboard',
  imports: [TopPanelComponent, MainComponent, DrawerComponent, DialogComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  dashboard = inject(DashboardService);
  auth = inject(AuthService);
  ui = inject(UiService);
  editor = inject(EditorService);
}
