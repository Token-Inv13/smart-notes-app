export type AdminLookupUserResult = {
  uid: string;
  email: string | null;
  authCreatedAtMs: number | null;
  userDocCreatedAtMs: number | null;
  lastLoginAtMs: number | null;
  lastSeenAtMs: number | null;
  plan: 'free' | 'pro';
  status: 'active' | 'blocked';
  premiumUntilMs: number | null;
  lastErrorAtMs: number | null;
  stripeSubscriptionStatus: string | null;
  counts: {
    notes: number;
    tasks: number;
    todos: number;
    favorites: number;
  };
};

export type AdminActionResponse = {
  ok: boolean;
  message: string;
  expiresAtMs?: number;
};

export type AdminCursor = {
  createdAtMs: number;
  id: string;
};

export type AdminAuditLogItem = {
  id: string;
  adminUid: string | null;
  targetUserUid: string | null;
  action: string;
  status: string;
  message: string;
  createdAtMs: number | null;
  payload: Record<string, unknown>;
};

export type AdminErrorLogItem = {
  id: string;
  category: string;
  scope: string;
  code: string;
  message: string;
  createdAtMs: number | null;
  context: Record<string, unknown>;
};

export type AdminUsersSortBy = 'createdAt' | 'lastSeenAt' | 'premiumUntil';

export type AdminUserIndexItem = {
  uid: string;
  email: string | null;
  createdAtMs: number | null;
  lastSeenAtMs: number | null;
  plan: 'free' | 'premium';
  premiumUntilMs: number | null;
  status: 'active' | 'blocked';
  tags: string[];
  notesCount?: number;
  tasksCount?: number;
  favoritesCount?: number;
  lastErrorAtMs?: number | null;
};

export type AdminUsersCursor = {
  sortValueMs: number;
  id: string;
};

export type AdminListUsersIndexParams = {
  limit?: number;
  cursor?: AdminUsersCursor | null;
  sortBy?: AdminUsersSortBy;
  query?: string;
  searchMode?: 'auto' | 'uid' | 'email_exact' | 'email_prefix';
  premiumOnly?: boolean;
  blockedOnly?: boolean;
  newWithinHours?: number;
  inactiveDays?: number;
  tags?: string[];
};

export type AdminListUsersIndexResponse = {
  users: AdminUserIndexItem[];
  nextCursor: AdminUsersCursor | null;
};

export type AdminRebuildUsersIndexResponse = {
  ok: boolean;
  processed: number;
  nextCursorUid: string | null;
  done: boolean;
  message: string;
};

export type AdminUserActivityEvent = {
  id: string;
  uid: string;
  type: string;
  createdAtMs: number | null;
  metadata: Record<string, unknown>;
};
