import "server-only";
import { PostgresWorkspaceStore, type WorkspaceMembershipRecord } from "@automation/storage-postgres";
import { createClient } from "@/lib/supabase/server";
import { getDatabase } from "@/lib/server/database";

export interface AuthenticatedUser {
  userId: string;
}

export interface WorkspaceContext extends AuthenticatedUser {
  membership: WorkspaceMembershipRecord;
}

const DEFAULT_LOCAL_TEST_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const localUserId = localTestUserId();
  if (localUserId) return { userId: localUserId };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (error || !userId) throw new Error("UNAUTHENTICATED");
  return { userId };
}

export async function requireWorkspaceContext(workspaceId?: string): Promise<WorkspaceContext> {
  const { userId } = await requireAuthenticatedUser();
  const store = new PostgresWorkspaceStore(getDatabase());

  const membership = workspaceId
    ? await store.requireMembership(userId, workspaceId)
    : await store.ensureDefaultWorkspace(userId);

  return { userId, membership };
}

function localTestUserId(): string | null {
  if (process.env.LOCAL_TEST_MODE !== "true") return null;

  const origin = process.env.APP_ORIGIN?.trim();
  if (!origin || !isLocalOrigin(origin)) {
    throw new Error("LOCAL_TEST_MODE is allowed only when APP_ORIGIN points to localhost/127.0.0.1/::1.");
  }

  const userId = process.env.LOCAL_TEST_USER_ID?.trim() || DEFAULT_LOCAL_TEST_USER_ID;
  if (!isUuid(userId)) throw new Error("LOCAL_TEST_USER_ID must be a valid UUID.");
  return userId;
}

function isLocalOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
