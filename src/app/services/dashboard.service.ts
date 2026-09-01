import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal, WritableSignal } from '@angular/core';
import { catchError, EMPTY, expand, forkJoin, from, map, mergeMap, Observable, of, reduce, switchMap, tap, throwError, toArray } from 'rxjs';
import { AuthService } from './auth.service';
import { AssignableUser, ChangedGroupMember, DashboardPage, DrawerButton, Group, GroupPage, Models, NewGroup, NewPassword, NewUser, Paginated, PagedQuery, Permission, PermissionType, SelectOption, Title, TitlesQuery, User, UserInGroup } from '../app.types';
import { Router } from '@angular/router';
import { checkEmailValidity, defer, focusMainWrapper, scrollToAndFocusElement, scrollToElement } from '../utils/utils';
import { inlineErrors } from '../app.config';
import { UiService } from './ui.service';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private ui = inject(UiService);
  private router = inject(Router);

  dashboardPage = signal<DashboardPage>('groups');
  errors = inlineErrors;

  // Groups
  groups = signal<Group[]>([]);
  displayedGroups = signal<Group[]>([]);
  searchGroups = signal<string>('');
  // Server-side pagination for the groups table
  groupsTotal = signal<number>(0);
  groupsPage = signal<number>(1);
  groupsPageSize = signal<number>(50);
  groupsTotalPages = signal<number>(0);
  selectedGroupDetail = signal<Group | null>(null);
  selectedGroupPage = signal<GroupPage | null>(null);
  groupName = signal<string>('');
  groupDescription = signal<string>('');
  groupPermissions = signal<UserInGroup[]>([]);
  availableUsers = signal<SelectOption[]>([]);
  selectedUserId = signal<string>('');
  selectedUserUsed = signal<boolean>(false);
  groupNameError = signal<string>('');
  selectedUserError = signal<string>('');
  userPermissionsError: Record<string, string> = {};
  groupChanged = computed<boolean>(() => {
    const group = this.selectedGroupDetail();
    if (!group) return false;
    
    const groupNonmembersDataChanged = this.groupNonmembersDataChanged();
    const permissionsChanged = group.users !== this.groupPermissions();
    
    return groupNonmembersDataChanged || permissionsChanged;
  });
  groupNonmembersDataChanged = computed<boolean>(() => {
    const group = this.selectedGroupDetail();
    if (!group) return false;

    const nameChanged = group.name !== this.groupName();
    const descriptionChanged = group.description !== this.groupDescription();
    const modelChanged = group.default_settings.crop_model !== this.selectedCropModel();

    return nameChanged || descriptionChanged || modelChanged;
  });
  membersAdded = computed<ChangedGroupMember[]>(() => {
    const group = this.selectedGroupDetail();
    const permissions = this.groupPermissions();
    const permissionsChanged = group?.users !== permissions;

    if (!permissionsChanged) return [];
    return permissions
      .filter(u => !group?.users.map(user => user._id).includes(u._id))
      .map(u => ({ user_id: u._id, user_permissions: u.permission }));
  });
  membersAddedWithFullname = computed<UserInGroup[]>(() => {
    const group = this.selectedGroupDetail();
    const permissions = this.groupPermissions();
    const permissionsChanged = group?.users !== permissions;

    if (!permissionsChanged) return [];
    return permissions
      .filter(u => !group?.users.map(user => user._id).includes(u._id))
      .map(u => ({ _id: u._id, full_name: u.full_name, permission: u.permission }));
  });
  membersUpdated = computed<ChangedGroupMember[]>(() => {
    const group = this.selectedGroupDetail();
    const permissions = this.groupPermissions();
    const permissionsChanged = group?.users !== permissions;

    if (!permissionsChanged) return [];
    return permissions
      .filter(u => group?.users.map(user => user._id).includes(u._id) && !group?.users.includes(u))
      .map(u => ({ user_id: u._id, user_permissions: u.permission }));
  });
  membersRemoved = computed<string[]>(() => {
    const group = this.selectedGroupDetail();
    const permissions = this.groupPermissions();
    const permissionsChanged = group?.users !== permissions;

    if (!permissionsChanged || !group) return [];
    return group?.users
      .filter(u => !permissions.map(u => u._id).includes(u._id))
      .map(u => u._id);
  });

  // Titles
  titles = signal<Title[]>([]);
  displayedTitles = signal<Title[]>([]);
  searchTitles = signal<string>('');
  // Server-side pagination + filter options for the titles table
  titlesTotal = signal<number>(0);
  titlesPage = signal<number>(1);
  titlesPageSize = signal<number>(50);
  titlesTotalPages = signal<number>(0);
  titleCropModelOptions = signal<string[]>([]);
  titleRotationModelOptions = signal<string[]>([]);
  selectedTitle = signal<Title | null>(null);
  titleName = signal<string>('');
  titleNameError = signal<string>('');
  availableCropModels = signal<SelectOption[]>([]);
  selectedCropModel = signal<string>('');
  selectedCropModelUsed = signal<boolean>(false);
  availableRotationModels = signal<SelectOption[]>([]);
  selectedRotationModel = signal<string>('');
  selectedRotationModelUsed = signal<boolean>(false);
  files = signal<File[]>([]);
  uploadFilesError = signal<string>('');
  cropModelChanged = computed<boolean>(() => this.selectedTitle()?.settings?.crop_model !== this.selectedCropModel());
  rotationModelChanged = computed<boolean>(() => this.selectedTitle()?.settings?.rotation_model !== this.selectedRotationModel());
  // Baseline of the title edit form as it was opened (with defaulted models),
  // so a title without settings doesn't open as already "changed".
  titleBaseline = signal<{ name: string; crop: string; rotation: string; assignee: string } | null>(null);
  titleDirtyCount = computed<number>(() => {
    const base = this.titleBaseline();
    if (!base || !this.selectedTitle()) return 0;

    let count = 0;
    if (base.name !== this.titleName()) count++;
    if (base.crop !== this.selectedCropModel()) count++;
    if (base.rotation !== this.selectedRotationModel()) count++;
    if (base.assignee !== this.selectedAssigneeId()) count++;
    return count;
  });
  titleChanged = computed<boolean>(() => this.titleDirtyCount() > 0);

  // True only when the user actually changed a model from what the title had on open.
  // Uses the baseline (not the raw stored value) so a settings-less title, whose model
  // selects default to the first option, doesn't show a false "will re-queue" warning.
  modelChangedFromBaseline = computed<boolean>(() => {
    const base = this.titleBaseline();
    return !!base && (base.crop !== this.selectedCropModel() || base.rotation !== this.selectedRotationModel());
  });

  // Who can assign titles here: an admin (anywhere), or a manager (upload) in THIS
  // group. Read straight from the signed-in user's own per-group permissions, which
  // are always available from the token — no dependency on the titles/list payload.
  canAssignInCurrentGroup = computed<boolean>(() => {
    if (this.auth.isAdmin()) return true;
    const groupId = this.selectedGroupPage()?._id;
    if (!groupId) return false;
    const perms = this.auth.user()?.permissions?.find(p => p.group_id === groupId)?.permission;
    return perms?.includes('upload') ?? false;
  });
  // Title assignment (drawer): available group members + current selection ('' = unassigned).
  availableAssignees = signal<SelectOption[]>([]);
  selectedAssigneeId = signal<string>('');
  selectedAssigneeUsed = signal<boolean>(false);
  assigneeChanged = computed<boolean>(() => (this.selectedTitle()?.assigned_to ?? '') !== this.selectedAssigneeId());

  // Users
  users = signal<User[]>([]);
  displayedUsers = signal<User[]>([]);
  searchUsers = signal<string>('');
  // Server-side pagination for the users table
  usersTotal = signal<number>(0);
  usersPage = signal<number>(1);
  usersPageSize = signal<number>(50);
  usersTotalPages = signal<number>(0);
  selectedUser = signal<User | null>(null);
  newPassword = signal<string>('');
  userFullname = signal<string>('');
  userEmail = signal<string>('');
  userPermissions = signal<Permission[]>([]);
  availableGroups = signal<SelectOption[]>([]);
  selectedGroupId = signal<string>('');
  selectedGroupUsed = signal<boolean>(false);
  userNameError = signal<string>('');
  userEmailError = signal<string>('');
  selectedGroupError = signal<string>('');
  groupPermissionsError: Record<string, string> = {};
  userChanged = computed<boolean>(() => {
    const user = this.selectedUser();
    if (!user) return false;

    const userNonmembersDataChanged = this.userNonmembersDataChanged();
    const permissionsChanged = user.permissions !== this.userPermissions();

    return userNonmembersDataChanged || permissionsChanged;
  });
  userNonmembersDataChanged = computed<boolean>(() => {
    const user = this.selectedUser();
    if (!user) return false;

    const fullnameChanged = user.full_name !== this.userFullname();
    const emailChanged = user.email !== this.userEmail();

    return fullnameChanged || emailChanged;
  });


  // ========== API ==========
  // Builds pagination/search/sort query params shared by the list endpoints.
  private pagedParams(query: PagedQuery): HttpParams {
    let params = new HttpParams()
      .set('page', String(query.page ?? 1))
      .set('page_size', String(query.page_size ?? 50));

    if (query.search) params = params.set('search', query.search);
    if (query.sort_field) params = params.set('sort_field', query.sort_field);
    if (query.sort_direction) params = params.set('sort_direction', query.sort_direction);
    if (query.group_id) params = params.set('group_id', query.group_id);

    return params;
  }

  // Groups
  // Full list (no pagination) - used by pickers/dialogs and external callers.
  fetchGroups(): Observable<Group[]> {
    return this.http.get<Group[]>(`${this.auth.apiUrl}/groups`, { headers: this.auth.authHeaders() });
  }

  // Paginated list - used by the groups dashboard page.
  fetchGroupsPage(query: PagedQuery = {}): Observable<Paginated<Group>> {
    return this.http.get<Paginated<Group>>(`${this.auth.apiUrl}/groups`, {
      headers: this.auth.authHeaders(),
      params: this.pagedParams(query),
    });
  }

  createGroup(): Observable<NewGroup> {
    const payload = {
      name: this.groupName(),
      description: this.groupDescription(),
      default_settings: {
        crop_model: this.selectedCropModel(),
        rotation_model: this.selectedRotationModel()
      }
    };
    return this.http.post<NewGroup>(`${this.auth.apiUrl}/groups`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  deleteGroup(groupId: string): Observable<void> {
    return this.http.delete<void>(`${this.auth.apiUrl}/groups/${groupId}`, { headers: this.auth.authHeaders() });
  }

  updateGroup(groupId: string): Observable<void> {
    const payload = {
      name: this.groupName(),
      description: this.groupDescription(),
      default_settings: {
        crop_model: this.selectedCropModel(),
        rotation_model: this.selectedRotationModel()
      }
    };

    return this.http.patch<void>(`${this.auth.apiUrl}/groups/${groupId}`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  bulkAddGroupMembers(groupId: string): Observable<void> {
    const payload = this.membersAdded();
    return this.http.post<void>(`${this.auth.apiUrl}/groups/${groupId}/members`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  bulkUpdateGroupMembers(groupId: string): Observable<void> {
    const payload = this.membersUpdated();
    return this.http.patch<void>(`${this.auth.apiUrl}/groups/${groupId}/members`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  bulkRemoveGroupMembers(groupId: string): Observable<void> {
    const payload = this.membersRemoved();
    return this.http.delete<void>(`${this.auth.apiUrl}/groups/${groupId}/members`, {
      headers: this.auth.authHeaders('json', true),
      body: payload
    });
  }

  // Titles
  fetchTitles(groupId: string, query: TitlesQuery = {}): Observable<GroupPage> {
    let params = new HttpParams()
      .set('page', String(query.page ?? 1))
      .set('page_size', String(query.page_size ?? this.titlesPageSize()));

    if (query.search) params = params.set('search', query.search);
    if (query.sort_field) params = params.set('sort_field', query.sort_field);
    if (query.sort_direction) params = params.set('sort_direction', query.sort_direction);
    if (query.state) params = params.set('state', query.state);
    if (query.crop_model) params = params.set('crop_model', query.crop_model);
    if (query.rotation_model) params = params.set('rotation_model', query.rotation_model);

    return this.http.get<GroupPage>(`${this.auth.apiUrl}/groups/${groupId}`, {
      headers: this.auth.authHeaders(),
      params,
    });
  }

  // Fetches every title in a group across all pages (no search/filters applied),
  // used by the CSV export. Pages through the endpoint until the last page.
  fetchAllTitles(groupId: string): Observable<Title[]> {
    const pageSize = 200;
    return this.fetchTitles(groupId, { page: 1, page_size: pageSize }).pipe(
      expand(res =>
        res.page < res.total_pages
          ? this.fetchTitles(groupId, { page: res.page + 1, page_size: pageSize })
          : EMPTY
      ),
      reduce((acc, res) => acc.concat(res.titles), [] as Title[]),
    );
  }

  fetchModels(): Observable<Models> {
    return this.http.get<Models>(`${this.auth.apiUrl}/models`, { headers: this.auth.authHeaders() });
  }

  createTitle(groupId: string): Observable<{ id: string }> {
    const payload = {
      external_id: this.titleName(),
      settings: {
        crop_model: this.selectedCropModel(),
        rotation_model: this.selectedRotationModel()
      }
    };
    return this.http.post<{ id: string }>(`${this.auth.apiUrl}/create?group_id=${groupId}`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  uploadScan(titleId: string, file: File): Observable<void> {
    const form = new FormData();
    form.append('scan_data', file, file.name);
    return this.http.post<void>(`${this.auth.apiUrl}/${titleId}/upload-scan`, form, { headers: this.auth.authHeaders() });
  }

  uploadAllScans(titleId: string, files: File[], concurrency: number = 5): Observable<string> {
    return from(files).pipe(
      mergeMap(file => this.uploadScan(titleId, file), concurrency),
      toArray(), // collects all emitted values, and emits one single array
      map(() => titleId)
    );
  }

  processTitle(titleId: string): Observable<void> {
    return this.http.post<void>(`${this.auth.apiUrl}/${titleId}/process`, {}, { headers: this.auth.authHeaders() });
  }

  updateTitle(titleId: string): Observable<Title> {
    const cropModelChanged = this.cropModelChanged();
    const rotationModelChanged = this.rotationModelChanged();
    const payload = {
      external_id: this.titleName(),
      ...((cropModelChanged || rotationModelChanged) && { settings: {
        crop_model: this.selectedCropModel(),
        rotation_model: this.selectedRotationModel()
      } })
    };
    return this.http.patch<Title>(`${this.auth.apiUrl}/${titleId}`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  deleteTitle(titleId: string): Observable<void> {
    return this.http.delete<void>(`${this.auth.apiUrl}/${titleId}`, { headers: this.auth.authHeaders() });
  }

  // Group members a title can be assigned to (manager only).
  fetchAssignableUsers(groupId: string): Observable<AssignableUser[]> {
    return this.http.get<AssignableUser[]>(`${this.auth.apiUrl}/groups/${groupId}/assignable-users`, { headers: this.auth.authHeaders() });
  }

  // Assign a title to a user, or clear it with userId === null.
  assignTitle(titleId: string, userId: string | null): Observable<{ assigned_to: string | null; assigned_to_name: string | null }> {
    return this.http.patch<{ assigned_to: string | null; assigned_to_name: string | null }>(
      `${this.auth.apiUrl}/${titleId}/assign`,
      { user_id: userId },
      { headers: this.auth.authHeaders('json', true) }
    );
  }

  // Users
  // Full list (no pagination) - used by pickers/dialogs.
  fetchUsers(groupId?: string): Observable<User[]> {
    return this.http.get<User[]>(`${this.auth.apiUrl}/users${groupId ? `?group_id=${groupId}` : ''}`, { headers: this.auth.authHeaders() });
  }

  // Paginated list - used by the users dashboard page.
  fetchUsersPage(query: PagedQuery = {}): Observable<Paginated<User>> {
    return this.http.get<Paginated<User>>(`${this.auth.apiUrl}/users`, {
      headers: this.auth.authHeaders(),
      params: this.pagedParams(query),
    });
  }

  createUser(): Observable<NewUser> {
    const permissions = this.userPermissions();
    const payload = {
      email: this.userEmail(),
      full_name: this.userFullname(),
      ...(permissions && { permissions: permissions })
    };

    return this.http.post<NewUser>(`${this.auth.apiUrl}/users/register`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  deleteUser(userId: string): Observable<void> {
    return this.http.delete<void>(`${this.auth.apiUrl}/users/${userId}`, { headers: this.auth.authHeaders() });
  }

  updateUser(userId: string): Observable<User> {
    const payload = {
      full_name: this.userFullname(),
      email: this.userEmail(),
      permissions: this.userPermissions()
    };

    return this.http.patch<User>(`${this.auth.apiUrl}/users/${userId}`, payload, { headers: this.auth.authHeaders('json', true) });
  }

  resetPassword(userId: string): Observable<NewPassword> {
    return this.http.patch<NewPassword>(`${this.auth.apiUrl}/users/${userId}/reset-password`, {}, { headers: this.auth.authHeaders() });
  }


  // ========== DASHBOARD PAGES ==========
  navigateToGroups(): void {
    this.closeDrawer();
    this.dashboardPage.set('groups');
    this.router.navigate(['/groups']);
  }

  openGroupsTitles(groupId: string): void {
    this.closeDrawer();
    this.dashboardPage.set('titles');
    this.router.navigate(['/group', groupId]);
  }

  openTitle(bookId: string): void {
    window.location.href = `${this.auth.baseUri}/book/${bookId}`;
  }

  navigateToUsers(): void {
    this.closeDrawer();
    this.dashboardPage.set('users');
    this.router.navigate(['/users']);
  }


  // ========== DIALOGS ==========
  // Group
  createGroupDialog(): void {
    const ui = this.ui;
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Nová skupina');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('new-group');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Vytvořit',
        primary: true,
        action: () => {
          const groupName = this.groupName();

          if (!groupName) {
            this.groupNameError.set(this.errors['groupNameEmpty']);
            const el = document.getElementById('group-name') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (this.groups().some(g => g.name === groupName)) {
            this.groupNameError.set(this.errors['groupNameExists']);
            const el = document.getElementById('group-name') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          const emptyUsers = this.groupPermissions().filter(g => !g.permission.length);
          if (emptyUsers.length) {
            this.userPermissionsError[emptyUsers[0]._id] = this.errors['userPermissionsEmpty'];
            const el = document.getElementById(`permissions-row-${emptyUsers[0]._id}`) as HTMLElement;
            scrollToElement(el);
            return;
          }

          ui.closeDialog();
          
          return this.createGroup().pipe(
            switchMap((res: NewGroup) => this.membersAdded().length
              ? this.bulkAddGroupMembers(res.id).pipe(
                  map(() => res),
                  catchError(err => {
                    this.ui.showToast('Při přidávání členů do skupiny se něco pokazilo. Zkuste to znovu.', { type: 'error' });
                    console.error(err);
                    return throwError(() => err);
                  })
                )
              : of(res)
            ),
            tap((res: NewGroup) => {
              const now = new Date().toISOString();
              const permissions = ['read_group', 'read_title', 'write', 'upload'] as PermissionType[];
              const newGroup: Group = {
                _id: res.id,
                name: groupName,
                api_key: {
                  key: res?.api_key ?? '',
                  created_at: now  
                },
                description: this.groupDescription(),
                default_settings: { 
                  crop_model: this.selectedCropModel(),
                  rotation_model: this.selectedRotationModel()
                },
                created_at: now,
                modified_at: now,
                title_count: 0,
                permissions: permissions,
                users: this.membersAddedWithFullname()
              };

              this.searchGroups.set('');
              this.groups.update(prev => [ ...prev, newGroup ]);
              this.displayedGroups.set(this.groups());
              this.selectedGroupDetail.set(newGroup);
              this.groupName.set('');
              this.groupDescription.set('');
              this.groupNameError.set('');
            }),
            catchError(err => {
              this.ui.showToast('Při vytváření skupiny se něco pokazilo. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe(() => this.openGroupDetail(this.selectedGroupDetail()))
        }
      }
    ]);

    this.groupName.set('');
    this.groupDescription.set('');
    this.groupNameError.set('');

    this.fetchModels().pipe(
      tap((res: Models) => {
        this.availableCropModels.set(res.crop_models.map(m => ({ value: m, label: m })));
        this.selectedCropModel.set(res.crop_models[0]);
        this.selectedCropModelUsed.set(false);
        this.availableRotationModels.set(res.rotation_models.map(m => ({ value: m, label: m })));
        this.selectedRotationModel.set(res.rotation_models[1]);
        this.selectedRotationModelUsed.set(false);
      }),
      catchError(err => {
        this.ui.showToast('Nepodařilo se načíst dostupné modely. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      }),
      switchMap(() => this.fetchUsers().pipe(
        catchError(err => {
          this.ui.showToast('Nepodařilo se načíst uživatele. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
          console.error(err);
          return throwError(() => err);
        })
      )),
    ).subscribe((res: User[]) => {
      this.users.set(res);
      this.availableUsers.set(res.filter(u => u.role !== 'admin').map(u => ({ value: u._id, label: u.full_name })));
      this.selectedUserError.set('');
      this.groupPermissions.set([]);
      this.userPermissionsError = {};
      this.closeDrawer();
      ui.openDialog();
    });
  }

  editGroupDialog(): void {
    const ui = this.ui;
    const group = this.selectedGroupDetail();
    if (!group) return;
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Úprava skupiny');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('edit-group');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Upravit',
        primary: true,
        action: () => {
          const groupName = this.groupName();

          if (!groupName) {
            this.groupNameError.set(this.errors['groupNameEmpty']);
            const el = document.getElementById('group-name') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (this.groups().filter(g => g._id !== group._id).some(g => g.name === groupName)) {
            this.groupNameError.set(this.errors['groupNameExists']);
            const el = document.getElementById('group-name') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          ui.closeDialog();
          
          return this.updateGroup(group._id).pipe(
            catchError(err => {
              this.ui.showToast('Nepodařilo se upravit skupinu. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe(() => {
            const updatedGroup: Group = {
              ...group,
              name: this.groupName(),
              description: this.groupDescription(),
              default_settings: { 
                crop_model: this.selectedCropModel(),
                rotation_model: this.selectedRotationModel()
              },
            };
            this.groups.update(prev => prev.map(g => g._id === group?._id ? updatedGroup : g))
            this.displayedGroups.set(this.groups());
            this.selectedGroupDetail.set(updatedGroup);
            this.groupNameError.set('');
          })
        }
      }
    ]);

    this.groupName.set(group.name);
    this.groupDescription.set(group.description);
    this.groupNameError.set('');

    this.fetchModels().pipe(
      catchError(err => {
        this.ui.showToast('Nepodařilo se načíst dostupné modely. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      })
    ).subscribe((res: Models) => {
      this.availableCropModels.set(res.crop_models.map(m => ({ value: m, label: m })));
      this.selectedCropModel.set(group.default_settings.crop_model);
      this.selectedCropModelUsed.set(false);
      this.availableRotationModels.set(res.rotation_models.map(m => ({ value: m, label: m })));
      this.selectedRotationModel.set(group.default_settings.rotation_model);
      this.selectedRotationModelUsed.set(false);
      ui.openDialog();
    });
  }

  deleteGroupDialog(): void {
    const ui = this.ui;
    const group = this.selectedGroupDetail();
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Smazat skupinu');
    ui.dialogDescription.set(`Opravdu chcete smazat skupinu${' ' + group?.name}?`);
    ui.dialogContent.set(false);
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Smazat skupinu',
        primary: true,
        destructive: true,
        action: () => this.deleteGroup(group?._id ?? '').pipe(
          tap(() => {
            const updated = this.groups().filter(g => g._id !== group?._id);
            this.groups.set(updated);
            this.displayedGroups.set(updated);
            this.selectedGroupDetail.set(null);
            ui.closeDialog();
          }),
          catchError(err => {
            this.ui.showToast('Při mazání skupiny se něco pokazilo. Zkuste to znovu.', { type: 'error' });
            console.error(err);
            return throwError(() => err);
          })
        ).subscribe(() => this.closeDrawer())
      }
    ])

    ui.openDialog();
  }

  // Title
  createTitleDialog(): void {
    const ui = this.ui;
    this.files.set([]);
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Nový titul');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('new-title');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Vytvořit',
        primary: true,
        action: () => {
          const titleName = this.titleName();

          if (!titleName) {
            this.titleNameError.set(this.errors['titleNameEmpty']);
            const el = document.getElementById('new-title-name') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (!this.files().length) {
            this.uploadFilesError.set(this.errors['filesEmpty']);
            const el = document.getElementById('new-title-upload') as HTMLElement;
            scrollToElement(el);
            return;
          }

          ui.closeDialog();
          
          return this.createTitle(this.selectedGroupPage()?._id ?? '').pipe(
            map(res => {
              const now = new Date().toISOString();
              const newTitle: Title = {
                _id: res.id,
                external_id: titleName,
                settings: { 
                  crop_model: this.selectedCropModel(),
                  rotation_model: this.selectedRotationModel()
                },
                created_at: now,
                modified_at: now,
                state: 'scheduled'
              };

              this.searchTitles.set('');
              this.titles.update(prev => [ newTitle, ...prev ]);
              this.displayedTitles.set(this.titles());
              this.titlesTotal.update(prev => prev + 1);

              return res.id;
            }),
            switchMap(id => this.uploadAllScans(id, this.files()).pipe(
              catchError(err => {
                this.ui.showToast(`Při nahrávání skenů se něco pokazilo. Titul smažte a přidejte ho jako nový.`, { type: 'error' });
                console.error(err);
                return throwError(() => err);
              })
            )),
            switchMap(id => this.processTitle(id).pipe(
              catchError(err => {
                this.ui.showToast(`Při zpracovávání skenů se něco pokazilo. Titul smažte a přidejte ho jako nový.`, { type: 'error' });
                console.error(err);
                return throwError(() => err);
              })
            )),
            catchError(err => {
              this.ui.showToast(`Při vytváření titulu se něco pokazilo. Titul smažte a přidejte ho jako nový.`, { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe();
        }
      }
    ]);

    this.fetchModels().pipe(
      catchError(err => {
        this.ui.showToast('Nepodařilo se načíst dostupné modely. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      })
    ).subscribe((res: Models) => {
      this.titleName.set('');
      this.titleNameError.set('');
      this.uploadFilesError.set('');
      this.availableCropModels.set(res.crop_models.map(m => ({ value: m, label: m })));
      this.selectedCropModel.set(this.selectedGroupPage()?.default_settings.crop_model ?? res.crop_models[0]);
      this.selectedCropModelUsed.set(false);
      this.availableRotationModels.set(res.rotation_models.map(m => ({ value: m, label: m })));
      this.selectedRotationModel.set(this.selectedGroupPage()?.default_settings.rotation_model ?? res.rotation_models[0]);
      this.selectedRotationModelUsed.set(false);
      this.closeDrawer();
      ui.openDialog();
    });
  }

  onSelectCropModelUsed(used: boolean): void {
    this.selectedCropModelUsed.set(used);
  }

  onSelectRotationModelUsed(used: boolean): void {
    this.selectedRotationModelUsed.set(used);
  }

  uploadFiles(files: FileList) {
    this.files.update(prev => [ ...prev, ...Array.from(files) ]);
  }

  editTitleDialog(title: Title): void {
    const ui = this.ui;
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Úprava titulu');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('edit-title');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Změnit',
        primary: true,
        action: () => {
          if (!this.titleChanged()) return;
          
          const titleName = this.titleName();

          if (!titleName) {
            this.titleNameError.set(this.errors['titleNameEmpty']);
            const el = document.getElementById('new-title-name') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }
          
          return this.updateTitle(title._id).pipe(
            catchError(err => {
              this.ui.showToast(`Při ukládání změn se něco pokazilo. Zkuste to znovu.`, { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe((res: Title) => {
            const editedTitle: Title = {
              ...title,
              external_id: titleName,
              settings: {
                crop_model: this.selectedCropModel(),
                rotation_model: this.selectedRotationModel()
              },
              modified_at: new Date().toISOString(),
              state: res.state
            };

            this.searchTitles.set('');
            this.titles.update(prev => prev.map(t => t._id === title._id ? editedTitle : t));
            this.displayedTitles.set(this.titles());
            
            ui.closeDialog();
          });
        }
      }
    ]);

    this.fetchModels().pipe(
      catchError(err => {
        this.ui.showToast('Nepodařilo se načíst dostupné modely. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      })
    ).subscribe((res: Models) => {
      this.selectedTitle.set(title);
      this.titleName.set(title.external_id ?? '');
      this.titleNameError.set('');
      this.availableCropModels.set(res.crop_models.map(m => ({ value: m, label: m })));
      this.selectedCropModel.set(title.settings?.crop_model ?? res.crop_models[0]);
      this.selectedCropModelUsed.set(false);
      this.availableRotationModels.set(res.rotation_models.map(m => ({ value: m, label: m })));
      this.selectedRotationModel.set(title.settings?.rotation_model ?? res.rotation_models[0]);
      this.selectedRotationModelUsed.set(false);
      this.selectedAssigneeId.set(title.assigned_to ?? '');
      this.selectedAssigneeUsed.set(false);
      this.titleBaseline.set({
        name: this.titleName(),
        crop: this.selectedCropModel(),
        rotation: this.selectedRotationModel(),
        assignee: this.selectedAssigneeId(),
      });
      this.closeDrawer();
      ui.openDialog();
    });
  }

  deleteTitleDialog(title: Title): void {
    const ui = this.ui;
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Smazat titul');
    ui.dialogDescription.set(`Opravdu chcete smazat titul${' ' + title?.external_id}?`);
    ui.dialogContent.set(false);
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Smazat titul',
        primary: true,
        destructive: true,
        action: () => this.deleteTitle(title?._id ?? '').pipe(
          tap(() => {
            this.titles.update(prev => prev.filter(t => t._id !== (title?._id ?? '')));
            this.displayedTitles.set(this.titles());
            this.titlesTotal.update(prev => Math.max(0, prev - 1));
            ui.closeDialog();
          }),
          catchError(err => {
            this.ui.showToast('Nepodařilo se smazat titul. Zkuste to znovu.', { type: 'error' })
            console.error(err);
            return throwError(() => err);
          })
        ).subscribe(() => this.closeDrawer())
      }
    ])

    this.selectedTitle.set(title);
    ui.openDialog();
  }

  // Title detail drawer — view info + change name/model + delete.
  openTitleDetail(title: Title): void {
    const ui = this.ui;

    const buttons: DrawerButton[] = [
      {
        label: 'Zavřít',
        action: () => this.closeDrawer()
      },
      {
        label: 'Uložit změny',
        primary: true,
        action: () => {
          const current = this.selectedTitle();
          if (!current || !this.titleChanged()) return;

          const titleName = this.titleName();
          if (!titleName) {
            this.titleNameError.set(this.errors['titleNameEmpty']);
            return;
          }

          const assigneeChanged = this.assigneeChanged();
          const newAssigneeId = this.selectedAssigneeId();

          return this.updateTitle(current._id).pipe(
            switchMap(res => assigneeChanged
              ? this.assignTitle(current._id, newAssigneeId || null).pipe(map(a => ({ res, a })))
              : of({ res, a: null as { assigned_to: string | null; assigned_to_name: string | null } | null })),
            catchError(err => {
              this.ui.showToast('Při ukládání změn se něco pokazilo. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe(({ res, a }) => {
            const editedTitle: Title = {
              ...current,
              external_id: titleName,
              settings: {
                crop_model: this.selectedCropModel(),
                rotation_model: this.selectedRotationModel()
              },
              modified_at: new Date().toISOString(),
              state: res.state,
              ...(a ? { assigned_to: a.assigned_to, assigned_to_name: a.assigned_to_name } : {})
            };
            this.titles.update(prev => prev.map(t => t._id === current._id ? editedTitle : t));
            this.displayedTitles.set(this.titles());
            this.selectedTitle.set(editedTitle);
            this.closeDrawer();
          });
        }
      }
    ];

    this.fetchModels().pipe(
      catchError(err => {
        this.ui.showToast('Nepodařilo se načíst dostupné modely. Zkuste panel znovu otevřít.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      })
    ).subscribe((res: Models) => {
      // Seed the drawer state only once the models are loaded, so a failed
      // fetch doesn't leave the dashboard pointing at a drawer that never opened.
      ui.drawerTitle.set(title.external_id ?? title._id);
      ui.drawerContent.set(true);
      ui.drawerContentType.set('titles');
      ui.drawerButtons.set(buttons);

      this.selectedTitle.set(title);
      this.titleName.set(title.external_id ?? '');
      this.titleNameError.set('');
      this.availableCropModels.set(res.crop_models.map(m => ({ value: m, label: m })));
      this.selectedCropModel.set(title.settings?.crop_model ?? res.crop_models[0]);
      this.selectedCropModelUsed.set(false);
      this.availableRotationModels.set(res.rotation_models.map(m => ({ value: m, label: m })));
      this.selectedRotationModel.set(title.settings?.rotation_model ?? res.rotation_models[0]);
      this.selectedRotationModelUsed.set(false);
      this.selectedAssigneeId.set(title.assigned_to ?? '');
      this.selectedAssigneeUsed.set(false);
      this.titleBaseline.set({
        name: this.titleName(),
        crop: this.selectedCropModel(),
        rotation: this.selectedRotationModel(),
        assignee: this.selectedAssigneeId(),
      });
      this.loadAssignees(title);
      ui.openDrawer();
    });
  }

  onSelectAssigneeUsed(used: boolean): void {
    this.selectedAssigneeUsed.set(used);
  }

  // Loads the group members a title can be assigned to for the drawer select.
  private loadAssignees(title: Title): void {
    const unassigned: SelectOption = { value: '', label: '— Nepřiřazeno —' };
    // Baseline options always include "unassigned" and the current assignee, so
    // the drawer shows who a title is assigned to even if the member list fails.
    const base: SelectOption[] = [unassigned];
    if (title.assigned_to && title.assigned_to_name) {
      base.push({ value: title.assigned_to, label: title.assigned_to_name });
    }
    this.availableAssignees.set(base);

    const groupId = this.selectedGroupPage()?._id;
    if (!groupId || !this.canAssignInCurrentGroup()) return;

    this.fetchAssignableUsers(groupId).subscribe({
      next: users => {
        const options: SelectOption[] = [unassigned, ...users.map(u => ({ value: u._id, label: u.full_name }))];
        // Keep the current assignee selectable even if they're no longer in the list.
        if (title.assigned_to && title.assigned_to_name && !users.some(u => u._id === title.assigned_to)) {
          options.push({ value: title.assigned_to, label: title.assigned_to_name });
        }
        this.availableAssignees.set(options);
      },
      error: err => console.error('Fetching assignable users failed:', err)
    });
  }

  // User
  createUserDialog(): void {
    const ui = this.ui;
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Nový uživatel');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('new-user');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Vytvořit',
        primary: true,
        action: () => {
          if (!this.userFullname()) {
            this.userNameError.set(this.errors['userNameEmpty']);
            const el = document.getElementById('user-fullname') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          const userEmail = this.userEmail();

          if (!userEmail) {
            this.userEmailError.set(this.errors['userEmailEmpty']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (!checkEmailValidity(userEmail)) {
            this.userEmailError.set(this.errors['userEmailInvalid']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (this.users().some(u => u.email === this.userEmail())) {
            this.userEmailError.set(this.errors['userEmailExists']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          const emptyGroups = this.userPermissions().filter(u => !u.permission.length);
          if (emptyGroups.length) {
            this.groupPermissionsError[emptyGroups[0].group_id] = this.errors['groupPermissionsEmpty'];
            const el = document.getElementById(`permissions-row-${emptyGroups[0].group_id}`) as HTMLElement;
            scrollToElement(el);
            return;
          }

          return this.createUser().pipe(
            tap((res: NewUser) => {
              this.newPassword.set(res.password);

              const newUser: User = {
                _id: res.id,
                email: this.userEmail(),
                full_name: this.userFullname(),
                password: res.password,
                role: 'user',
                permissions: this.userPermissions(),
                modified_at: Date()
              };

              this.searchUsers.set('');
              this.users.update(prev => [ ...prev, newUser ]);
              this.displayedUsers.set(this.users());
              this.selectedUser.set(newUser);
              this.userEmail.set('');
              this.userFullname.set('');
              this.userPermissions.set([]);
              this.userNameError.set('');
              this.userEmailError.set('');
              this.openUserDetail(this.selectedUser());
              
              ui.confirmBtnDisabledTimer = 0;
              ui.confirmBtnDisabled.set(true);
              ui.confirmBtnDisabledTimer = window.setTimeout(() => ui.confirmBtnDisabled.set(false), 3000);
              ui.dialogWidth.set(593);
              ui.dialogTitle.set('Nový uživatel');
              ui.dialogContent.set(true);
              ui.dialogContentType.set('new-password');
              ui.dialogButtons.set([{
                label: 'Rozumím',
                primary: true,
                action: () => {
                  if (ui.confirmBtnDisabled()) return;
                    ui.closeDialog();
                  }
              }]);
            }),
            catchError(err => {
              ui.showToast('Nepodařilo se vytvořit uživatele. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe();
        }
      }
    ])

    this.userEmail.set('');
    this.userFullname.set('');
    this.userPermissions.set([]);
    this.userNameError.set('');
    this.userEmailError.set('');

    this.fetchGroups().pipe(
      catchError(err => {
        this.ui.showToast('Nepodařilo se načíst skupiny. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      })
    ).subscribe((res: Group[]) => {
      this.groups.set(res);
      this.availableGroups.set(res.map(g => ({ value: g._id, label: g.name })));
      this.selectedGroupError.set('');
      this.userPermissions.set([]);
      this.groupPermissionsError = {};
      this.closeDrawer();
      ui.openDialog();
    });
  }

  editUserDialog(): void {
    const ui = this.ui;
    
    ui.dialogWidth.set(360);
    ui.dialogTitle.set('Změna údajů');
    ui.dialogContent.set(true);
    ui.dialogContentType.set('edit-user');
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Uložit',
        primary: true,
        action: () => {
          if (!this.userNonmembersDataChanged()) {
            ui.closeDialog();
            return;
          }

          const userFullname = this.userFullname();
          const userEmail = this.userEmail();
          const selectedUser = this.selectedUser();
          
          if (!userFullname) {
            this.userNameError.set(this.errors['userNameEmpty']);
            const el = document.getElementById('user-fullname') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (!userEmail) {
            this.userEmailError.set(this.errors['userEmailEmpty']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (!checkEmailValidity(userEmail)) {
            this.userEmailError.set(this.errors['userEmailInvalid']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (this.users().filter(u => u._id !== selectedUser?._id).some(u => u.email === this.userEmail())) {
            this.userEmailError.set(this.errors['userEmailExists']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          return this.updateUser(selectedUser?._id ?? '').pipe(
            tap((res: User) => {
              // this.searchUsers.set('');
              this.users.update(prev => prev.map(u => u._id === res._id ? res : u));
              this.displayedUsers.set(this.users());
              this.selectedUser.set(res);
              ui.drawerTitle.set(userFullname);
            }),
            catchError(err => {
              this.ui.showToast('Nepodařilo se uložit změny. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe(() => ui.closeDialog());
        }
      }
    ])

    this.userFullname.set(this.userFullname());
    this.userEmail.set(this.userEmail());
    this.userNameError.set('');
    this.userEmailError.set('');
    ui.openDialog();
  }

  deleteUserDialog(): void {
    const ui = this.ui;
    const user = this.selectedUser();
    
    ui.dialogWidth.set(593);
    ui.dialogTitle.set('Smazat uživatele');
    ui.dialogDescription.set(`Opravdu chcete smazat uživatele${' ' + user?.full_name}?`);
    ui.dialogContent.set(false);
    ui.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Smazat uživatele',
        primary: true,
        destructive: true,
        action: () => this.deleteUser(user?._id ?? '').pipe(
          tap(() => {
            const updated = this.users().filter(u => u._id !== user?._id);
            this.users.set(updated);
            this.displayedUsers.set(updated);
            this.selectedUser.set(null);
            ui.closeDialog();
          }),
          catchError(err => {
            this.ui.showToast('Nepodařilo se smazat uživatele. Zkuste to znovu.', { type: 'error' });
            console.error(err);
            return throwError(() => err);
          })
        ).subscribe(() => this.closeDrawer())
      }
    ])

    ui.openDialog();
  }

  resetPasswordDialog(userId: string): void {
    const ui = this.ui;
    
    this.resetPassword(userId).pipe(
      catchError(err => {
        ui.showToast('Při generování nového hesla se něco pokazilo. Zkuste to znovu.', { type: 'error' });
        console.error(err);
        return throwError(() => err);
      })
    ).subscribe((res: NewPassword) => {
      this.newPassword.set(res.new_password);
    
      ui.confirmBtnDisabledTimer = 0;
      ui.confirmBtnDisabled.set(true);
      ui.confirmBtnDisabledTimer = window.setTimeout(() => ui.confirmBtnDisabled.set(false), 3000);
      ui.dialogWidth.set(593);
      ui.dialogTitle.set('Nové heslo');
      ui.dialogContent.set(true);
      ui.dialogContentType.set('edit-password');
      ui.dialogButtons.set([
        {
          label: 'Rozumím',
          primary: true,
          action: () => {
            if (ui.confirmBtnDisabled()) return;
            ui.closeDialog();
          }
        }
      ])

      ui.openDialog();
    });
  }


  // ========== DRAWER ACTIONS ==========
  closeDrawer(): void {
    this.ui.closeDrawer();
    
    defer(() => {
      if (this.ui.drawerOpen()) return;
      this.selectedGroupDetail.set(null);
      this.selectedUser.set(null);
    }, 300);
  }

  // Group
  openGroupDetail(group: Group | null): void {
    const ui = this.ui;
    if (!group) return;
    
    ui.drawerTitle.set(group.name);
    ui.drawerContent.set(true);
    ui.drawerContentType.set('groups');
    
    this.selectedGroupDetail.set(group);
    this.groupName.set(group.name);
    this.groupNameError.set('');
    this.groupDescription.set(group.description);
    this.selectedCropModel.set(group.default_settings.crop_model);

    this.selectedUserId.set('');
    this.groupPermissions.set(group.users);

    this.fetchUsers().pipe(
      catchError(err => {
        this.ui.showToast('Při načítání uživatelů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
        console.error('Fetching users failed:', err);
        return throwError(() => err);
      })
    ).subscribe((res: User[]) => {
      this.users.set(res);
      this.availableUsers.set(res
        .filter(u => !group.users.map(p => p._id).includes(u._id))
        .filter(u => u.role !== 'admin')
        .map(u => ({ value: u._id, label: u.full_name })))
    });
    
    if (this.auth.user()?.role === 'admin') {
      ui.drawerButtons.set([
        {
          label: 'Zavřít',
          action: () => this.closeDrawer()
        },
        {
          label: 'Uložit změny',
          primary: true,
          action: () => {
            const group = this.selectedGroupDetail();
            if (!group) return;

            const requests = [];
            if (this.groupNonmembersDataChanged()) requests.push(this.updateGroup(group._id));
            if (this.membersAdded().length) requests.push(this.bulkAddGroupMembers(group._id));
            if (this.membersUpdated().length) requests.push(this.bulkUpdateGroupMembers(group._id));
            if (this.membersRemoved().length) requests.push(this.bulkRemoveGroupMembers(group._id));
            if (!requests.length) return;

            const emptyUsers = this.groupPermissions().filter(u => !u.permission.length);
            if (emptyUsers.length) {
              this.userPermissionsError[emptyUsers[0]._id] = this.errors['userPermissionsEmpty'];
              const el = document.getElementById(`permissions-row-${emptyUsers[0]._id}`) as HTMLElement;
              scrollToElement(el);
              return;
            }

            return forkJoin(requests).pipe(
              tap(() => {
                this.searchGroups.set('');
                this.groups.update(prev => prev.map(g => g._id === group?._id ? {
                  ...group,
                  users: this.groupPermissions()
                } : g))
                this.displayedGroups.set(this.groups());
                this.selectedGroupDetail.set(null);
              }),
              catchError(err => {
                this.ui.showToast('Nepodařilo se uložit změny. Zkuste to znovu.', { type: 'error' });
                console.error(err);
                return throwError(() => err);
              })
            ).subscribe(() => this.closeDrawer());
          }
        }
      ]);
    }

    ui.openDrawer();
  }

  removeAllUsers(): void {
    this.groupPermissions.set([]);
    // Only regular users are assignable to a group — never admins.
    this.availableUsers.set(this.users().filter(u => u.role !== 'admin').map(u => ({ value: u._id, label: u.full_name })));
  }

  removeFromGroup(userId: string): void {
    this.groupPermissions.update(prev => prev.filter(u => u._id !== userId));
    this.availableUsers.update(prev => 
      this.users()
        .filter(u => prev.map(p => p.value).includes(u._id) || u._id === userId)
        .map(u => ({ value: u._id, label: u.full_name }))
    );
    this.userPermissionsError[userId] = '';
  }

  onSelectUserUsed(used: boolean): void {
    this.selectedUserUsed.set(used);
  }

  addUserToGroup(userId: string): void {
    if (!this.availableUsers().length) return;
    
    if (!this.selectedUserId()) {
      this.selectedUserError.set(this.errors['selectedUserEmpty']);
      return;
    }
    
    this.groupPermissions.update(prev => [
      {
        _id: userId,
        full_name: this.availableUsers().find(u => u.value === userId)?.label ?? '',
        permission: []
      },
      ...prev
    ]);
    this.availableUsers.update(prev => prev.filter(option => option.value !== userId));
    this.selectedUserId.set('');
    this.selectedUserError.set('');
  }

  toggleUserPermission(userId: string, permissionType: PermissionType): void {
    this.groupPermissions.update(prev => prev.map(u => u._id === userId
      ? {
        ...u,
        permission: u.permission.includes(permissionType)
          ? u.permission.filter(p => p !== permissionType)
          : [ ...u.permission, permissionType ]
      }
      : u));
    this.userPermissionsError[userId] = '';
  }

  // User
  openUserDetail(user: User | null): void {
    if (!user) return;
    const ui = this.ui;

    this.selectedUser.set(user);
    this.userNameError.set('');
    this.userEmailError.set('');
    this.selectedGroupError.set('');
    this.groupPermissionsError = {};

    this.selectedGroupId.set('');
    this.userPermissions.set(user.permissions);

    this.fetchGroups().pipe(
      catchError(err => {
        this.ui.showToast('Při načítání skupin se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
        console.error('Fetching groups failed:', err);
        return throwError(() => err);
      })
    ).subscribe((res: Group[]) => {
      this.groups.set(res);
      this.availableGroups.set(res
        .filter(g => !user.permissions.map(p => p.group_id).includes(g._id))
        .map(g => ({ value: g._id, label: g.name })))
    });

    ui.drawerTitle.set(user.full_name);
    ui.drawerContent.set(true);
    ui.drawerContentType.set('users');
    this.userFullname.set(user.full_name);
    this.userEmail.set(user.email);
    
    ui.drawerButtons.set([
      {
        label: 'Zavřít',
        action: () => this.closeDrawer()
      },
      {
        label: 'Uložit změny',
        primary: true,
        action: () => {
          if (!this.userChanged()) return;

          const userName = this.userFullname();
          const userEmail = this.userEmail();

          if (!userName) {
            this.userNameError.set(this.errors['userNameEmpty']);
            const el = document.getElementById('user-fullname') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (!userEmail) {
            this.userEmailError.set(this.errors['userEmailEmpty']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (!checkEmailValidity(this.userEmail())) {
            this.userEmailError.set(this.errors['userEmailInvalid']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          if (this.users().filter(u => u._id !== this.selectedUser()?._id).some(u => u.email === userEmail)) {
            this.userEmailError.set(this.errors['userEmailExists']);
            const el = document.getElementById('user-email') as HTMLElement;
            scrollToAndFocusElement(el);
            return;
          }

          const emptyGroups = this.userPermissions().filter(g => !g.permission.length);
          if (emptyGroups.length) {
            this.groupPermissionsError[emptyGroups[0].group_id] = this.errors['groupPermissionsEmpty'];
            const el = document.getElementById(`permissions-row-${emptyGroups[0].group_id}`) as HTMLElement;
            scrollToElement(el);
            return;
          }

          return this.updateUser(this.selectedUser()?._id ?? '').pipe(
            tap((res: User) => {
              this.searchUsers.set('');
              this.users.update(prev => prev.map(u => u._id === res._id ? res : u));
              this.displayedUsers.set(this.users());
              this.selectedUser.set(null);
            }),
            catchError(err => {
              this.ui.showToast('Nepodařilo se uložit změny. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              return throwError(() => err);
            })
          ).subscribe(() => this.closeDrawer());
        }
      }
    ]);

    ui.openDrawer();
  }

  removeFromAllGroups(): void {
    this.userPermissions.set([]);
    this.availableGroups.set(this.groups().map(g => ({ value: g._id, label: g.name })));
  }

  unassignGroupFromUser(groupId: string): void {
    this.userPermissions.update(prev => prev.filter(p => p.group_id !== groupId));
    this.availableGroups.update(prev => 
      this.groups()
        .filter(g => prev.map(p => p.value).includes(g._id) || g._id === groupId)
        .map(g => ({ value: g._id, label: g.name }))
    );
    this.groupPermissionsError[groupId] = '';
  }

  onSelectGroupUsed(used: boolean): void {
    this.selectedGroupUsed.set(used);
  }

  assignGroupToUser(groupId: string): void {
    if (!this.selectedGroupId()) {
      this.selectedGroupError.set(this.errors['selectedGroupEmpty']);
      return;
    }
    
    this.userPermissions.update(prev => [
      {
        group_id: groupId,
        group_name: this.availableGroups().find(g => g.value === groupId)?.label ?? '',
        permission: []
      },
      ...prev
    ]);
    this.availableGroups.update(prev => prev.filter(option => option.value !== groupId));
    this.selectedGroupId.set('');
    this.selectedGroupError.set('');
  }

  toggleGroupPermission(groupId: string, permissionType: PermissionType): void {
    this.userPermissions.update(prev => prev.map(g => g.group_id === groupId
      ? {
        ...g,
        permission: g.permission.includes(permissionType)
          ? g.permission.filter(p => p !== permissionType)
          : [ ...g.permission, permissionType ]
      }
      : g));
    this.groupPermissionsError[groupId] = '';
  }


  // ========== INPUT INLINE VALIDATION ==========
  // Group
  checkGroupNameUniqueness(): void {
    this.groupNameError.set(this.groups()
      .filter(g => g._id !== this.selectedGroupDetail()?._id)
      .some(g => g.name === this.groupName())
        ? this.errors['groupNameExists']
        : ''
    );
  }

  // Title
  checkTitleName(): void {
    this.titleNameError.set('');
  }

  // User
  checkUserName(): void {
    this.userNameError.set('');
  }

  checkUserEmail(): void {
    this.checkUserEmailValidity();
    this.checkUserEmailUniqueness();
  }

  private checkUserEmailValidity(): void {
    this.userEmailError.set(checkEmailValidity(this.userEmail())
      ? this.errors['userEmailInvalid']
      : ''
    );
  }

  private checkUserEmailUniqueness(): void {
    this.userEmailError.set(
      this.users()
        .filter(u => u._id !== this.selectedUser()?._id)
        .some(u => u.email === this.userEmail())
          ? this.errors['userEmailExists']
          : ''
    );
  }


  // ========== KEYBOARD SHORTCUTS ==========
  private isHandledKey(key: string): boolean {
    return [
      '+', 'ě', 'Ě', '1', '2',                              // Open groups or users
      'Escape',                                             // Close dialog or drawer
      'p', 'P',                                             // Add group, title or user
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',    // Prev/next table row detail
    ].includes(key);
  }

  onKeyDown(event: KeyboardEvent): void {
    const key = event.key;
    if (!this.isHandledKey(key)) return;
    const dialogOpen = this.ui.dialogOpen();
    const drawerOpen = this.ui.drawerOpen();
    const dashboardPage = this.dashboardPage();

    const el = (event.target as HTMLElement);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (key !== 'Escape') return;
      focusMainWrapper();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Open groups or users
    if ((key === '+' || key === 'ě' || key === 'Ě' || key === '1' || key === '2') && !dialogOpen) {
      const isGroupKey = key === '+' || key === '1';
      const page = isGroupKey ? 'groups' : 'users';
      this.dashboardPage.set(page);
      this.router.navigate([`/${page}`]);
      focusMainWrapper();
    }

    // Close dialog or drawer
    if (key === 'Escape') {
      if (dialogOpen) {
        this.selectedTitle.set(null);
        this.ui.closeDialog();
        return;
      }

      if (drawerOpen) {
        this.closeDrawer();
        return;
      }
    }

    // Add group, title or user
    if (['p', 'P'].includes(key) && !dialogOpen) {
      switch (dashboardPage) {
        case 'groups':
          this.createGroupDialog();
          break;
        case 'titles':
          this.createTitleDialog();
          break;
        case 'users':
          this.createUserDialog();
          break;
      }
    }

    // Prev/next table row detail
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && drawerOpen && !dialogOpen) {
      let table: WritableSignal<any[]>;
      let selectedItem: WritableSignal<any>;

      switch (dashboardPage) {
        case 'groups':
          table = this.displayedGroups;
          selectedItem = this.selectedGroupDetail;
          break;
        case 'titles':
          table = this.displayedTitles;
          selectedItem = this.selectedTitle;
          break;
        case 'users':
          table = this.displayedUsers;
          selectedItem = this.selectedUser;
          break;
      }      

      if (table().length <= 1) return;

      const selectedIndex = table().findIndex(row => row._id === selectedItem()?._id)
      const prevKeys = new Set(['ArrowLeft', 'ArrowUp']);
      selectedItem.set(table()[prevKeys.has(key)
        ? (selectedIndex > 0 ? selectedIndex - 1 : 0)
        : (selectedIndex < table().length - 1 ? selectedIndex + 1 : selectedIndex)]);
    }
  }
}
