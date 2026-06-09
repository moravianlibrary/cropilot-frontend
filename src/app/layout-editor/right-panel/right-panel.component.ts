import { Component, inject } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectorRef } from '@angular/core';
import { InputType, Page } from '../../app.types';
import { clamp, defer, degreeToRadian, focusMainWrapper } from '../../utils/utils';
import { MenuComponent } from '../../components/menu/menu.component';
import { flagMessages } from '../../app.config';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-right-panel-editor',
  imports: [MenuComponent, DecimalPipe, FormsModule, IconComponent],
  templateUrl: './right-panel.component.html',
  styleUrl: './right-panel.component.scss'
})
export class RightPanelComponent {
  edtSvc = inject(EditorService);
  authSvc = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  private firstFocus = { left: true, top: true, width: true, height: true, angle: true };
  private holdInterval: any;


  // ========== HEADER ==========
  get currentIndexImage(): number {
    const images = this.edtSvc.displayedImagesFinal();
    const current = this.edtSvc.mainImageItem();
    return images.findIndex(img => img._id === current._id) + 1;
  }

  getFlagLabel(flag: string): string {
    return flagMessages[flag];
  }


  // ========== INPUTS ==========
  changeInputValue(type: InputType, event: any): void {
    const edtSvc = this.edtSvc;
    const page = edtSvc.selectedPage;
    if (!page) return;

    edtSvc.lastLeftInput = page.left;
    edtSvc.lastTopInput = page.top;
    edtSvc.lastWidthInput = page.width;
    edtSvc.lastHeightInput = page.height;

    let raw = this.parseInputValue(type, event);
    let value = type === 'angle' ? raw : raw / 100;
    if (isNaN(value)) value = 0;

    value = parseFloat(value.toFixed(edtSvc.decimals + 2));

    const cw = edtSvc.c.width;
    const ch = edtSvc.c.height;
    const ratio = cw / ch;
    const inverseRatio = ch / cw;

    switch (type) {
      case 'left':
        const boundWidth = Math.abs(page.left - page.right);
        value = clamp(value, 0, 1 - boundWidth);
        const deltaX = -(edtSvc.lastLeftInput - value)
        page.xc = page.xc + deltaX;
        page.right = page.right + deltaX;
        page.left = value;
        edtSvc.lastLeftInput = value;
        break;
      case 'top':
        const boundHeight = Math.abs(page.top - page.bottom);
        value = clamp(value, 0, 1 - boundHeight);
        const deltaY = -(edtSvc.lastTopInput - value)
        page.yc = page.yc + deltaY;
        page.bottom = page.bottom + deltaY;
        page.top = value;
        edtSvc.lastTopInput = value;
        break;
      case 'width':
        const handleAligned = (isHorizontal: boolean, reverse: boolean) => {
          value = clamp(value, 0, isHorizontal
            ? reverse ? page.right : 1 - page.left
            : (reverse ? page.bottom : (1 - page.top)) * inverseRatio);
          const delta = (edtSvc.lastWidthInput - value) * (reverse ? 1 : -1);
          
          if (isHorizontal) {
            page.xc += delta / 2;
            reverse
              ? page.left = clamp(page.left + delta)
              : page.right = clamp(page.right + delta);
          } else {
            page.yc += (delta / 2) * ratio;
            reverse
              ? page.top = clamp(value * ratio >= page.bottom ? 0 : page.top + delta * ratio)
              : page.bottom = clamp(page.bottom + delta * ratio);
          }

          page.width = value;
          edtSvc.lastWidthInput = value;
        };

        const handleRotated = (angle: number) => {
          const getOrientation = (angle: number) => {
            if (angle > 0 && angle < 90)  return { signX: +1, signY: +1, ref: 'bottom-right', baseAngle: angle };
            if (angle > 90)               return { signX: -1, signY: +1, ref: 'bottom-left',  baseAngle: angle - 90 };
            if (angle < -90)              return { signX: -1, signY: -1, ref: 'top-left',     baseAngle: -angle - 90 };
            if (angle < 0 && angle > -90) return { signX: +1, signY: -1, ref: 'top-right',    baseAngle: -angle };
            return null;
          };

          const o = getOrientation(angle);
          if (!o) return;

          value = clamp(value);
          const rad = degreeToRadian(o.baseAngle);
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const toRight = o.signX > 0;
          const toBottom = o.signY > 0;
          const goniom = toRight ? cos : sin;
          const inverseGoniom = toRight ? sin : cos;

          const pageWidthOriginal = page.width;
          const pageLeftOriginal = page.left;
          const pageRightOriginal = page.right;
          const pageTopOriginal = page.top;
          const pageBottomOriginal = page.bottom;

          const dW = -(edtSvc.lastWidthInput - value);
          const limitSide = toRight ? 'right' : 'left';
          let newSide = page[limitSide] + dW * (toRight ? cos : -sin);
          page[limitSide] = newSide;
          let dX = (dW / 2) * goniom;
          
          page.width = value;
          let adjustedDeltaWidth = dW;
          let adjustedDeltaX = dX;

          if (toRight ? newSide > 1 : newSide < 0) {
            page.width = pageWidthOriginal + ((toRight ? 1 - pageRightOriginal : pageLeftOriginal) / goniom);
            page[limitSide] = toRight ? 1 : 0;
            adjustedDeltaWidth = page.width - edtSvc.lastWidthInput;
            adjustedDeltaX = (adjustedDeltaWidth / 2) * goniom;
          }

          let deltaY = (adjustedDeltaWidth / 2) * inverseGoniom;
          let adjustedDeltaY = deltaY;
          const secondLimitSide = toBottom ? 'bottom' : 'top';
          let secondNewSide = page[secondLimitSide] + adjustedDeltaWidth * inverseGoniom * ratio * o.signY;
          page[secondLimitSide] = secondNewSide;

          if (toBottom ? secondNewSide > 1 : secondNewSide < 0) {
            page.width = pageWidthOriginal + ((toBottom ? (1 - pageBottomOriginal) : pageTopOriginal) / inverseGoniom) * inverseRatio;
            page[secondLimitSide] = toBottom ? 1 : 0;
            adjustedDeltaWidth = page.width - edtSvc.lastWidthInput;
            adjustedDeltaX = (adjustedDeltaWidth / 2) * goniom;
            adjustedDeltaY = (adjustedDeltaWidth / 2) * inverseGoniom;
            toRight
              ? page.right = pageRightOriginal + adjustedDeltaWidth * cos
              : page.left = pageLeftOriginal - adjustedDeltaWidth * sin;
          }

          page.xc = page.xc + adjustedDeltaX * o.signX;
          page.yc = page.yc + adjustedDeltaY * o.signY * ratio;
          edtSvc.lastWidthInput = value;
        };

        // --- Dispatch by angle ---
        switch (page.angle) {
          case 0:
            handleAligned(true, false);
            break;
          case -180:
            handleAligned(true, true);
            break;
          case 90:
            handleAligned(false, false);
            break;
          case -90:
            handleAligned(false, true);
            break;
          default:
            handleRotated(page.angle);
            break;
        }

        break;
      case 'height':
        const handleAlignedHeight = (isHorizontal: boolean, reverse: boolean) => {
          value = clamp(value, 0, isHorizontal
            ? reverse ? page.bottom : 1 - page.top
            : (reverse ? page.right : (1 - page.left)) * ratio);
          const delta = (edtSvc.lastHeightInput - value) * (reverse ? 1 : -1);
          
          if (isHorizontal) {
            page.yc += delta / 2;
            reverse
              ? page.top = clamp(page.top + delta)
              : page.bottom = clamp(page.bottom + delta);
          } else {
            page.xc += (delta / 2) * inverseRatio;
            reverse
              ? page.left = clamp(value * inverseRatio >= page.right ? 0 : page.left + delta * inverseRatio)
              : page.right = clamp(page.right + delta * inverseRatio);
          }

          page.height = value;
          edtSvc.lastHeightInput = value;
        };

        const handleRotatedHeight = (angle: number) => {
          const getOrientation = (angle: number) => {
            if (angle > 0 && angle < 90)  return { signX: -1, signY: +1, ref: 'bottom-left', baseAngle: 90 - angle };
            if (angle > 90)               return { signX: -1, signY: -1, ref: 'top-left',  baseAngle: angle - 90 };
            if (angle < -90)              return { signX: +1, signY: -1, ref: 'top-right', baseAngle: 180 + angle };
            if (angle < 0 && angle > -90) return { signX: +1, signY: +1, ref: 'bottom-right',    baseAngle: -angle };
            return null;
          };

          const o = getOrientation(angle);
          if (!o) return; 

          value = clamp(value);
          const rad = degreeToRadian(o.baseAngle);
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const toRight = o.signX > 0;
          const toBottom = o.signY > 0;
          const goniom = toRight ? cos : sin;
          const inverseGoniom = toRight ? sin : cos;

          const pageHeightOriginal = page.height;
          const pageLeftOriginal = page.left;
          const pageRightOriginal = page.right;
          const pageTopOriginal = page.top;
          const pageBottomOriginal = page.bottom;

          const dH = -(edtSvc.lastHeightInput - value);
          const limitSide = toBottom ? 'bottom' : 'top';
          let newSide = page[limitSide] + dH * goniom * o.signY;
          page[limitSide] = newSide;
          let dY = (dH / 2) * goniom;
          
          page.height = value;
          let adjustedDeltaHeight = dH;
          let adjustedDeltaY = dY;

          if (toBottom ? newSide > 1 : newSide < 0) {
            page.height = pageHeightOriginal + ((toBottom ? 1 - pageBottomOriginal : pageTopOriginal) / goniom);
            page[limitSide] = toBottom ? 1 : 0;
            adjustedDeltaHeight = page.height - edtSvc.lastHeightInput;
            adjustedDeltaY = (adjustedDeltaHeight / 2) * goniom;
          }

          let deltaX = (adjustedDeltaHeight / 2) * inverseGoniom;
          let adjustedDeltaX = deltaX;
          const secondLimitSide = toRight ? 'right' : 'left';
          let secondNewSide = page[secondLimitSide] + adjustedDeltaHeight * inverseGoniom * inverseRatio * o.signX;
          page[secondLimitSide] = secondNewSide;

          if (toRight ? secondNewSide > 1 : secondNewSide < 0) {
            page.height = pageHeightOriginal + ((toRight ? (1 - pageRightOriginal) : pageLeftOriginal) / inverseGoniom) * ratio;
            page[secondLimitSide] = toRight ? 1 : 0;
            adjustedDeltaHeight = page.height - edtSvc.lastHeightInput;
            adjustedDeltaY = (adjustedDeltaHeight / 2) * goniom;
            adjustedDeltaX = (adjustedDeltaHeight / 2) * inverseGoniom;
            toBottom
              ? page.bottom = pageBottomOriginal + adjustedDeltaHeight * cos
              : page.top = pageTopOriginal - adjustedDeltaHeight * sin;
          }

          page.yc = page.yc + adjustedDeltaY * o.signY;
          page.xc = page.xc + adjustedDeltaX * o.signX * inverseRatio;
          edtSvc.lastHeightInput = value;
        };

        // --- Dispatch by angle ---
        switch (page.angle) {
          case 0:
            handleAlignedHeight(true, false);
            break;
          case -180:
            handleAlignedHeight(true, true);
            break;
          case 90:
            handleAlignedHeight(false, true);
            break;
          case -90:
            handleAlignedHeight(false, false);
            break;
          default:
            handleRotatedHeight(page.angle);
            break;
        }

        break;
      case 'angle':
        const newAngle = clamp(value, -45, 45);

        const canRotatePage = (page: Page, newAngle: number): boolean => {
          const bounds = edtSvc.computeBounds(page.xc, page.yc, page.width, page.height, newAngle);
          return (
            bounds.left >= 0 &&
            bounds.right <= 1 &&
            bounds.top >= 0 &&
            bounds.bottom <= 1
          );
        }

        edtSvc.rotationDirection = Math.sign((newAngle - page.angle) || newAngle);
        if (canRotatePage(page, newAngle)) {
          page.angle = newAngle;
        } else {
          const step = edtSvc.rotationDirection * (0.1 ** edtSvc.decimals);
          let tempAngle = page.angle;
          while (canRotatePage(page, tempAngle + step)) {
            tempAngle += step;
          }
          page.angle = tempAngle;
        }

        const bounds = edtSvc.computeBounds(page.xc, page.yc, page.width, page.height, page.angle);

        page.left = bounds.left;
        page.right = bounds.right;
        page.top = bounds.top;
        page.bottom = bounds.bottom;

        break;
    }

    edtSvc.pageWasEdited = true;
    edtSvc.sthWasEdited = true;
    this.updateAndRedraw(page);
  }

