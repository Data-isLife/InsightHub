
"use client";

import { useActionState } from "react";
import { loginAction, signupAction } from "@/app/actions/auth";

type AuthFormProps = {
  mode: "login" | "signup";
};

export default function AuthForm({ mode }: AuthFormProps) {
  const isSignup = mode === "signup";

  const action = isSignup ? signupAction : loginAction;

  const [state, formAction, isPending] = useActionState(
    action,
    {}
  );

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <h1>InsightHub<span>.</span></h1>
          <p>Data intelligence, simplified.</p>
        </div>

        <div className="auth-heading">
          <h2>{isSignup ? "Create your account" : "Welcome back"}</h2>
          <p>
            {isSignup
              ? "Create an account to start your workspace."
              : "Sign in to access your workspace."}
          </p>
        </div>

        <form action={formAction}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={8}
            required
          />

          <button type="submit" disabled={isPending}>
            {isPending
              ? "Please wait..."
              : isSignup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        {state.error && (
          <p className="auth-message" role="alert">
            {state.error}
          </p>
        )}

        {state.success && (
          <p className="auth-message" role="status">
            {state.success}
          </p>
        )}

        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "New to InsightHub?"}{" "}
          <a href={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Sign in" : "Create an account"}
          </a>
        </p>
      </section>
    </main>
  );
}
