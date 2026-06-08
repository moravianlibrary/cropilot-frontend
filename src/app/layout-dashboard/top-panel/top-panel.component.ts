import { Component, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { userRolesDict } from '../../app.config';
import { DashboardService } from '../../services/dashboard.service';
import { Router } from '@angular/router';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-top-panel-dashboard',
  imports: [IconComponent],
  templateUrl: './top-panel.component.html',
  styleUrl: './top-panel.component.scss'
})
export class TopPanelComponent {
  authSvc = inject(AuthService);
  uiSvc = inject(UiService);
  dashSvc = inject(DashboardService);
  router = inject(Router);

  userRolesDict = userRolesDict;
}
