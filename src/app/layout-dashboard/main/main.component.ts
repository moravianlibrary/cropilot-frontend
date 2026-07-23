import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DashboardService } from '../../services/dashboard.service';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { permissionDict, titleStateDict, titleStateFilterDict } from '../../app.config';
import { Title, Group, GroupPage, Paginated, PagedQuery, Permission, PermissionType, SortField, SortState, TitlesQuery, User, UserInGroup } from '../../app.types';
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
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-main-dashboard',
  imports: [FormsModule, CommonModule, OverlayModule, ToastComponent, TagsOverflowComponent, ThTooltipDirective, IconComponent],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})
export class MainComponent {
  dashboard = inject(DashboardService);
  ui = inject(UiService);
  auth = inject(AuthService);
  private storage = inject(LocalStorageService);
  private title = inject(titleBrowser);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private paramsOnGroupId = new Subscription();

  getDate = getDate;
  tableHasScrollbar = signal<boolean>(false);

  // Server-side titles paging/filter state
  private currentGroupId = '';
  private titlesSearchDebounce?: ReturnType<typeof setTimeout>;
  // Shared debounce for the groups/users search inputs
  private listSearchDebounce?: ReturnType<typeof setTimeout>;

  // Builds a pagination/search/sort query for the groups & users list endpoints.
  private buildListQuery(page: number, search: string, pageSize: number): PagedQuery {
    const query: PagedQuery = { page, page_size: pageSize };
    const trimmed = search.trim();

    if (trimmed) query.search = trimmed;
    if (this.sortState.field) query.sort_field = this.sortState.field;
    if (this.sortState.direction) query.sort_direction = this.sortState.direction;

    return query;
  }

  // Resets search + sort before (re)loading a groups/users list page.
  private resetListQueryState(): void {
    this.dashboard.searchGroups.set('');
    this.dashboard.searchUsers.set('');
    this.sortState = { field: 'created_at', direction: 'desc' };
  }

  searchLabel = viewChild<ElementRef<HTMLLabelElement>>('searchLabel');
  bodyScroll = viewChild<ElementRef<HTMLDivElement>>('bodyScroll');
  private osInstance?: ReturnType<typeof OverlayScrollbars>;


