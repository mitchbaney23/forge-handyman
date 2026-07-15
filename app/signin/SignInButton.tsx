"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function SignInButton({ callbackUrl = "/admin" }: { callbackUrl?: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        void signIn("google", { callbackUrl });
      }}
      className="btn-primary w-full text-base"
    >
      {loading ? "Redirecting…" : "Continue with Google"}
    </button>
  );
}
