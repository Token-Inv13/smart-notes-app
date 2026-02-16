export type AdminLookupUserResult = {
  uid: string;
  email: string | null;
  authCreatedAtMs: number | null;
  userDocCreatedAtMs: number | null;
  lastLoginAtMs: number | null;
  lastSeenAtMs: number | null;
  plan: 'free' | 'pro';
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
