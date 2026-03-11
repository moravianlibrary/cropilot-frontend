import { effect, EffectRef, inject, Injectable, Injector, runInInjectionContext, Signal, signal } from '@angular/core';
import { DialogButton, DialogContentType, DrawerButton, DrawerContentType, Toast, ToastType } from '../app.types';
import { defer, focusElement, focusMainWrapper, waitForElement } from '../utils/utils';
import { OverlayScrollbars } from 'overlayscrollbars';

@Injectable({
  providedIn: 'root'
})
export class UiService {
  private osInstance?: ReturnType<typeof OverlayScrollbars>;


  /* ------------------------------
    WAIT FOR SIGNAL
  ------------------------------ */
  private injector = inject(Injector);

  waitForFalse(sig: Signal<boolean>): Promise<void> {
    return runInInjectionContext(this.injector, () => new Promise<void>((resolve) => {
      let ref!: EffectRef;

      ref = effect(() => {
        if (sig() === false) {
          ref.destroy();
          resolve();
        }
      });
    }));
  }

  
  /* ------------------------------
    TOAST MESSAGES
  ------------------------------ */
  toasts = signal<Toast[]>([]);
  private toastDuration: number = 3000;
  private toastErrorDuration: number = 300000;
  
  showToast(message: string, opts?: { type?: ToastType; duration?: number }): string {
    const id = crypto.randomUUID();
    const toast: Toast = {
      id,
      message,
      type: opts?.type ?? 'info',
      duration: opts?.duration ?? (opts?.type === 'error' ? this.toastErrorDuration : this.toastDuration),
    };

    this.toasts.update((prev) => [...prev, toast]);
    window.setTimeout(() => this.dismissToast(id), toast.duration);

    return id;
  }

  dismissToast(id: string) {
    this.toasts.update((prev) => prev.filter((t) => t.id !== id));
    focusMainWrapper();
  }

  clearAllToasts() {
    this.toasts.set([]);
  }


  /* ------------------------------
    DIALOG
  ------------------------------ */
  dialogOpened: boolean = false;
  dialogOpen = signal<boolean>(false);
  dialogWidth = signal<number | null>(null);
  dialogTitle = signal<string>('');
  dialogContent = signal<boolean>(false);
  dialogContentType = signal<DialogContentType | null>(null);
  dialogDescription = signal<string | null>(null);
  dialogButtons = signal<DialogButton[]>([]);
  confirmBtnDisabled = signal<boolean>(false);
  confirmBtnDisabledTimer!: number; 
  
  async openDialog(): Promise<void> {
    this.dialogOpen.set(true);
    this.dialogOpened = true;

    const dialogBody = await waitForElement('#dialog-body');
    this.osInstance = OverlayScrollbars(dialogBody, {
      overflow: { x: 'hidden', y: 'scroll' },
      scrollbars: {
        theme: 'os-theme-orezy',
        autoHide: 'leave',
        autoHideDelay: 250,
        dragScroll: true,
        clickScroll: true,
      },
    });
    dialogBody.classList.remove('os-pending');
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
    this.dialogOpened = false;
  }


  /* ------------------------------
    DRAWER
  ------------------------------ */
  drawerOpen = signal<boolean>(false);
  drawerTitle = signal<string>('');
  drawerContent = signal<boolean>(false);
  drawerContentType = signal<DrawerContentType | null>(null);
  drawerDescription = signal<string | null>(null);
  drawerButtons = signal<DrawerButton[]>([]);
  
  async openDrawer(): Promise<void> {
    this.drawerOpen.set(true);

    const drawerBody = await waitForElement('#drawer-body');
    this.osInstance = OverlayScrollbars(drawerBody, {
      overflow: { x: 'hidden', y: 'scroll' },
      scrollbars: {
        theme: 'os-theme-orezy',
        autoHide: 'leave',
        autoHideDelay: 250,
        dragScroll: true,
        clickScroll: true,
      },
    });
    drawerBody.classList.remove('os-pending');
    // focusElement(drawerBody);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }
}
