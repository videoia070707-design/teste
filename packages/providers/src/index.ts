import type { Channel, ConnectionId, ProviderMode, WorkspaceId } from "@automation/core";

export type CapabilityKey =
  | "messages.receive"
  | "messages.send"
  | "media.send"
  | "comments.receive"
  | "comments.reply"
  | "stories.reply"
  | "content.publish"
  | "templates.send"
  | "broadcast.send"
  | "flows.send"
  | "follow.dm"
  | "browser.actions";

export type CapabilityState = "available" | "beta" | "unavailable" | "degraded";

export interface CapabilityDescriptor {
  key: CapabilityKey;
  state: CapabilityState;
  reason?: string;
}

export type ConnectionHealthState =
  | "HEALTHY"
  | "DEGRADED_PARTIAL"
  | "STALE"
  | "AUTH_EXPIRED"
  | "DISCONNECTED";

export interface ConnectionHealthSnapshot {
  state: ConnectionHealthState;
  checkedAt: string;
  lastEventAt?: string;
  lastSuccessfulActionAt?: string;
  authValid: boolean;
  webhookHealthy: boolean | null;
  capabilities: CapabilityDescriptor[];
  diagnostics: string[];
}

export interface ProviderConnection {
  id: ConnectionId;
  workspaceId: WorkspaceId;
  channel: Channel;
  provider: string;
  mode: ProviderMode;
  externalAccountId?: string;
  displayName?: string;
}

export interface SendTextInput {
  connectionId: ConnectionId;
  recipientExternalId: string;
  text: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface ProviderSendAccepted {
  kind: "accepted";
  providerMessageId: string;
  acceptedAt: string;
}

export interface ProviderSendRejected {
  kind: "rejected";
  code: string;
  message: string;
  retryable: boolean;
}

export interface ProviderSendUnknown {
  kind: "unknown";
  reason: "timeout" | "transport_closed" | "ambiguous_provider_response";
  reconciliationHint?: string;
}

export type ProviderSendResult = ProviderSendAccepted | ProviderSendRejected | ProviderSendUnknown;

export interface ChannelProvider {
  readonly key: string;
  readonly channel: Channel;
  readonly mode: ProviderMode;

  getCapabilities(connection: ProviderConnection): Promise<CapabilityDescriptor[]>;
  verifyConnection(connection: ProviderConnection): Promise<ConnectionHealthSnapshot>;
  sendText(input: SendTextInput): Promise<ProviderSendResult>;
  reconcileSend?(input: { connection: ProviderConnection; idempotencyKey: string; correlationId: string }): Promise<ProviderSendResult>;
}

export class CapabilityRegistry {
  private readonly byProvider = new Map<string, CapabilityDescriptor[]>();

  register(providerKey: string, capabilities: CapabilityDescriptor[]): void {
    this.byProvider.set(providerKey, capabilities);
  }

  list(providerKey: string): readonly CapabilityDescriptor[] {
    return this.byProvider.get(providerKey) ?? [];
  }

  supports(providerKey: string, capability: CapabilityKey): boolean {
    const item = this.list(providerKey).find((entry) => entry.key === capability);
    return item?.state === "available" || item?.state === "beta";
  }
}

export function deriveConnectionHealth(input: {
  authValid: boolean;
  webhookHealthy: boolean | null;
  recentlyVerified: boolean;
  providerReachable: boolean;
  capabilities: CapabilityDescriptor[];
}): ConnectionHealthState {
  if (!input.authValid) return "AUTH_EXPIRED";
  if (!input.providerReachable) return "DISCONNECTED";
  if (!input.recentlyVerified) return "STALE";
  if (input.webhookHealthy === null) return "STALE";
  if (input.webhookHealthy === false || input.capabilities.some((capability) => capability.state === "degraded")) {
    return "DEGRADED_PARTIAL";
  }
  return "HEALTHY";
}
