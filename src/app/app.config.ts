import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { EnvironmentService } from './services/environment.service';
import { DefaultFitMode, DimColor, GridColorLabel, GridDensityLabel, GridLineWidthLabel, GridMode, OutlineWidthLabel, PageNumberType, PermissionType, Role, ScanType, TitleState } from './app.types';

export const defaultColor = '#00DDFF';
export const warningColor = '#FF9500';
export const errorColor = '#FF3A30';
export const editedColor = '#FFCC00';
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

export const gridColorDict: Record<GridColorLabel, string> = {
  'Modrá': '#0078FF66',
  'Azurová': '#00A6A666',
  'Žlutá': '#FFCC0066',
  'Červená': '#FF3A3066'
};

export const gridLineWidthDict: Record<GridLineWidthLabel, number> = {
  'Tenká': 1,
  'Střední': 1.5,
  'Silná': 2,
  'Výrazná': 3
};

export const outlineWidthDict: Record<OutlineWidthLabel, number> = {
  'Silný': 3,
  'Střední': 2,
  'Tenký': 1,
  'Žádný': 0
};

export const dimColorDict: Record<DimColor, string> = {
  'Černá': '0,0,0,0.45',
  'Červená': '255,0,0,0.2',
  'Bílá': '255,255,255,0.2',
  'Žádná': '0,0,0,0',
};

// Dim opacity slider: 0 = dim invisible, 100 = the color's built-in alpha
// above (the strongest dim available). 'Žádná' is always invisible.
export const DIM_OPACITY_DEFAULT = 100;

export function dimAlpha(color: DimColor, opacity: number): number {
  const base = Number(dimColorDict[color].split(',')[3]);
  return base * Math.min(100, Math.max(0, opacity)) / 100;
}

export function dimColorRgba(color: DimColor, opacity: number): string {
  const [r, g, b] = dimColorDict[color].split(',');
  return `rgba(${r},${g},${b},${dimAlpha(color, opacity)})`;
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
