import { Component, ElementRef, inject, signal, viewChild, WritableSignal } from '@angular/core';
import { DashboardService } from '../../services/dashboard.service';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { permissionDict, titleStateDict, titleStateFilterDict } from '../../app.config';
import { Title, Group, GroupPage, Permission, PermissionType, SortField, SortState, User, UserInGroup } from '../../app.types';
import { focusElement, getDate, waitForElement } from '../../utils/utils';
import { OverlayScrollbars } from 'overlayscrollbars';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, of, Subscription, switchMap, tap, throwError } from 'rxjs';
import { CommonModule } from '@angular/common';
import { OverlayModule } from '@angular/cdk/overlay';
import { Title as titleBrowser } from '@angular/platform-browser';
import { ToastComponent } from '../../components/toast/toast.component';
import { UiService } from '../../services/ui.service';
import { TagsOverflowComponent } from '../../components/tags-overflow/tags-overflow.component';
import { ThTooltipDirective } from '../../directives/th-tooltip.directive';
import { LocalStorageService } from '../../services/local-storage.service';

@Component({
  selector: 'app-main-dashboard',
  imports: [FormsModule, CommonModule, OverlayModule, ToastComponent, TagsOverflowComponent, ThTooltipDirective],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})
export class MainComponent {
  dashSvc = inject(DashboardService);
  uiSvc = inject(UiService);
  authSvc = inject(AuthService);
  private storage = inject(LocalStorageService);
  private title = inject(titleBrowser);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private paramsOnGroupId = new Subscription();

  getDate = getDate;
  tableHasScrollbar = signal<boolean>(false);

  searchLabel = viewChild<ElementRef<HTMLLabelElement>>('searchLabel');
  bodyScroll = viewChild<ElementRef<HTMLDivElement>>('bodyScroll');
  private osInstance?: ReturnType<typeof OverlayScrollbars>;


