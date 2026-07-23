import { Component, inject } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { IconComponent } from '../../components/icon/icon.component';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-bottom-panel-editor',
  imports: [IconComponent],
  templateUrl: './bottom-panel.component.html',
  styleUrl: './bottom-panel.component.scss'
})
export class BottomPanelComponent {
  editor = inject(EditorService);
  auth = inject(AuthService);

  get wasAnyPageEdited(): boolean {
    return Boolean(this.editor.currentPages.find(p => p.edited));
  }
}
