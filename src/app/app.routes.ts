import { Routes } from '@angular/router';
import { AuthService } from './services/auth.service';

export const routes: Routes = [
  {
    path: 'login',
    pathMatch: 'full',
    loadComponent: () => import('./routes/login/login.component').then((m) => m.LoginComponent),
    title: 'Přihlášení | CROPILOT'
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'groups'
  },
  {
    path: 'group/:group_id',
    pathMatch: 'full',
    loadComponent: () => import('./routes/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    title: 'Skupiny - Tituly | CROPILOT',
    canActivate: [ AuthService ]
  },
  {
    path: 'groups',
    pathMatch: 'full',
    loadComponent: () => import('./routes/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    title: 'Skupiny | CROPILOT',
    canActivate: [ AuthService ]
  },
  {
    path: 'users',
    pathMatch: 'full',
    loadComponent: () => import('./routes/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    title: 'Uživatelé | CROPILOT',
    canActivate: [ AuthService ]
  },
  {
    path: 'statistics',
    pathMatch: 'full',
    loadComponent: () => import('./routes/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    title: 'Statistiky | CROPILOT',
    canActivate: [ AuthService ]
  },
  {
    path: 'book/:book_id',
    pathMatch: 'full',
    loadComponent: () => import('./routes/editor/editor.component').then((m) => m.EditorComponent),
    title: 'Kontrola a úpravy | CROPILOT',
    canActivate: [ AuthService ]
  },
  {
    path: 'forbidden',
    loadComponent: () => import('./routes/errors/forbidden/forbidden.component').then((m) => m.ForbiddenComponent),
    title: 'Nemáte oprávnění | CROPILOT'
  },
  {
    path: '**',
    loadComponent: () => import('./routes/errors/not-found/not-found.component').then((m) => m.NotFoundComponent),
    title: 'Stránka nenalezena | CROPILOT'
  }
];
