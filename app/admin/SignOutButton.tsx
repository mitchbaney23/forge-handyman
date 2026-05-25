"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-md border border-navy/15 px-3 py-1.5 text-xs font-medium text-ink/80 hover:border-navy hover:text-navy"
    >
      Sign out
    </button>
  );
}
