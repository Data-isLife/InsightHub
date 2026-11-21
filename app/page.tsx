
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { createClient } from "@/app/lib/supabase/server";
import Dashboard from "@/app/components/dashboard";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <p>Checking your workspace...</p>
        </main>
      }
    >
      <AuthenticatedDashboard />
    </Suspense>
  );
}

async function AuthenticatedDashboard() {
  // Defer authentication work until an actual request arrives.
  await connection();

  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  return <Dashboard />;
}