  onKeyDown(type: InputType, event: KeyboardEvent, input: HTMLInputElement): void {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();

    const direction = event.key === 'ArrowUp' ? 1 : -1;
    const multiplier = event.shiftKey ? 10 : 1;

    defer(() => this.adjustValue(type, input, direction, multiplier));
  }

  onArrowMouseDown(upDown: 'up' | 'down', event: MouseEvent, type: InputType, input: HTMLInputElement): void {
    event.preventDefault();

    const direction = upDown === 'up' ? 1 : -1;

    defer(() => this.adjustValue(type, input, direction));

    this.holdInterval = setInterval(() => this.adjustValue(type, input, direction), 100);

    const stop = () => {
      clearInterval(this.holdInterval);
      document.removeEventListener('mouseup', stop);
      document.removeEventListener('mouseleave', stop);
    };

    document.addEventListener('mouseup', stop);
    document.addEventListener('mouseleave', stop);
  }

  onFocus(type: InputType, input: HTMLInputElement): void {
    if (this.firstFocus[type]) this.selectAll(type, input);

    if (type === 'angle') {
      const edtSvc = this.edtSvc;
      edtSvc.isRotating = true;
      edtSvc.redrawImageOnCanvas();
      edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
    }
  }

  onInputBlur(type: InputType, input: HTMLInputElement): void { 
    const edtSvc = this.edtSvc;
    const page = edtSvc.selectedPage;
    if (!page) return;

    const factor = type === 'angle' ? 1 : 100;

    input.value = page[type]
      ? ((page[type] * factor).toFixed(edtSvc.decimals))
          .replace(/([.,]\d*?[1-9])0+$/, '$1') // Remove unnecessary trailing zeros, but keep the decimal if needed
          .replace(/([.,]0+)$/, '') // Remove trailing decimal if it becomes redundant (e.g., "10." → "10")
      : '0';
    
    this.cdr.detectChanges();

    this.firstFocus[type] = true;

    if (type === 'angle') {
      edtSvc.isRotating = false;
      edtSvc.redrawImageOnCanvas();
      edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
    }
  }