  /* ------------------------------
    DIFFERENT PAGES INITIAL FETCHES
  ------------------------------ */
  ngOnInit() {
    
    // Subscribe to params
    this.paramsOnGroupId = this.activatedRoute.paramMap
      .pipe(
        map(params => params.get('group_id') || ''),
        switchMap(group_id => { 
          const path = this.router.url;
          const page = path.match(/^\/([^\/]+)/)?.[1] ?? null;

          switch (page) {

            // Groups
            case 'groups':
              return this.dashSvc.fetchGroups().pipe(
                tap((res: Group[]) => {
                  this.dashSvc.dashboardPage.set('groups');
                  this.dashSvc.groups.set(res);
                  this.dashSvc.displayedGroups.set(this.dashSvc.groups());
                }),
                catchError(err => {
                  this.uiSvc.showToast('Při načítání skupin se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
                  console.error('Fetching groups failed:', err);
                  return throwError(() => err);
                })
              );

            // Titles
            case 'group':
              return this.dashSvc.fetchTitles(group_id).pipe(
                tap((res: GroupPage) => {
                  this.dashSvc.dashboardPage.set('titles');
                  this.dashSvc.selectedGroupPage.set(res);
                  this.dashSvc.titles.set(res.titles);
                  this.dashSvc.displayedTitles.set(res.titles);
                  this.title.setTitle(`${res.name} | CROPILOT`);

                  const titleId = this.storage.get('backFromTitleId', null, true);
                  if (titleId) {
                    this.dashSvc.selectedTitle.set(res.titles.find(t => t._id === titleId) ?? null);
                    this.storage.remove('backFromTitleId');
                  }
                  
                  this.authSvc.canReadTitle.set(false);
                  if (this.authSvc.user()?.permissions.find(group => group.group_id === group_id && group.permission.includes('read_title'))) this.authSvc.canReadTitle.set(true);
                }),
                catchError(err => {
                  err.status === 403
                    ? this.router.navigate(['/forbidden'])
                    : this.uiSvc.showToast('Při načítání titulů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
                  console.error('Fetching titles failed:', err);
                  return throwError(() => err);
                })
              );

            // Users
            case 'users':
              return this.dashSvc.fetchUsers().pipe(
                tap((res: User[]) => {
                  this.dashSvc.dashboardPage.set('users');
                  this.dashSvc.users.set(res);
                  this.dashSvc.displayedUsers.set(res);
                }),
                catchError(err => {
                  err.status === 403
                    ? this.router.navigate(['/forbidden'])
                    : this.uiSvc.showToast('Při načítání uživatelů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
                  console.error('Fetching users failed:', err);
                  return throwError(() => err);
                })
              );

            default:
              return of(null);
          }
        })).subscribe(async () => {      
          const someResults = await waitForElement('tbody tr:not(.no-results)');
          const tableScroll = this.bodyScroll()?.nativeElement as HTMLDivElement;
          this.osInstance = OverlayScrollbars(tableScroll, {
            overflow: { x: 'hidden', y: 'scroll' },
            scrollbars: {
              theme: 'os-theme-orezy',
              autoHide: 'leave',
              autoHideDelay: 250,
              dragScroll: true,
              clickScroll: true,
            },
          });
          tableScroll.classList.remove('os-pending');
          this.tableHasScrollbar.set(this.osInstance.state().hasOverflow.y);

          // Focus input
          const searchInput = await waitForElement('input', this.searchLabel()?.nativeElement);
          focusElement(searchInput);
        });
  }

  ngOnDestroy(): void {
    this.paramsOnGroupId.unsubscribe();
    this.osInstance?.destroy();
    this.osInstance = undefined;
  }


  /* ------------------------------
    SORT
  ------------------------------ */
  sortState: SortState = {
    field: null,
    direction: null,
  };

  sortDate(field: SortField): void {
    if (!field) return;
    let table: WritableSignal<any[]> | undefined;

    switch (this.dashSvc.dashboardPage()) {
      case 'groups':
        table = this.dashSvc.displayedGroups;
        break;
      case 'titles':
        table = this.dashSvc.displayedTitles;
        break;
      case 'users':
        table = this.dashSvc.displayedUsers;
        break;
    }

    if (!table) return;

    const isSameField = this.sortState.field === field;
    const direction = !isSameField || this.sortState.direction === 'asc' ? 'desc' : 'asc';

    this.sortState = { field, direction };

    table.update(items =>
      [...items].sort((a, b) => {
        const aTime = new Date(a[field]).getTime();
        const bTime = new Date(b[field]).getTime();
        return direction === 'asc' ? aTime - bTime : bTime - aTime;
      })
    );
  }


  /* ------------------------------
    GROUPS
  ------------------------------ */
  permissionDict = permissionDict;
  
  get totalGroupsLabel(): string {
    const length = this.dashSvc.displayedGroups().length;
    return `Celkem ${length} skupin${length === 1 ? 'a' : [2, 3, 4].includes(length) ? 'y' : '' }`;
  }

  filterGroups(): void {
    const searchGroups = this.dashSvc.searchGroups();
    this.dashSvc.displayedGroups.set(this.dashSvc.groups().filter(g => 
      g.name.toLowerCase().includes(searchGroups)
      || g.description.toLowerCase().includes(searchGroups)
      || g._id.toLowerCase().includes(searchGroups)
    ));
  }

  getTags(group: Group): string[] {
    return group.users.map(u => u.full_name);
  }

  getGroupPermissionsCounts(users: UserInGroup[]): Partial<Record<PermissionType, number>> {
    return users.reduce<Partial<Record<PermissionType, number>>>(
      (acc, user) => {
        user.permission.forEach(p => {
          acc[p] = (acc[p] ?? 0) + 1;
        });
        return acc;
      },
      {
        upload: 0,
        write: 0,
        read_title: 0,
        read_group: 0
      }
    )
  };

  getPermissionsTypes(aggregations: Partial<Record<PermissionType, number>>): PermissionType[] {
    return Object.keys(aggregations) as PermissionType[];
  }


  /* ------------------------------
    TITLES
  ------------------------------ */
  titleStateDict = titleStateDict;

  get totalTitlesLabel(): string {
    const length = this.dashSvc.displayedTitles().length;
    return `Celkem ${length} titul${length === 1 ? '' : [2, 3, 4].includes(length) ? 'y' : 'ů' }`;
  }

  filterTitles(): void {
    const searchTitles = this.dashSvc.searchTitles();
    this.dashSvc.displayedTitles.set(this.dashSvc.titles().filter(t => 
      (t.external_id ?? '').toLowerCase().includes(searchTitles)
      || t._id.toLowerCase().includes(searchTitles)
      || (t.default_settings?.crop_model ?? '').toLowerCase().includes(searchTitles)
    ));
  }

  canOpenTitle(title: Title): boolean {
    return this.authSvc.canReadTitle() && this.shouldHaveLink(title.state);
  }

  shouldHaveLink(state: string): boolean {
    return ['ready', 'user_approved'].includes(state);
  }

  // State filter
  titleStateFilterDict = titleStateFilterDict;
  stateDropdownOpen = false;
  selectedState: string | null = 'all';
  stateOptions = Object.keys(titleStateFilterDict);

  toggleStateDropdown(): void {
    this.stateDropdownOpen = !this.stateDropdownOpen;
  }

  onStateChange(stateValue: string): void {
    this.selectedState = stateValue;
    this.stateDropdownOpen = false;

    switch (stateValue) {
      case 'all':
        this.dashSvc.displayedTitles.set(this.dashSvc.titles());
        break;
      default:
        this.dashSvc.displayedTitles.set(this.dashSvc.titles().filter(t => t.state === stateValue));
        break;
    }
  }


  /* ------------------------------
    USERS
  ------------------------------ */
  get totalUsersLabel(): string {
    const length = this.dashSvc.displayedUsers().length;
    return `Celkem ${length} uživatel${[2, 3, 4].includes(length) ? 'é' : 'ů' }`;
  }

  filterUsers(): void {
    const searchUsers = this.dashSvc.searchUsers();
    this.dashSvc.displayedUsers.set(this.dashSvc.users().filter(u => 
      u.full_name.toLowerCase().includes(searchUsers)
      || u.email.toLowerCase().includes(searchUsers)
      || u._id.toLowerCase().includes(searchUsers)
    ));
  }

  getUserPermissions(perms: Permission[]): PermissionType[] {
    return [...new Set(perms.flatMap(p => p.permission))];
  }
}
