
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/app/lib/supabase/server";

export type AuthState = {
  error?: string;
  success?: string;
};

const AuthSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must contain at least 8 characters."),
});

export async function loginAction(
  _previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const result = AuthSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: result.data.email,
    password: result.data.password,
  });

  if (error) {
    return { error: "Unable to sign in. Check your email and password." };
  }

  redirect("/");
}

export async function signupAction(
  _previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const result = AuthSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const supabase = await createClient();

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ?? "http://localhost:3000";

  const { error } = await supabase.auth.signUp({
    email: result.data.email,
    password: result.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { error: "Unable to create your account. Please try again." };
  }

  return {
    success: "Account request received. Please check your email for the verification link.",
  };
}

export async function signOutAction() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error("Unable to sign out. Please try again.");
  }

  redirect("/login");
}