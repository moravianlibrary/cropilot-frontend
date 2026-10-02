import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { UiService } from '../../services/ui.service';
import { TPipe } from '../../i18n/t.pipe';

@Component({
  selector: 'app-toast-container',
  imports: [NgClass, TPipe],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastComponent {
  ui = inject(UiService);
}
