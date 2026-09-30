export type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type UserId = Brand<string, "UserId">;
export type ConnectionId = Brand<string, "ConnectionId">;
export type ContactId = Brand<string, "ContactId">;
export type ConversationId = Brand<string, "ConversationId">;
export type MessageId = Brand<string, "MessageId">;
export type EventId = Brand<string, "EventId">;

export type Channel = "instagram" | "whatsapp";
export type ProviderMode = "official" | "experimental" | "browser_lab";

export type WorkspaceRole =
  | "owner"
  | "admin"
  | "automation_manager"
  | "supervisor"
  | "agent"
  | "analyst"
  | "viewer";

export interface Workspace {
  id: WorkspaceId;
  name: string;
  createdAt: string;
}

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  userId: UserId;
  role: WorkspaceRole;
}

export interface ContactIdentity {
  channel: Channel;
  externalId: string;
  username?: string;
  displayName?: string;
  phone?: string;
}

export interface Contact {
  id: ContactId;
  workspaceId: WorkspaceId;
  displayName: string;
  email?: string;
  phone?: string;
  identities: ContactIdentity[];
  createdAt: string;
}

export interface CanonicalEvent<TPayload = unknown> {
  eventId: EventId;
  eventType: string;
  workspaceId: WorkspaceId;
  connectionId: ConnectionId;
  channel: Channel;
  provider: string;
  providerEventId: string;
  occurredAt: string;
  receivedAt: string;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
}

export interface AuditRecord {
  workspaceId: WorkspaceId;
  actorId?: UserId;
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export const WORKSPACE_PERMISSIONS: Record<WorkspaceRole, readonly string[]> = {
  owner: ["*"],
  admin: ["connections.manage", "automation.publish", "campaign.send", "contacts.export", "conversation.reply", "analytics.view", "team.manage", "reliability.resolve"],
  automation_manager: ["automation.publish", "analytics.view", "conversation.reply"],
  supervisor: ["conversation.reply", "analytics.view", "team.assign", "reliability.resolve"],
  agent: ["conversation.reply"],
  analyst: ["analytics.view"],
  viewer: ["analytics.view"]
};

export function can(role: WorkspaceRole, permission: string): boolean {
  const permissions = WORKSPACE_PERMISSIONS[role];
  return permissions.includes("*") || permissions.includes(permission);
}
