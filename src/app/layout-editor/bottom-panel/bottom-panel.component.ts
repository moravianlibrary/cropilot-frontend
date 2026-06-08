import { Component, inject } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-bottom-panel-editor',
  imports: [IconComponent],
  templateUrl: './bottom-panel.component.html',
  styleUrl: './bottom-panel.component.scss'
})
export class BottomPanelComponent {
  edtSvc = inject(EditorService);

  get wasAnyPageEdited(): boolean {
    return Boolean(this.edtSvc.currentPages.find(p => p.edited));
  }
}
