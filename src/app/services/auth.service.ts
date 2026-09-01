import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { EnvironmentService } from './environment.service';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { catchError, of, throwError } from 'rxjs';
import { User } from '../app.types';
import { LocalStorageService } from './local-storage.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private env = inject(EnvironmentService);
  private storage = inject(LocalStorageService);

  username = signal<string>('');
  password = signal<string>('');
  error = signal<string>('');

  user = signal<User | null>(null);
  canReadTitle = signal<boolean>(false);
  canWriteTitle = signal<boolean>(false);
  canReadGroup = signal<string>('');
  canUpload = signal<boolean>(false);
  isAdmin = computed<boolean>(() => this.user()?.role === 'admin');
  // Local editing (moving/adding/removing crops in the editor) is allowed for any
  // authenticated viewer, including read-only users. Persisting changes still
  // requires write permission (canWriteTitle).
  canEditTitle = computed<boolean>(() => !!this.user());

  get baseUri(): string {
    return window.location.origin;
  }
  get apiUrl(): string { return this.env.get('serverBaseUrl') };
  authHeaders(type: string = 'json', contentType: boolean = false): HttpHeaders {
    const authType = 'Bearer';
    const accessToken = this.storage.get<string>('access_token', null, true);

    return new HttpHeaders({
      accept: type === 'json' ? 'application/json' : '*/*',
      ...(accessToken && { 'Authorization': `${authType} ${accessToken}` }),
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
    this.storage.set('redirectUri', url);

    let titleId: string | undefined = '';
    if (url.includes('book')) titleId = url.split('/').pop();

    return this.verifyToken(titleId).pipe(
      catchError((err) => {
        console.error('Token verification failed: ', err);
        return throwError(() => err);
      })
    ).subscribe((res: User) => {
      const user = res;
      this.user.set(user);
      
      const permissions = user.permissions;
      this.canWriteTitle.set(false);
      this.canReadGroup.set('');
      this.canUpload.set(!!permissions.filter(p => p.permission.includes('upload')).length);
      if (titleId && permissions.length) {
        const permission = permissions[0].permission;
        if (permission.includes('write')) this.canWriteTitle.set(true);
        if (permission.includes('read_group')) this.canReadGroup.set(permissions[0].group_id);
      }
    });
  }

  private verifyToken(titleId?: string): any {
    return this.http.get(`${this.apiUrl}/users/current-user${titleId ? `?title_id=${titleId}` : ''}`, { headers: this.authHeaders('json', true) })
  }

  redirectToLogin(): void {
    this.router.navigate(['/login']);
  }

  login(): void {
    this.storage.remove('access_token');
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

      this.storage.set('access_token', res.access_token);

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
    window.location.href = `${this.baseUri}${this.storage.get('redirectUri', '/', true)}`;
  }

  logout(): void {
    this.storage.remove('access_token');
    window.location.href = `${this.baseUri}/login`;
  }
}
