import { Component, inject } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { IconComponent } from '../../components/icon/icon.component';
import { AuthService } from '../../services/auth.service';
import { TelemetryService } from '../../services/telemetry.service';
import { TelemetryAction } from '../../stats.types';

@Component({
  selector: 'app-bottom-panel-editor',
  imports: [IconComponent],
  templateUrl: './bottom-panel.component.html',
  styleUrl: './bottom-panel.component.scss'
})
export class BottomPanelComponent {
  editor = inject(EditorService);
  auth = inject(AuthService);
  private telemetry = inject(TelemetryService);

  get wasAnyPageEdited(): boolean {
    return Boolean(this.editor.currentPages.find(p => p.edited));
  }

  // Button handlers delegate to the editor and record the mouse-driven action,
  // so keyboard-vs-mouse usage can be compared per action.
  prev(): void { this.run('nav_prev', () => this.editor.showPrevImage()); }
  next(): void { this.run('nav_next', () => this.editor.showNextImage()); }
  zoomIn(): void { this.run('zoom_in', () => this.editor.zoom('in')); }
  zoomOut(): void { this.run('zoom_out', () => this.editor.zoom('out')); }
  zoomReset(): void { this.run('zoom_reset', () => this.editor.resetZoom()); }
  fitPages(): void { this.run('zoom_fit_pages', () => this.editor.fitZoomToPages()); }

  private run(action: TelemetryAction, fn: () => void): void {
    fn();
    this.telemetry.track('mouse_action', { action });
  }
}
