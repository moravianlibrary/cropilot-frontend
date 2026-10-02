import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, TitleStrategy } from '@angular/router';
import { TranslatedTitleStrategy } from './i18n/title-strategy';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { EnvironmentService } from './services/environment.service';
import { CropColorLabel, DefaultFitMode, DimColor, GridDensityLabel, GridLineWidthLabel, GridMode, OutlineWidthLabel, PageNumberType, PermissionType, Role, ScanType, TitleState } from './app.types';

// Crop outline + grid share one user-selected color (see cropColorDict).
// Crop state (anomaly flags) is not encoded in the outline color any more; it is
// shown as a small badge at the crop corner and in the side panels.
export const warningColor = '#FF9500';
export const errorColor = '#FF3A30';
export const predictedColor = '#A855F7';
export const transparentColor = '#00000000';

export const flagMessages: Record<string, string> = {
  'prediction_overlap': 'Výřezy se překrývají',
  'page_count_mismatch': 'Chybějící výřez',
  'no_prediction': 'Neúspěšná predikce',
  'low_confidence': 'Nejistota',
  'odd_dimensions': 'Podezřelý rozměr',
  'bad_split': 'Špatné rozdělení dvojstrany'
};

// Flags that mean the prediction is likely wrong (red); the rest are warnings (orange).
export const errorFlagTypes = ['page_count_mismatch', 'no_prediction', 'prediction_overlap', 'bad_split'];

// What each flag means and what to check (tooltip of the status row).
export const flagHints: Record<string, string> = {
  'prediction_overlap': 'Dva výřezy se překrývají. Zkontrolujte jejich hranice.',
  'page_count_mismatch': 'Nalezeno méně výřezů, než má sken obvykle mít.',
  'no_prediction': 'Model na skenu nenašel žádnou stranu.',
  'low_confidence': 'Model si detekcí není jistý. Zkontrolujte okraje výřezu.',
  'odd_dimensions': 'Výřez má jiný poměr stran než ostatní strany titulu.',
  'bad_split': 'Střed dvoustrany nesedí na hřbet. Zkontrolujte rozdělení.'
};

// Scan-level flags have no crop to point at; tell the user what to do instead.
export const flagActionHints: Record<string, string> = {
  'page_count_mismatch': 'přidejte ho tlačítkem výše',
  'no_prediction': 'přidejte výřez ručně'
};

export const gridModeDict: Record<GridMode, string> = {
  'when-rotating': 'Při otáčení',
  'always': 'Vždy',
  'never': 'Nikdy'
};

export const gridDensityDict: Record<GridDensityLabel, number> = {
  'Řídká': 24,
  'Běžná': 16,
  'Hustá': 12,
  'Velmi hustá': 8
};

// Color of the crop outline, its handles and the grid. 'Tyrkysová' is the
// original editor outline color; the outline sits outside the crop, so the set
// covers dark scanner backgrounds (light colors) and light paper (dark colors).
// Orange / red / purple are reserved for crop state and admin predictions.
export const CROP_COLOR_DEFAULT: CropColorLabel = 'Tyrkysová';
export const cropColorDict: Record<CropColorLabel, string> = {
  'Tyrkysová': '#00DDFF',
  'Korálová': '#E57368',
  'Bílá': '#FFFFFF',
  'Černá': '#1A1A1A'
};

// Grid lines use the crop color at 40 % opacity.
export const GRID_COLOR_ALPHA = '66';
export function gridColor(label: CropColorLabel): string {
  return cropColorDict[label] + GRID_COLOR_ALPHA;
}

export const gridLineWidthDict: Record<GridLineWidthLabel, number> = {
  'Tenká': 1,
  'Střední': 1.5,
  'Silná': 2,
  'Výrazná': 3
};

export const OUTLINE_WIDTH_DEFAULT: OutlineWidthLabel = 'Střední';
export const outlineWidthDict: Record<OutlineWidthLabel, number> = {
  'Silný': 3,
  'Střední': 2,
  'Tenký': 1,
  'Žádný': 0
};