  onEscape(input: HTMLInputElement): void {
    input.blur();
    focusMainWrapper();
  }

  private adjustValue(type: InputType, input: HTMLInputElement, direction: 1 | -1,  multiplier: number = 1): void {
    const page = this.edtSvc.selectedPage;
    if (!page) return;

    

    const increment = (type === 'angle' ? this.edtSvc.incrementAngle : this.edtSvc.increment) * multiplier;
    const multiplicator = type === 'angle' ? 1 : 100;
    const currentValue = Number(input.value);
    const newValue = (currentValue / multiplicator + direction * increment) * multiplicator;

    this.changeInputValue(type, type === 'angle' ? newValue : Math.max(0, newValue));
    this.selectAll(type, input);
  }

  private selectAll(type: InputType, input: HTMLInputElement): void {
    this.firstFocus[type] = false;
    defer(() => input.select());
  }

  private parseInputValue(type: InputType, event: any): number {
    if (typeof event === 'number' || typeof event === 'string') return Number(event);
    if (event?.target?.value) return Number(event.target.value);

    const page = this.edtSvc.selectedPage;
    if (!page) return 0;
    switch (type) {
      case 'left': return page.left * 100;
      case 'top': return page.top * 100;
      case 'width': return page.width * 100;
      case 'height': return page.height * 100;
      case 'angle': return page.angle;
    }
  }

  private updateAndRedraw(page: Page): void {
    const edtSvc = this.edtSvc;
    edtSvc.imgWasEdited.set(true);
    edtSvc.lastSelectedPage = page;
    edtSvc.currentPages = edtSvc.currentPages.map(p => (p._id === page._id ? page : p));

    edtSvc.redrawImageOnCanvas();
    edtSvc.currentPages.forEach(p => edtSvc.drawPage(p));
  }
}
