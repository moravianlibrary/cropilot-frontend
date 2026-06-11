import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from '../../services/dashboard.service';
import { UiService } from '../../services/ui.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.scss']
})
export class UploadComponent {
  dashboard = inject(DashboardService);
  ui = inject(UiService);
  
  h3 = input<string>('Přetáhněte sem');
  formatsAndSizeText = input<string>('');
  btnLabel = input<string>('Vybrat soubory');
  
  filesSelected = output<FileList>();
  maxNamedFiles: number = 3;

  isDragging = false;

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const maxSize = 4 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png'];
    const validFiles: File[] = [];
    const oversizedFiles: string[] = [];
    const unallowedTypesFiles: string[] = [];

    Array.from(input.files).forEach(file => {
      !allowedTypes.includes(file.type)
        ? unallowedTypesFiles.push(file.name)
        : (file.size > maxSize
          ? oversizedFiles.push(file.name)
          : validFiles.push(file));
    });

    if (unallowedTypesFiles.length) {
      this.ui.showToast(
        `Tyto skeny nejsou ve formátu JPEG nebo PNG:
         • ${unallowedTypesFiles.slice(0,this.maxNamedFiles).join('\n• ')}
         ${unallowedTypesFiles.length > this.maxNamedFiles ? `...a ${unallowedTypesFiles.length - this.maxNamedFiles} další${[1, 2, 3, 4].includes(unallowedTypesFiles.length - this.maxNamedFiles) ? '' : 'ch'}` : ''}`,
        { type: 'error' }
      );
    }

    if (oversizedFiles.length) {
      this.ui.showToast(
        `Tyto skeny jsou větší než 4 MB:
         • ${oversizedFiles.slice(0,this.maxNamedFiles).join('\n• ')}
         ${oversizedFiles.length > this.maxNamedFiles ? `...a ${oversizedFiles.length - this.maxNamedFiles} další${[1, 2, 3, 4].includes(oversizedFiles.length - this.maxNamedFiles) ? '' : 'ch'}` : ''}`,
        { type: 'error' }
      );
    }

    if (validFiles.length) {
      const dataTransfer = new DataTransfer();
      validFiles.forEach(file => dataTransfer.items.add(file));
      this.filesSelected.emit(dataTransfer.files);
    }

    input.value = '';
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging = false;

    if (event.dataTransfer?.files?.length) {
      this.filesSelected.emit(event.dataTransfer.files);
    }
  }
}
