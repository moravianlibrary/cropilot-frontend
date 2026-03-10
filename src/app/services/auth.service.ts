import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { EnvironmentService } from './environment.service';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { catchError, of } from 'rxjs';
import { User } from '../app.types';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private envSvc = inject(EnvironmentService);

  username = signal<string>('');
  password = signal<string>('');
  error = signal<string>('');

  user = signal<User | null>(null);
  canReadTitle = signal<boolean>(false);
  canWriteTitle = signal<boolean>(false);
  canReadGroup = signal<string>('');
  canUpload = signal<boolean>(false);
  isAdmin = computed<boolean>(() => this.user()?.role === 'admin');

  get baseUri(): string {
    return window.location.origin;
  }
  get apiUrl(): string { return this.envSvc.get('serverBaseUrl') };
  authHeaders(type: string = 'json', contentType: boolean = false): HttpHeaders {
    const authType = 'Bearer';

    return new HttpHeaders({
      accept: type === 'json' ? 'application/json' : '*/*',
      Authorization: `${authType} ${localStorage.getItem('access_token')}`,
      ...(contentType && { 'Content-Type': 'application/json' })
    });
  }
  private get loginHeaders(): HttpHeaders {
    return new HttpHeaders({
      accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    });
  }
    
  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
    const url = state.url;
    localStorage.setItem('redirectUri', url);
    const accessToken = localStorage.getItem('access_token');

    // Possible výjimka z loginu
    // if (condition) return true;

    if (accessToken) {
      let titleId: string | undefined = '';
      if (url.includes('book')) titleId = url.split('/').pop();

      return this.verifyToken(titleId).pipe(
        catchError((err) => {
          this.router.navigate(['/login']);
          console.error('Token verification failed: ', err);
          throw err;
        })
      ).subscribe((res: User) => {
        const user = res;
        this.user.set(user);
        
        const permissions = user.permissions;
        const permission = permissions[0].permission;
        this.canWriteTitle.set(false);
        this.canReadGroup.set('');
        this.canUpload.set(!!permissions.filter(p => p.permission.includes('upload')).length);
        if (titleId) {
          if (permission.includes('write')) this.canWriteTitle.set(true);
          if (permission.includes('read_group')) this.canReadGroup.set(permissions[0].group_id);
        }
      });
    }

    this.redirectToLogin();
    return false;
  }

  private verifyToken(titleId?: string): any {
    return this.http.get(`${this.apiUrl}/users/current-user${titleId ? `?title_id=${titleId}` : ''}`, { headers: this.authHeaders('json', true) })
  }

  private redirectToLogin(): void {
    this.router.navigate(['/login']);
  }

  login(): void {
    localStorage.removeItem('access_token');
    this.error.set('');

    this.getToken().pipe(
      catchError((err) => {
        console.log('Token fetch failed: ', err);
        return of(null);
      })
    ).subscribe((res: any) => {
      if (!res?.access_token) {
        console.warn('No access_token in response');
        this.error.set('Nesprávný e-mail nebo heslo');
        return;
      }

      localStorage.setItem('access_token', res.access_token);

      this.redirectToStoredUri();
    })
  }

  private getToken() {
    const url = `${this.apiUrl}/users/login`;
    const body = new HttpParams()
      .set('grant_type', 'password')
      .set('username', this.username())
      .set('password', this.password())
      .set('scope', '')
      .set('client_id', '')
      .set('client_secret', '');

    return this.http.post(url, body.toString(), { headers: this.loginHeaders });
  }

  private redirectToStoredUri(): void {
    window.location.href = `${this.baseUri}${localStorage.getItem('redirectUri')}`;
  }

  logout(): void {
    localStorage.removeItem('access_token');
    window.location.href = `${this.baseUri}/login`;
  }
}
