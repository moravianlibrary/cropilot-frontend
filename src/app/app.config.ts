import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { EnvironmentService } from './services/environment.service';
import { DimColor, GridMode, PageNumberType, PermissionType, Role, ScanType, TitleState } from './app.types';

export const defaultColor = '#00DDFF';
export const warningColor = '#FF9500';
export const errorColor = '#FF3A30';
export const editedColor = '#FFCC00';
export const transparentColor = '#00000000';
export const gridColor = '#0078FF66'; // '#FF000050'

export const flagMessages: Record<string, string> = {
  'prediction_overlap': 'Výřezy se překrývají',
  'page_count_mismatch': 'Chybějící výřez',
  'no_prediction': 'Neúspěšná predikce',
  'low_confidence': 'Nejistota',
  'odd_dimensions': 'Podezřelý rozměr'
};

export const gridModeDict: Record<GridMode, string> = {
  'when-rotating': 'Při otáčení',
  'always': 'Vždy',
  'never': 'Nikdy'
};

export const dimColorDict: Record<DimColor, string> = {
  'Černá': '0,0,0,0.45',
  'Červená': '255,0,0,0.2',
  'Bílá': '255,255,255,0.2'
};

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

export const userRolesDict: Record<Role, string> = {
  'admin': 'Admin',
  'user': 'Uživatel'
};

export const permissionDict: Record<PermissionType, string> = {
  'read_group': 'Čtení',
  'read_title': 'Čtení',
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
  'completed': 'Uloženo'
}

export const titleStateFilterDict: Record<string, string> = {
  'Vše': 'all',
  'Nové': 'ready',
  'Uloženo': 'saved',
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
