import { defaultColor, editedColor, errorColor, warningColor } from '../app.config';
import { Page } from '../app.types';

/* ------------------------------
  MATH
------------------------------ */
export const degreeToRadian = (angle: number): number => {
  return (angle * Math.PI) / 180;
}

export const radianToDegree = (angle: number): number => {
  return (angle * 180) / Math.PI;
}

export const roundToDecimals = (value: number, decimals: number = 2): number => {
  return Number(value.toFixed(decimals));
}

export const clamp = (value: number, min: number = 0, max: number = 1): number => {
  return Math.min(max, Math.max(min, value));
}


/* ------------------------------
  FORMATTING
------------------------------ */
export const getDate = (input: string): string[] => {
  const date = new Date(input);
  return date
    .toLocaleString('cs-CZ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    .replace(/\. /g, '.')
    .split(' ');
}

export const checkEmailValidity = (email: string): boolean => {
  if (!email) return false;

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return emailRegex.test(normalizedEmail);
}


/* ------------------------------
  UI
------------------------------ */
export const defer = (fn: () => void, delay: number = 0) => {
  return setTimeout(fn, delay);
}

export const focusElement = (el: HTMLElement, delay: number = 0, preventScroll: boolean = false): void => {
  if (el) {
    if (delay < 0) {
      el.focus({ preventScroll: preventScroll });
      return;
    }

    defer(() => el.focus({ preventScroll: preventScroll }), delay);
  }
}

export const focusMainWrapper = (): void => {
  const el = document.querySelector('.main-wrapper') as HTMLElement;
  focusElement(el);
}

export const scrollToElement = (el: HTMLElement, delay: number = 100): void => {
  if (delay < 0 && el) {
    (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  
  defer(() => {
    if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, delay);
}

export const scrollToAndFocusElement = (el: HTMLElement): void => {
  scrollToElement(el, -1);
  focusElement(el, -1, true);
}

export const scrollToSelectedImage = async (imageId: string, delay: number = -1): Promise<void> => {
  const el = await waitForElement(`#thumbnail-wrapper-${imageId}`);
  scrollToElement(el, delay);
}

export const waitForElement = (selector: string, root: ParentNode = document): Promise<HTMLElement> => {
  const el = root.querySelector(selector) as HTMLElement | null;
  if (el) return Promise.resolve(el);

  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector) as HTMLElement | null;
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(
      root === document ? document.documentElement : (root as Node),
      { childList: true, subtree: true }
    );
  });
}


/* ------------------------------
    PAGES
  ------------------------------ */
export const getColor = (page: Page): string => {
  if (page.edited) return editedColor;

  const errorFlags = [
    // 'page_count_mismatch',
    // 'no_prediction',
    'prediction_overlap',
  ];
  if (page.flags.some(f => errorFlags.includes(f))) {
    return errorColor;
  }

  const warningFlags = [
    'low_confidence',
    'odd_dimensions',
  ];
  if (page.flags.some(f => warningFlags.includes(f))) {
    return warningColor;
  }

  return defaultColor;
}
