import type { Metadata } from "next";
import { SignInButton } from "@/app/signin/SignInButton";

export const metadata: Metadata = {
  title: "Sign In — Forge Handyman",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-navy/10 bg-white p-8 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge">
          Forge Handyman
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-navy">
          Sign in to admin
        </h1>
        <p className="mt-3 text-sm text-ink/70">
          Only emails on the allowlist can sign in. If you&rsquo;re not Mitch
          or Angie, you&rsquo;re in the wrong place.
        </p>
        <div className="mt-6">
          <SignInButton />
        </div>
      </div>
    </div>
  );
}
