import { can, type WorkspaceRole } from "@automation/core";
import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { userId, membership } = await requireWorkspaceContext();
  if (!can(membership.role as WorkspaceRole, "connections.manage")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await request.formData();

  const legalEntityName = optionalString(form.get("legalEntityName"), 200);
  const supportEmail = optionalEmail(form.get("supportEmail"));
  const appId = optionalPattern(form.get("appId"), /^[0-9]{4,40}$/);
  const oauthAuthorizeUrl = optionalHttpsUrl(form.get("oauthAuthorizeUrl"));
  const oauthTokenUrl = optionalHttpsUrl(form.get("oauthTokenUrl"));
  const oauthTokenEncoding = tokenEncoding(form.get("oauthTokenEncoding"));
  const longLivedTokenUrl = optionalHttpsUrl(form.get("longLivedTokenUrl"));
  const identityProbePath = optionalProbePath(form.get("identityProbePath"));

  const sql = getDatabase();
  await sql.begin(async (tx) => {
    await tx`select app_private.set_platform_public_config('legal_entity_name', ${legalEntityName})`;
    await tx`select app_private.set_platform_public_config('support_email', ${supportEmail})`;
    await tx`select app_private.set_instagram_platform_config(
      ${appId},
      ${oauthAuthorizeUrl},
      ${oauthTokenUrl},
      ${oauthTokenEncoding},
      ${longLivedTokenUrl},
      ${identityProbePath}
    )`;

    await tx`
      insert into app_private.audit_logs (
        workspace_id,
        actor_user_id,
        action,
        resource_type,
        resource_id,
        metadata
      ) values (
        ${membership.workspaceId},
        ${userId},
        'platform.setup.updated',
        'platform_configuration',
        'instagram.meta.official',
        ${tx.json({
          fields: [
            'legal_entity_name',
            'support_email',
            'app_id',
            'oauth_authorize_url',
            'oauth_token_url',
            'oauth_token_encoding',
            'long_lived_token_url',
            'identity_probe_path'
          ],
          secretsChanged: false
        })}
      )
    `;
  });

  const target = new URL("/settings", getAppOrigin(request));
  target.searchParams.set("saved", "1");
  return NextResponse.redirect(target, { status: 303 });
}

function optionalString(value: FormDataEntryValue | null, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error("FIELD_TOO_LONG");
  return normalized;
}

function optionalEmail(value: FormDataEntryValue | null): string | null {
  const normalized = optionalString(value, 320);
  if (normalized === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("SUPPORT_EMAIL_INVALID");
  return normalized;
}

function optionalPattern(value: FormDataEntryValue | null, pattern: RegExp): string | null {
  const normalized = optionalString(value, 200);
  if (normalized === null) return null;
  if (!pattern.test(normalized)) throw new Error("FIELD_FORMAT_INVALID");
  return normalized;
}

function optionalHttpsUrl(value: FormDataEntryValue | null): string | null {
  const normalized = optionalString(value, 2_000);
  if (normalized === null) return null;
  const url = new URL(normalized);
  if (url.protocol !== "https:") throw new Error("HTTPS_URL_REQUIRED");
  return url.toString();
}

function tokenEncoding(value: FormDataEntryValue | null): "multipart" | "urlencoded" {
  return value === "urlencoded" ? "urlencoded" : "multipart";
}

function optionalProbePath(value: FormDataEntryValue | null): string | null {
  const normalized = optionalString(value, 500);
  if (normalized === null) return null;
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("\\")) {
    throw new Error("IDENTITY_PROBE_PATH_INVALID");
  }
  return normalized;
}

function getAppOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}
