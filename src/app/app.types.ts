// ========== DASHBOARD ==========
export type DashboardPage = 'groups' | 'titles' | 'users';
export type PermissionType = 'read_group' | 'read_title' | 'write' | 'upload';

export interface Models {
  crop_models: string[];
  rotation_models: string[];
}

export interface Group {
  _id: string;
  name: string;
  api_key?: ApiKey;
  description: string;
  default_settings: {
    crop_model: string;
    rotation_model: string;
  };
  created_at: string;
  modified_at: string;
  title_count: number;
  permissions: PermissionType[];
  users: UserInGroup[];
}

export interface GroupPage {
  _id: string;
  name: string;
  description: string;
  default_settings: {
    crop_model: string;
    rotation_model: string;
  };
  created_at: string;
  modified_at: string;
  titles: Title[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  // Only returned on the first page; null on subsequent pages (options don't change).
  filter_options: {
    crop_models: string[];
    rotation_models: string[];
  } | null;
}

// Generic paginated response envelope returned by list endpoints.
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Shared pagination/search/sort query for the groups & users list endpoints.
export interface PagedQuery {
  page?: number;
  page_size?: number;
  search?: string;
  sort_field?: Exclude<SortField, null>;
  sort_direction?: Exclude<SortDirection, null>;
  group_id?: string;
}

export interface TitlesQuery {
  page?: number;
  page_size?: number;
  search?: string;
  sort_field?: Exclude<SortField, null>;
  sort_direction?: Exclude<SortDirection, null>;
  state?: string;
  crop_model?: string;
  rotation_model?: string;
}

export interface NewGroup {
  id: string;
  api_key?: string;
}

export interface ApiKey {
  key: string;
  created_at: string;
}

export interface Title {
  _id: string;
  external_id?: string;
  settings?: {
    crop_model: string;
    rotation_model: string;
  };
  created_at: string;
  modified_at: string;
  state: TitleState;
}

export interface TitleDetail {
  _id: string;
  external_id?: string;
  crop_method: string;
  created_at: string;
  modified_at: string;
  modified_by: string;
  state: TitleState;
  scans: ImageItem[];
}

export interface Permission {
  group_id: string;
  group_name: string;
  permission: PermissionType[];
  created_at?: string;
}

export interface User {
  _id: string;
  email: string;
  full_name: string;
  password?: string;
  role: Role;
  permissions: Permission[];
  modified_at?: string;
}

export interface UserInGroup {
  _id: string;
  full_name: string;
  permission: PermissionType[];
}

export interface ChangedGroupMember {
  user_id: string;
  full_name?: string;
  user_permissions: PermissionType[];
}

export interface NewUser {
  id: string;
  password: string;
}

export interface NewPassword {
  detail?: string;
  new_password: string;
}

export interface Position {
  x: number;
  y: number;
}

// Sort
export type SortField = 'created_at' | 'modified_at' | 'external_id' | null;
export type SortDirection = 'asc' | 'desc' | null;
export interface SortState {
  field: SortField;
  direction: SortDirection;
}



// ========== EDITOR ==========
export interface Page {
  _id: string;
  xc: number;
  yc: number;
  width: number;
  height: number;
  angle: number;
  flags: string[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  edited: boolean;
}

export interface ImageItem {
  _id: string;
  scan_name?: string;
  url?: string;
  thumbnailUrl?: string;
  orientation?: ImageOrientation;
  edited: boolean;
  flags: string[];
  pages: Page[];
}

export interface UpdatePagePayload {
  xc: number;
  yc: number;
  width: number;
  height: number;
  angle: number;
}

export type UpdateImagePayload = Omit<ImageItem, 'pages'> & {
  orientation: ImageOrientation;
  pages: UpdatePagePayload[];
};

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageOrientation = 0 | 90 | 180 | 270;
export type RotationScope = 'current' | 'all';
export type ScanType = 'all' | 'flagged' | 'edited' | 'ok';
export type PageNumberType = 'all' | 'single' | 'double';
export type InputType = 'left' | 'top' | 'width' | 'height' | 'angle';
export type Role = 'admin' | 'user';
export type GridMode = 'always' | 'never' | 'when-rotating';
export type GridDensityLabel = 'Řídká' | 'Běžná' | 'Hustá' | 'Velmi hustá';
export type GridColorLabel = 'Modrá' | 'Azurová' | 'Žlutá' | 'Červená';
export type GridLineWidthLabel = 'Tenká' | 'Střední' | 'Silná' | 'Výrazná';
export type OutlineWidthLabel = 'Silný' | 'Střední' | 'Tenký' | 'Žádný';
export type DimColor = 'Černá' | 'Červená' | 'Bílá' | 'Žádná';
export type TitleState = 'new' | 'scheduled' | 'in_progress' | 'failed' | 'ready' | 'user_approved' | 'retrain' | 'completed';

// Cursors
export type MousePos = { x: number, y: number };
export type HitArea = 'none' | 'inside' | 'edge' | 'corner' | 'rotate';
export type EdgeLocalOrientation = 'vertical' | 'horizontal';
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';
export type CornerName = 'nw' | 'ne' | 'se' | 'sw';
export interface HitInfo {
  area: HitArea;
  page?: Page;
  edgeOrientation?: EdgeLocalOrientation;
  edgeSide?: EdgeSide;
  corner?: CornerName;
}

// Zoom
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}



// ========== UI ==========

// Drawer
export type DrawerContentType = 'groups' | 'titles' | 'users';
export interface DrawerButton {
  label: string;
  primary?: boolean;
  destructive?: boolean;
  action?: () => void;
}

// Dialog
export type DialogContentType = 'settings' | 'shortcuts' |
  'new-group' | 'new-title' | 'new-user' | 'new-password' |
  'edit-group' | 'edit-title' | 'edit-user' | 'edit-password';
export interface DialogButton {
  label: string;
  primary?: boolean;
  destructive?: boolean;
  action?: () => void;
}

// Toast messages
export type ToastType = 'info' | 'success' | 'error';
export interface Toast {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
}

// Select
export interface SelectOption {
  value: number | string;
  label: string;
};



// ========== GEOMETRY UTILS ==========
export type PageRectPx = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

export type HitTestOptions = {
  edgeHitTolerance: number;
  cornerHitTolerance: number;
  rotateHandleOffset: number;
  rotateHitTolerance: number;
  cornerSize: number;
};

export type LocalSide = EdgeSide;

export type ResizeOrientation = {
  signX: 1 | -1;
  signY: 1 | -1;
  baseAngle: number;
};
