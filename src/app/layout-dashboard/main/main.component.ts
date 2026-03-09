import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DashboardService } from '../../services/dashboard.service';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { permissionDict, titleStateDict, titleStateFilterDict } from '../../app.config';
import { Group, GroupPage, Permission, PermissionType, User, UserInGroup } from '../../app.types';
import { focusElement, getDate, waitForElement } from '../../utils/utils';
import { OverlayScrollbars } from 'overlayscrollbars';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, of, Subscription, switchMap, tap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { OverlayModule } from '@angular/cdk/overlay';
import { Title } from '@angular/platform-browser';
import { ToastComponent } from '../../components/toast/toast.component';
import { UiService } from '../../services/ui.service';
import { TagsOverflowComponent } from '../../components/tags-overflow/tags-overflow.component';

@Component({
  selector: 'app-main-dashboard',
  imports: [FormsModule, CommonModule, OverlayModule, ToastComponent, TagsOverflowComponent],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})
export class MainComponent {
  dashSvc = inject(DashboardService);
  uiSvc = inject(UiService);
  authSvc = inject(AuthService);
  private title = inject(Title);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private paramsOnGroupId = new Subscription();

  getDate = getDate;
  maxUsers: number = 2;
  maxGroups: number = 2;
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
                  throw err;
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
                  
                  this.authSvc.canReadTitle.set(false);
                  if (this.authSvc.user()?.permissions.find(group => group.group_id === group_id && group.permission.includes('read_title'))) this.authSvc.canReadTitle.set(true);
                }),
                catchError(err => {
                  err.status === 403
                    ? this.router.navigate(['/forbidden'])
                    : this.uiSvc.showToast('Při načítání titulů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
                  console.error('Fetching titles failed:', err);
                  throw err;
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
                    : this.uiSvc.showToast('Při načítání uživatelů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });;
                  console.error('Fetching users failed:', err);
                  throw err;
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
    GROUPS
  ------------------------------ */
  permissionDict = permissionDict;
  
  get totalGroupsLabel(): string {
    const length = this.dashSvc.displayedGroups().length;
    return `Celkem ${length} skupin${length === 1 ? 'a' : [2, 3, 4].includes(length) ? 'y' : '' }`;
  }

  // getUsersShort(group: Group): UserInGroup[] {
  //   return group.users?.slice(0, this.maxUsers) ?? [];
  // }

  // getUsersLong(group: Group): UserInGroup[] {
  //   return group.users ?? [];
  // }

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
      || (t.model ?? '').toLowerCase().includes(searchTitles)
    ));
  }

  shouldHaveLink(state: string): boolean {
    return ['ready', 'user_approved', 'completed'].includes(state);
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
      case 'saved':
        this.dashSvc.displayedTitles.set(this.dashSvc.titles().filter(t => ['user_approved', 'completed'].includes(t.state)));
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
    this.dashSvc.displayedUsers.set(this.dashSvc.users().filter(u => u.full_name.toLowerCase().includes(this.dashSvc.searchUsers())));

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
