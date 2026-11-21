
import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");

  // Only allow safe, relative application paths.
  const next =
    requestedNext &&
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//") &&
    !requestedNext.includes("\\")
      ? requestedNext
      : "/";

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=verification_failed", url.origin)
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=verification_failed", url.origin)
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
