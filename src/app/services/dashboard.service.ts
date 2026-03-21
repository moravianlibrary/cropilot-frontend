import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal, WritableSignal } from '@angular/core';
import { catchError, forkJoin, from, map, mergeMap, Observable, of, switchMap, tap, toArray } from 'rxjs';
import { AuthService } from './auth.service';
import { ChangedGroupMember, DashboardPage, Group, GroupPage, Models, NewGroup, NewPassword, NewUser, Permission, PermissionType, SelectOption, Title, User, UserInGroup } from '../app.types';
import { Router } from '@angular/router';
import { checkEmailValidity, defer, focusMainWrapper, scrollToAndFocusElement, scrollToElement } from '../utils/utils';
import { inlineErrors } from '../app.config';
import { UiService } from './ui.service';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private http = inject(HttpClient);
  private authSvc = inject(AuthService);
  private uiSvc = inject(UiService);
  private router = inject(Router);

  dashboardPage = signal<DashboardPage>('groups');
  errors = inlineErrors;

  // Groups
  groups = signal<Group[]>([]);
  displayedGroups = signal<Group[]>([]);
  searchGroups = signal<string>('');
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
    const modelChanged = group.default_model !== this.selectedModel();

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
  selectedTitle = signal<Title | null>(null);
  titleName = signal<string>('');
  titleNameError = signal<string>('');
  availableModels = signal<SelectOption[]>([]);
  selectedModel = signal<string>('');
  selectedModelUsed = signal<boolean>(false);
  files = signal<File[]>([]);
  uploadFilesError = signal<string>('');

  // Users
  users = signal<User[]>([]);
  displayedUsers = signal<User[]>([]);
  searchUsers = signal<string>('');
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


  /* ------------------------------
    API
  ------------------------------ */
  // Groups
  fetchGroups(): Observable<Group[]> {
    return this.http.get<Group[]>(`${this.authSvc.apiUrl}/groups`, { headers: this.authSvc.authHeaders() });
  }

  createGroup(): Observable<NewGroup> {
    const payload = {
      name: this.groupName(),
      description: this.groupDescription(),
      default_model: this.selectedModel()
    };
    return this.http.post<NewGroup>(`${this.authSvc.apiUrl}/groups`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  deleteGroup(groupId: string): Observable<void> {
    return this.http.delete<void>(`${this.authSvc.apiUrl}/groups/${groupId}`, { headers: this.authSvc.authHeaders() });
  }

  updateGroup(groupId: string): Observable<void> {
    const payload = {
      name: this.groupName(),
      description: this.groupDescription(),
      default_model: this.selectedModel()
    };

    return this.http.patch<void>(`${this.authSvc.apiUrl}/groups/${groupId}`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  bulkAddGroupMembers(groupId: string): Observable<void> {
    const payload = this.membersAdded();
    return this.http.post<void>(`${this.authSvc.apiUrl}/groups/${groupId}/members`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  bulkUpdateGroupMembers(groupId: string): Observable<void> {
    const payload = this.membersUpdated();
    return this.http.patch<void>(`${this.authSvc.apiUrl}/groups/${groupId}/members`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  bulkRemoveGroupMembers(groupId: string): Observable<void> {
    const payload = this.membersRemoved();
    return this.http.delete<void>(`${this.authSvc.apiUrl}/groups/${groupId}/members`, {
      headers: this.authSvc.authHeaders('json', true),
      body: payload
    });
  }

  // Titles
  fetchTitles(groupId: string): Observable<GroupPage> {
    return this.http.get<GroupPage>(`${this.authSvc.apiUrl}/groups/${groupId}`, { headers: this.authSvc.authHeaders() });
  }

  fetchModels(): Observable<Models> {
    return this.http.get<Models>(`${this.authSvc.apiUrl}/models`, { headers: this.authSvc.authHeaders() });
  }

  createTitle(groupId: string): Observable<{ id: string }> {
    const payload = {
      external_id: this.titleName(),
      model: this.selectedModel()
    };
    return this.http.post<{ id: string }>(`${this.authSvc.apiUrl}/create?group_id=${groupId}`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  uploadScan(titleId: string, file: File): Observable<void> {
    const form = new FormData();
    form.append('scan_data', file, file.name);
    return this.http.post<void>(`${this.authSvc.apiUrl}/${titleId}/upload-scan`, form, { headers: this.authSvc.authHeaders() });
  }

  uploadAllScans(titleId: string, files: File[], concurrency: number = 5): Observable<string> {
    return from(files).pipe(
      mergeMap(file => this.uploadScan(titleId, file), concurrency),
      toArray(), // collects all emitted values, and emits one single array
      map(() => titleId)
    );
  }

  processTitle(titleId: string): Observable<void> {
    return this.http.post<void>(`${this.authSvc.apiUrl}/${titleId}/process`, {}, { headers: this.authSvc.authHeaders() });
  }

  deleteTitle(titleId: string): Observable<void> {
    return this.http.delete<void>(`${this.authSvc.apiUrl}/${titleId}`, { headers: this.authSvc.authHeaders() });
  }

  // Users
  fetchUsers(groupId?: string): Observable<User[]> {
    return this.http.get<User[]>(`${this.authSvc.apiUrl}/users${groupId ? `?group_id=${groupId}` : ''}`, { headers: this.authSvc.authHeaders() });
  }

  createUser(): Observable<NewUser> {
    const permissions = this.userPermissions();
    const payload = {
      email: this.userEmail(),
      full_name: this.userFullname(),
      ...(permissions && { permissions: permissions })
    };

    return this.http.post<NewUser>(`${this.authSvc.apiUrl}/users/register`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  deleteUser(userId: string): Observable<void> {
    return this.http.delete<void>(`${this.authSvc.apiUrl}/users/${userId}`, { headers: this.authSvc.authHeaders() });
  }

  updateUser(userId: string): Observable<User> {
    const payload = {
      full_name: this.userFullname(),
      email: this.userEmail(),
      permissions: this.userPermissions()
    };

    return this.http.patch<User>(`${this.authSvc.apiUrl}/users/${userId}`, payload, { headers: this.authSvc.authHeaders('json', true) });
  }

  resetPassword(userId: string): Observable<NewPassword> {
    return this.http.patch<NewPassword>(`${this.authSvc.apiUrl}/users/${userId}/reset-password`, {}, { headers: this.authSvc.authHeaders() });
  }


  /* ------------------------------
    DASHBOARD PAGES
  ------------------------------ */
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
    window.location.href = `${this.authSvc.baseUri}/book/${bookId}`;
  }

  navigateToUsers(): void {
    this.closeDrawer();
    this.dashboardPage.set('users');
    this.router.navigate(['/users']);
  }


  /* ------------------------------
    DIALOGS
  ------------------------------ */
  // Group
  createGroupDialog(): void {
    const uiSvc = this.uiSvc;
    
    uiSvc.dialogWidth.set(593);
    uiSvc.dialogTitle.set('Nová skupina');
    uiSvc.dialogContent.set(true);
    uiSvc.dialogContentType.set('new-group');
    uiSvc.dialogButtons.set([
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

          uiSvc.closeDialog();
          
          return this.createGroup().pipe(
            switchMap((res: NewGroup) => this.membersAdded().length
              ? this.bulkAddGroupMembers(res.id).pipe(map(() => res))
              : of(res)
            ),
            tap((res: NewGroup) => {
              const now = Date();
              const user = this.authSvc.user();
              const permissions = ['read_group', 'read_title', 'write', 'upload'] as PermissionType[];
              const newGroup = {
                _id: res.id,
                name: groupName,
                api_key: {
                  key: res?.api_key ?? '',
                  created_at: now  
                },
                description: this.groupDescription(),
                default_model: this.selectedModel(),
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
              this.uiSvc.showToast('Při vytváření skupiny se něco pokazilo. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              throw err;
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
        this.availableModels.set(res.available_models.map(m => ({ value: m, label: m })));
        this.selectedModel.set(res.available_models[0]);
        this.selectedModelUsed.set(false);
      }),
      switchMap(() => this.fetchUsers()),
      catchError(err => {
        this.uiSvc.showToast('Nepodařilo se načíst uživatele. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        throw err;
      })
    ).subscribe((res: User[]) => {
      this.users.set(res);
      this.availableUsers.set(res.filter(u => u.role !== 'admin').map(u => ({ value: u._id, label: u.full_name })));
      this.selectedUserError.set('');
      this.groupPermissions.set([]);
      this.userPermissionsError = {};
      this.closeDrawer();
      uiSvc.openDialog();
    });
  }

  editGroupDialog(): void {
    const uiSvc = this.uiSvc;
    const group = this.selectedGroupDetail();
    if (!group) return;
    
    uiSvc.dialogWidth.set(360);
    uiSvc.dialogTitle.set('Úprava skupiny');
    uiSvc.dialogContent.set(true);
    uiSvc.dialogContentType.set('edit-group');
    uiSvc.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Upravit',
        primary: true,
        action: () => {
          if (!this.groupNonmembersDataChanged()) {
            uiSvc.closeDialog();
            return;
          }

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

          uiSvc.closeDialog();
          
          return this.updateGroup(group._id).pipe(
            catchError(err => {
              this.uiSvc.showToast('Nepodařilo se upravit skupinu. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              throw err;
            })
          ).subscribe(() => {
            // this.searchGroups.set('');
            const updatedGroup = {
              ...group,
              name: this.groupName(),
              description: this.groupDescription(),
              default_model: this.selectedModel()
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
        this.uiSvc.showToast('Nepodařilo se načíst dostupné AI modely. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        throw err;
      })
    ).subscribe((res: Models) => {
      this.availableModels.set(res.available_models.map(m => ({ value: m, label: m })));
      this.selectedModel.set(group.default_model);
      this.selectedModelUsed.set(false);
      uiSvc.openDialog();
    });
  }

  deleteGroupDialog(): void {
    const uiSvc = this.uiSvc;
    const group = this.selectedGroupDetail();
    
    uiSvc.dialogWidth.set(593);
    uiSvc.dialogTitle.set('Smazat skupinu');
    uiSvc.dialogDescription.set(`Opravdu chcete smazat skupinu${' ' + group?.name}?`);
    uiSvc.dialogContent.set(false);
    uiSvc.dialogButtons.set([
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
            uiSvc.closeDialog();
          }),
          catchError(err => {
            this.uiSvc.showToast('Při mazání skupiny se něco pokazilo. Zkuste to znovu.', { type: 'error' });
            console.error(err);
            throw err;
          })
        ).subscribe(() => this.closeDrawer())
      }
    ])

    uiSvc.openDialog();
  }

  // Title
  createTitleDialog(): void {
    const uiSvc = this.uiSvc;
    this.files.set([]);
    
    uiSvc.dialogWidth.set(593);
    uiSvc.dialogTitle.set('Nový titul');
    uiSvc.dialogContent.set(true);
    uiSvc.dialogContentType.set('new-title');
    uiSvc.dialogButtons.set([
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

          uiSvc.closeDialog();
          
          return this.createTitle(this.selectedGroupPage()?._id ?? '').pipe(
            map(res => {
              const now = Date();
              const newTitle: Title = {
                _id: res.id,
                external_id: titleName,
                model: this.selectedModel(),
                created_at: now,
                modified_at: now,
                state: 'scheduled'
              };

              this.searchTitles.set('');
              this.titles.update(prev => [ newTitle, ...prev ]);
              this.displayedTitles.set(this.titles());

              return res.id;
            }),
            switchMap(id => this.uploadAllScans(id, this.files())),
            switchMap(id => this.processTitle(id)),
            catchError(err => {
              this.uiSvc.showToast(`Při nahrávání skenů se něco pokazilo. Titul smažte a přidejte ji jako novou.`, { type: 'error' });
              console.error(err);
              throw err;
            })
          ).subscribe();
        }
      }
    ]);

    this.fetchModels().pipe(
      catchError(err => {
        this.uiSvc.showToast('Nepodařilo se načíst dostupné AI modely. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        throw err;
      })
    ).subscribe((res: Models) => {
      this.titleName.set('');
      this.titleNameError.set('');
      this.uploadFilesError.set('');
      this.availableModels.set(res.available_models.map(m => ({ value: m, label: m })));
      this.selectedModel.set(this.selectedGroupPage()?.default_model ?? res.available_models[0]);
      this.selectedModelUsed.set(false);
      this.closeDrawer();
      uiSvc.openDialog();
    });
  }

  onSelectModelUsed(used: boolean): void {
    this.selectedModelUsed.set(used);
  }

  uploadFiles(files: FileList) {
    this.files.update(prev => [ ...prev, ...Array.from(files) ]);
  }

  deleteTitleDialog(title: Title): void {
    const uiSvc = this.uiSvc;
    
    uiSvc.dialogWidth.set(593);
    uiSvc.dialogTitle.set('Smazat titul');
    uiSvc.dialogDescription.set(`Opravdu chcete smazat titul${' ' + title?.external_id}?`);
    uiSvc.dialogContent.set(false);
    uiSvc.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Smazat titul',
        primary: true,
        destructive: true,
        action: () => this.deleteTitle(title?._id ?? '').pipe(
          tap(() => {
            this.titles.update(prev => prev.filter(t => t._id !== (title?._id ?? '')));
            this.displayedTitles.set(this.titles());
            uiSvc.closeDialog();
          }),
          catchError(err => {
            this.uiSvc.showToast('Nepodařilo se smazat titul. Zkuste to znovu.', { type: 'error' })
            console.error(err);
            throw err;
          })
        ).subscribe(() => this.closeDrawer())
      }
    ])

    uiSvc.openDialog();
  }

  // User
  createUserDialog(): void {
    const uiSvc = this.uiSvc;
    
    uiSvc.dialogWidth.set(593);
    uiSvc.dialogTitle.set('Nový uživatel');
    uiSvc.dialogContent.set(true);
    uiSvc.dialogContentType.set('new-user');
    uiSvc.dialogButtons.set([
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
              
              uiSvc.confirmBtnDisabledTimer = 0;
              uiSvc.confirmBtnDisabled.set(true);
              uiSvc.confirmBtnDisabledTimer = window.setTimeout(() => uiSvc.confirmBtnDisabled.set(false), 3000);
              uiSvc.dialogWidth.set(593);
              uiSvc.dialogTitle.set('Nový uživatel');
              uiSvc.dialogContent.set(true);
              uiSvc.dialogContentType.set('new-password');
              uiSvc.dialogButtons.set([{
                label: 'Rozumím',
                primary: true,
                action: () => {
                  if (uiSvc.confirmBtnDisabled()) return;
                    uiSvc.closeDialog();
                  }
              }]);
            }),
            catchError(err => {
              uiSvc.showToast('Nepodařilo se vytvořit uživatele. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              throw err;
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
        this.uiSvc.showToast('Nepodařilo se načíst skupiny. Zkuste dialogové okno znovu otevřít.', { type: 'error' });
        console.error(err);
        throw err;
      })
    ).subscribe((res: Group[]) => {
      this.groups.set(res);
      this.availableGroups.set(res.map(g => ({ value: g._id, label: g.name })));
      this.selectedGroupError.set('');
      this.userPermissions.set([]);
      this.groupPermissionsError = {};
      this.closeDrawer();
      uiSvc.openDialog();
    });
  }

  editUserDialog(): void {
    const uiSvc = this.uiSvc;
    
    uiSvc.dialogWidth.set(360);
    uiSvc.dialogTitle.set('Změna údajů');
    uiSvc.dialogContent.set(true);
    uiSvc.dialogContentType.set('edit-user');
    uiSvc.dialogButtons.set([
      { label: 'Zrušit' },
      {
        label: 'Uložit',
        primary: true,
        action: () => {
          if (!this.userNonmembersDataChanged()) {
            uiSvc.closeDialog();
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
              uiSvc.drawerTitle.set(userFullname);
            }),
            catchError(err => {
              this.uiSvc.showToast('Nepodařilo se uložit změny. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              throw err;
            })
          ).subscribe(() => uiSvc.closeDialog());
        }
      }
    ])

    this.userFullname.set(this.userFullname());
    this.userEmail.set(this.userEmail());
    this.userNameError.set('');
    this.userEmailError.set('');
    uiSvc.openDialog();
  }

  deleteUserDialog(): void {
    const uiSvc = this.uiSvc;
    const user = this.selectedUser();
    
    uiSvc.dialogWidth.set(593);
    uiSvc.dialogTitle.set('Smazat uživatele');
    uiSvc.dialogDescription.set(`Opravdu chcete smazat uživatele${' ' + user?.full_name}?`);
    uiSvc.dialogContent.set(false);
    uiSvc.dialogButtons.set([
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
            uiSvc.closeDialog();
          }),
          catchError(err => {
            this.uiSvc.showToast('Nepodařilo se smazat uživatele. Zkuste to znovu.', { type: 'error' });
            console.error(err);
            throw err;
          })
        ).subscribe(() => this.closeDrawer())
      }
    ])

    uiSvc.openDialog();
  }

  resetPasswordDialog(userId: string): void {
    const uiSvc = this.uiSvc;
    
    this.resetPassword(userId).pipe(
      catchError(err => {
        uiSvc.showToast('Při generování nového hesla se něco pokazilo. Zkuste to znovu.', { type: 'error' });
        console.error(err);
        throw err;
      })
    ).subscribe((res: NewPassword) => {
      this.newPassword.set(res.new_password);
    
      uiSvc.confirmBtnDisabledTimer = 0;
      uiSvc.confirmBtnDisabled.set(true);
      uiSvc.confirmBtnDisabledTimer = window.setTimeout(() => uiSvc.confirmBtnDisabled.set(false), 3000);
      uiSvc.dialogWidth.set(593);
      uiSvc.dialogTitle.set('Nové heslo');
      uiSvc.dialogContent.set(true);
      uiSvc.dialogContentType.set('edit-password');
      uiSvc.dialogButtons.set([
        {
          label: 'Rozumím',
          primary: true,
          action: () => {
            if (uiSvc.confirmBtnDisabled()) return;
            uiSvc.closeDialog();
          }
        }
      ])

      uiSvc.openDialog();
    });
  }


  /* ------------------------------
    DRAWER ACTIONS
  ------------------------------ */
  closeDrawer(): void {
    this.uiSvc.closeDrawer();
    
    defer(() => {
      if (this.uiSvc.drawerOpen()) return;
      this.selectedGroupDetail.set(null);
      this.selectedTitle.set(null);
      this.selectedUser.set(null);
    }, 300);
  }

  // Group
  openGroupDetail(group: Group | null): void {
    const uiSvc = this.uiSvc;
    if (!group) return;
    
    uiSvc.drawerTitle.set(group.name);
    uiSvc.drawerContent.set(true);
    uiSvc.drawerContentType.set('groups');
    
    this.selectedGroupDetail.set(group);
    this.groupName.set(group.name);
    this.groupNameError.set('');
    this.groupDescription.set(group.description);
    this.selectedModel.set(group.default_model);

    this.selectedUserId.set('');
    this.groupPermissions.set(group.users);

    this.fetchUsers().pipe(
      catchError(err => {
        this.uiSvc.showToast('Při načítání uživatelů se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
        console.error('Fetching users failed:', err);
        throw err;
      })
    ).subscribe((res: User[]) => {
      this.users.set(res);
      this.availableUsers.set(res
        .filter(u => !group.users.map(p => p._id).includes(u._id))
        .filter(u => u.role !== 'admin')
        .map(u => ({ value: u._id, label: u.full_name })))
    });
    
    if (this.authSvc.user()?.role === 'admin') {
      uiSvc.drawerButtons.set([
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
                this.uiSvc.showToast('Nepodařilo se uložit změny. Zkuste to znovu.', { type: 'error' });
                console.error(err);
                throw err;
              })
            ).subscribe(() => this.closeDrawer());
          }
        }
      ]);
    }

    uiSvc.openDrawer();
  }

  removeAllUsers(): void {
    this.groupPermissions.set([]);
    this.availableUsers.set(this.users().map(u => ({ value: u._id, label: u.full_name })));
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

  // Title
  openTitleDetail(title: Title | null): void {
    if (!title) return;
    const uiSvc = this.uiSvc;
    
    this.selectedTitle.set(title);
    this.files.set([]);
    uiSvc.drawerTitle.set(title?.external_id ?? 'Bez názvu');
    uiSvc.drawerContent.set(true);
    uiSvc.drawerContentType.set('titles');
    uiSvc.drawerButtons.set([]);

    uiSvc.openDrawer();
  }

  applyAiModel(title: Title | null): void {
    this.processTitle(title?._id ?? '').pipe(
      catchError(err => {
        this.uiSvc.showToast('Něco se pokazilo při aplikaci AI modelu. Zkuste to znovu.', { type: 'error' })
        console.error(err);
        throw err;
      })
    ).subscribe(() => {
      const selectedTitle = this.selectedTitle();
      if (!selectedTitle) return;

      const updatedTitle: Title = {
        ...selectedTitle,
        state: 'ready'
      };
      this.titles.update( prev => prev.map(t => t._id === selectedTitle?._id ? updatedTitle : t));
      this.displayedTitles.set(this.titles());
      this.selectedTitle.set(updatedTitle);
      this.uiSvc.showToast(`AI model byl úspěšně aplikován na titul ${selectedTitle.external_id}!`, { type: 'success' });
    });
  }

  // User
  openUserDetail(user: User | null): void {
    if (!user) return;
    const uiSvc = this.uiSvc;

    this.selectedUser.set(user);
    this.userNameError.set('');
    this.userEmailError.set('');
    this.selectedGroupError.set('');
    this.groupPermissionsError = {};

    this.selectedGroupId.set('');
    this.userPermissions.set(user.permissions);

    this.fetchGroups().pipe(
      catchError(err => {
        this.uiSvc.showToast('Při načítání skupin se něco pokazilo. Zkuste stránku znovu načíst.', { type: 'error' });
        console.error('Fetching groups failed:', err);
        throw err;
      })
    ).subscribe((res: Group[]) => {
      this.groups.set(res);
      this.availableGroups.set(res
        .filter(g => !user.permissions.map(p => p.group_id).includes(g._id))
        .map(g => ({ value: g._id, label: g.name })))
    });

    uiSvc.drawerTitle.set(user.full_name);
    uiSvc.drawerContent.set(true);
    uiSvc.drawerContentType.set('users');
    this.userFullname.set(user.full_name);
    this.userEmail.set(user.email);
    
    uiSvc.drawerButtons.set([
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
              this.uiSvc.showToast('Nepodařilo se uložit změny. Zkuste to znovu.', { type: 'error' });
              console.error(err);
              throw err;
            })
          ).subscribe(() => this.closeDrawer());
        }
      }
    ]);

    uiSvc.openDrawer();
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


  /* ------------------------------
    INPUT INLINE VALIDATION
  ------------------------------ */
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


  /* ------------------------------
    KEYBOARD SHORTCUTS
  ------------------------------ */
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
    const dialogOpen = this.uiSvc.dialogOpen();
    const drawerOpen = this.uiSvc.drawerOpen();
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
        this.uiSvc.closeDialog();
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
