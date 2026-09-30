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

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
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
