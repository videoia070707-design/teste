"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function getRequiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getAppOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error("APP_ORIGIN is not configured.");
  return new URL(configured).origin;
}

function isGoogleAuthEnabled(): boolean {
  return process.env.GOOGLE_AUTH_ENABLED === "true";
}

export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = getRequiredString(formData, "email");
  const password = getRequiredString(formData, "password");

  if (!email || !password) redirect("/login?error=missing_credentials");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) redirect("/login?error=invalid_credentials");
  redirect("/");
}

export async function signUpWithEmail(formData: FormData): Promise<void> {
  const email = getRequiredString(formData, "email");
  const password = getRequiredString(formData, "password");

  if (!email || password.length < 8) redirect("/login?error=invalid_signup");

  const supabase = await createClient();
  const origin = getAppOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/`
    }
  });

  if (error) redirect("/login?error=signup_failed");
  if (!data.session) redirect("/login?status=check_email");
  redirect("/");
}

export async function signInWithGoogle(): Promise<void> {
  if (!isGoogleAuthEnabled()) redirect("/login?error=google_not_configured");

  const supabase = await createClient();
  const origin = getAppOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=/`
    }
  });

  if (error || !data.url) redirect("/login?error=google_oauth_failed");
  redirect(data.url);
}
