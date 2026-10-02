import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { TPipe } from '../../../i18n/t.pipe';

@Component({
  selector: 'app-not-found',
  imports: [TPipe],
  templateUrl: './not-found.component.html',
  styleUrl: './not-found.component.scss'
})
export class NotFoundComponent {
  private router = inject(Router);
  
  goHome(): void {
    this.router.navigate(['/']);
  }
}
