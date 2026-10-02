import { Component, inject } from '@angular/core';
import { AuthService } from '../../../services/auth.service';

import { TPipe } from '../../../i18n/t.pipe';

@Component({
  selector: 'app-forbidden',
  imports: [TPipe],
  templateUrl: './forbidden.component.html',
  styleUrl: './forbidden.component.scss'
})
export class ForbiddenComponent {
  private auth = inject(AuthService);
  
  goToLogin(): void {
    this.auth.redirectToLogin();
  }
}