  // ========== DIFFERENT PAGES INITIAL FETCHES ==========
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
              this.resetListQueryState();
              return this.dashboard.fetchGroupsPage({ page: 1 }).pipe(
                tap((res: Paginated<Group>) => {
                  this.dashboard.dashboardPage.set('groups');
                  this.applyGroupsResponse(res);
                }),
                catchError(err => {
                  this.ui.showToast('Při načítání skupin se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
                  console.error('Fetching groups failed:', err);
                  return throwError(() => err);
                })
              );

            // Titles
            case 'group':
              this.currentGroupId = group_id;
              this.resetTitlesQueryState();
              return this.dashboard.fetchTitles(group_id, { page: 1 }).pipe(
                tap((res: GroupPage) => {
                  this.dashboard.dashboardPage.set('titles');
                  this.dashboard.selectedGroupPage.set(res);
                  this.applyTitlesResponse(res);
                  this.title.setTitle(`${res.name} | CROPILOT`);

                  const titleId = this.storage.get('backFromTitleId', null, true);
                  if (titleId) {
                    this.dashboard.selectedTitle.set(res.titles.find(t => t._id === titleId) ?? null);
                    this.storage.remove('backFromTitleId');
                  }

                  this.auth.canReadTitle.set(false);
                  if (this.auth.user()?.permissions.find(group => group.group_id === group_id && group.permission.includes('read_title'))) this.auth.canReadTitle.set(true);
                }),
                catchError(err => {
                  err.status === 403
                    ? this.router.navigate(['/forbidden'])
                    : this.ui.showToast('Při načítání titulů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
                  console.error('Fetching titles failed:', err);
                  return throwError(() => err);
                })
              );

            // Users
            case 'users':
              this.resetListQueryState();
              return this.dashboard.fetchUsersPage({ page: 1 }).pipe(
                tap((res: Paginated<User>) => {
                  this.dashboard.dashboardPage.set('users');
                  this.applyUsersResponse(res);
                }),
                catchError(err => {
                  err.status === 403
                    ? this.router.navigate(['/forbidden'])
                    : this.ui.showToast('Při načítání uživatelů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
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


  // ========== SORT ==========
  sortState: SortState = {
    field: null,
    direction: null,
  };

  // All three list pages are sorted server-side (with pagination); reload page 1.
  sort(field: SortField): void {
    if (!field) return;

    const isSameField = this.sortState.field === field;
    const direction = !isSameField || this.sortState.direction === 'asc' ? 'desc' : 'asc';
    this.sortState = { field, direction };

    switch (this.dashboard.dashboardPage()) {
      case 'titles': this.loadTitles(1); break;
      case 'groups': this.loadGroups(1); break;
      case 'users': this.loadUsers(1); break;
    }
  }


  // ========== GROUPS ==========
  permissionDict = permissionDict;

  get totalGroupsLabel(): string {
    const length = this.dashboard.groupsTotal();
    return `Celkem ${length} skupin${length === 1 ? 'a' : [2, 3, 4].includes(length) ? 'y' : '' }`;
  }

  // Debounced server-side search (resets to first page).
  filterGroups(): void {
    clearTimeout(this.listSearchDebounce);
    this.listSearchDebounce = setTimeout(() => this.loadGroups(1), 300);
  }

  private applyGroupsResponse(res: Paginated<Group>): void {
    this.dashboard.groups.set(res.items);
    this.dashboard.displayedGroups.set(res.items);
    this.dashboard.groupsTotal.set(res.total);
    this.dashboard.groupsPage.set(res.page);
    this.dashboard.groupsPageSize.set(res.page_size);
    this.dashboard.groupsTotalPages.set(res.total_pages);
  }

  loadGroups(page: number): void {
    this.dashboard.fetchGroupsPage(this.buildListQuery(page, this.dashboard.searchGroups(), this.dashboard.groupsPageSize())).pipe(
      catchError(err => {
        this.ui.showToast('Při načítání skupin se něco pokazilo. Zkuste to znovu.', { type: 'error' });
        console.error('Fetching groups failed:', err);
        return throwError(() => err);
      })
    ).subscribe((res: Paginated<Group>) => this.applyGroupsResponse(res));
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


  // ========== TITLES ==========
  titleStateDict = titleStateDict;

  get totalTitlesLabel(): string {
    const length = this.dashboard.titlesTotal();
    return `Celkem ${length} titul${length === 1 ? '' : [2, 3, 4].includes(length) ? 'y' : 'ů' }`;
  }

  // Debounced server-side search (resets to first page).
  filterTitles(): void {
    clearTimeout(this.titlesSearchDebounce);
    this.titlesSearchDebounce = setTimeout(() => this.loadTitles(1), 300);
  }

  // ----- Server-side titles loading -----
  private resetTitlesQueryState(): void {
    this.dashboard.searchTitles.set('');
    this.selectedCropModel = 'all';
    this.selectedRotationModel = 'all';
    this.selectedState = 'all';
    this.sortState = { field: 'created_at', direction: 'desc' };
  }

  private applyTitlesResponse(res: GroupPage): void {
    this.dashboard.titles.set(res.titles);
    this.dashboard.displayedTitles.set(res.titles);
    this.dashboard.titlesTotal.set(res.total);
    this.dashboard.titlesPage.set(res.page);
    this.dashboard.titlesPageSize.set(res.page_size);
    this.dashboard.titlesTotalPages.set(res.total_pages);
    // filter_options only come with the first page; keep existing options otherwise.
    if (res.filter_options) {
      this.dashboard.titleCropModelOptions.set(res.filter_options.crop_models);
      this.dashboard.titleRotationModelOptions.set(res.filter_options.rotation_models);
    }
  }

  private buildTitlesQuery(page: number): TitlesQuery {
    const search = this.dashboard.searchTitles().trim();
    const query: TitlesQuery = { page, page_size: this.dashboard.titlesPageSize() };

    if (search) query.search = search;
    if (this.sortState.field) query.sort_field = this.sortState.field;
    if (this.sortState.direction) query.sort_direction = this.sortState.direction;
    if (this.selectedState && this.selectedState !== 'all') query.state = this.selectedState;
    if (this.selectedCropModel && this.selectedCropModel !== 'all') query.crop_model = this.selectedCropModel;
    if (this.selectedRotationModel && this.selectedRotationModel !== 'all') query.rotation_model = this.selectedRotationModel;

    return query;
  }

  loadTitles(page: number): void {
    if (!this.currentGroupId) return;

    this.dashboard.fetchTitles(this.currentGroupId, this.buildTitlesQuery(page)).pipe(
      catchError(err => {
        this.ui.showToast('Při načítání titulů se něco pokazilo. Zkuste to znovu.', { type: 'error' });
        console.error('Fetching titles failed:', err);
        return throwError(() => err);
      })
    ).subscribe((res: GroupPage) => this.applyTitlesResponse(res));
  }

  // ----- Pagination controls (shared across the active list page) -----
  // Current page / total pages for whichever list is being shown.
  currentListPage = computed<number>(() => {
    switch (this.dashboard.dashboardPage()) {
      case 'titles': return this.dashboard.titlesPage();
      case 'groups': return this.dashboard.groupsPage();
      case 'users': return this.dashboard.usersPage();
      default: return 1;
    }
  });

  currentListTotalPages = computed<number>(() => {
    switch (this.dashboard.dashboardPage()) {
      case 'titles': return this.dashboard.titlesTotalPages();
      case 'groups': return this.dashboard.groupsTotalPages();
      case 'users': return this.dashboard.usersTotalPages();
      default: return 0;
    }
  });

  goToPage(page: number): void {
    const total = this.currentListTotalPages();
    if (page < 1 || (total && page > total) || page === this.currentListPage()) return;

    switch (this.dashboard.dashboardPage()) {
      case 'titles': this.loadTitles(page); break;
      case 'groups': this.loadGroups(page); break;
      case 'users': this.loadUsers(page); break;
    }
  }

  prevPage(): void {
    this.goToPage(this.currentListPage() - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentListPage() + 1);
  }

  // Page numbers to render, with -1 marking an ellipsis gap.
  pageNumbers = computed<number[]>(() => {
    const total = this.currentListTotalPages();
    const current = this.currentListPage();
    if (total <= 1) return total === 1 ? [1] : [];
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = new Set<number>([1, total, current, current - 1, current + 1]);
    const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);

    const result: number[] = [];
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) result.push(-1);
      result.push(p);
      prev = p;
    }
    return result;
  });

  canOpenTitle(title: Title): boolean {
    return this.auth.canReadTitle() && this.shouldHaveLink(title.state);
  }

  shouldHaveLink(state: string): boolean {
    return ['ready', 'user_approved'].includes(state);
  }

  // Crop model filter
  cropModelDropdownOpen = false;
  selectedCropModel: string | null = 'all';
  cropModelOptions = computed<(string)[]>(() => ['all', ...this.dashboard.titleCropModelOptions()]);

  toggleCropModelDropdown(): void {
    this.cropModelDropdownOpen = !this.cropModelDropdownOpen;
  }

  onCropModelChange(cropModel: string): void {
    this.selectedRotationModel = 'all';
    this.selectedState = 'all';
    this.dashboard.searchTitles.set('');

    this.selectedCropModel = cropModel;
    this.cropModelDropdownOpen = false;

    this.loadTitles(1);
  }

  // Rotation model filter
  rotationModelDropdownOpen = false;
  selectedRotationModel: string | null = 'all';
  rotationModelOptions = computed<(string)[]>(() => ['all', ...this.dashboard.titleRotationModelOptions()]);

  toggleRotationModelDropdown(): void {
    this.rotationModelDropdownOpen = !this.rotationModelDropdownOpen;
  }

  onRotationModelChange(rotationModel: string): void {
    this.selectedCropModel = 'all';
    this.selectedState = 'all';
    this.dashboard.searchTitles.set('');

    this.selectedRotationModel = rotationModel;
    this.rotationModelDropdownOpen = false;

    this.loadTitles(1);
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
    this.selectedCropModel = 'all';
    this.selectedRotationModel = 'all';
    this.dashboard.searchTitles.set('');

    this.selectedState = stateValue;
    this.stateDropdownOpen = false;

    this.loadTitles(1);
  }


  // ========== USERS ==========
  get totalUsersLabel(): string {
    const length = this.dashboard.usersTotal();
    return `Celkem ${length} uživatel${[2, 3, 4].includes(length) ? 'é' : 'ů' }`;
  }

  // Debounced server-side search (resets to first page).
  filterUsers(): void {
    clearTimeout(this.listSearchDebounce);
    this.listSearchDebounce = setTimeout(() => this.loadUsers(1), 300);
  }

  private applyUsersResponse(res: Paginated<User>): void {
    this.dashboard.users.set(res.items);
    this.dashboard.displayedUsers.set(res.items);
    this.dashboard.usersTotal.set(res.total);
    this.dashboard.usersPage.set(res.page);
    this.dashboard.usersPageSize.set(res.page_size);
    this.dashboard.usersTotalPages.set(res.total_pages);
  }

  loadUsers(page: number): void {
    this.dashboard.fetchUsersPage(this.buildListQuery(page, this.dashboard.searchUsers(), this.dashboard.usersPageSize())).pipe(
      catchError(err => {
        this.ui.showToast('Při načítání uživatelů se něco pokazilo. Zkuste to znovu.', { type: 'error' });
        console.error('Fetching users failed:', err);
        return throwError(() => err);
      })
    ).subscribe((res: Paginated<User>) => this.applyUsersResponse(res));
  }

  getUserPermissions(perms: Permission[]): PermissionType[] {
    return [...new Set(perms.flatMap(p => p.permission))];
  }
}