// Dim ("clona") color as "r,g,b,a" where a is the strongest dim available.
export const dimColorDict: Record<DimColor, string> = {
  'Černá': '0,0,0,0.45',
  'Tmavě modrá': '30,64,175,0.45',
  'Bílá': '255,255,255,0.2',
  'Žádná': '0,0,0,0',
};

// Dim opacity slider: 0 = dim invisible, 100 = the color's built-in alpha
// above (the strongest dim available, still translucent). 'Žádná' is always
// invisible.
export const DIM_OPACITY_DEFAULT = 50;

export function dimAlpha(color: DimColor, opacity: number): number {
  const base = Number(dimColorDict[color].split(',')[3]);
  return base * Math.min(100, Math.max(0, opacity)) / 100;
}

export function dimColorRgba(color: DimColor, opacity: number): string {
  const [r, g, b] = dimColorDict[color].split(',');
  return `rgba(${r},${g},${b},${dimAlpha(color, opacity)})`;
}

// Solid-ish preview of a dim color for the settings swatches.
export function dimColorSwatch(color: DimColor): string {
  const [r, g, b] = dimColorDict[color].split(',');
  return `rgba(${r},${g},${b},0.85)`;
}

export const filterScanTypeStartDict: Record<ScanType, string> = {
  'all': 'Vše',
  'flagged': 'Podezřelé',
  'edited': 'Upravené',
  'ok': 'OK'
};

export const filterPageNumberStartDict: Record<PageNumberType, string> = {
  'all': 'Vše',
  'single': 'Jednostrany',
  'double': 'Dvoustrany'
};

export const defaultFitModeDict: Record<DefaultFitMode, string> = {
  'page': 'Celý sken',
  'selection': 'Výřezy'
};

export const userRolesDict: Record<Role, string> = {
  'admin': 'Admin',
  'user': 'Uživatel'
};

export const permissionDict: Record<PermissionType, string> = {
  'read_group': 'Zobrazení všech titulů',
  'read_title': 'Detail titulu',
  'write': 'Úpravy',
  'upload': 'Správa'
};

export const titleStateDict: Record<TitleState, string> = {
  'new': 'Založena',
  'scheduled': 'Bude se zpracovávat',
  'in_progress': 'Zpracovává se',
  'failed': 'Chyba',
  'ready': 'Nové',
  'user_approved': 'Uloženo',
  'retrain': 'Přetrénování',
  'completed': 'Dokončeno'
}

export const titleStateFilterDict: Record<string, string> = {
  'Vše': 'all',
  'Nové': 'ready',
  'Uloženo': 'user_approved',
  'Skeny nenahrány': 'new',
  'Bude se zpracovávat': 'scheduled',
  'Zpracovává se': 'in_progress',
  'Chyba': 'failed'
}

export const inlineErrors: Record<string, string> = {
  'groupNameEmpty': 'Zadejte název skupiny.',
  'groupNameExists': 'Skupina s daným názvem už existuje. Zadejte prosím jiný název.',
  'titleNameEmpty': 'Zadejte název titulu.',
  'filesEmpty': 'Nahrajte skeny.',
  'userNameEmpty': 'Zadejte jméno uživatele.',
  'userEmailEmpty': 'Zadejte e-mail uživatele.',
  'userEmailInvalid': 'Zadejte e-mail uživatele ve formátu uzivatel@domena.cz.',
  'userEmailExists': 'Uživatel s daným e-mailem už existuje. Zadejte prosím jiný e-mail.',
  'selectedGroupEmpty': 'Vyberte skupinu.',
  'groupPermissionsEmpty': 'Vyberte práva ve skupině.',
  'selectedUserEmpty': 'Vyberte uživatele.',
  'userPermissionsEmpty': 'Vyberte práva člena.'
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(),
    provideRouter(routes),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideAppInitializer(() => {
      // Inject services
      const envService = inject(EnvironmentService);

      return (async () => {
        // Wait for environment to load
        await envService.load();
        const serverBaseUrl = envService.get('serverBaseUrl') as string;
        console.log('Using serverBaseUrl:', serverBaseUrl);

        // Nic nevracíme – Promise<void> splněna
      })();
    }),
  ]
};
