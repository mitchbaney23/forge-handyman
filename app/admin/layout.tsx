import type { ReactNode } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "@/app/admin/SignOutButton";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? "";

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-navy/10 bg-white">
        <div className="container-page flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/admin"
              className="text-sm font-semibold uppercase tracking-[0.18em] text-navy"
            >
              Forge Admin
            </Link>
            <nav className="hidden gap-4 text-sm font-medium text-ink/70 sm:flex">
              <Link href="/admin" className="hover:text-navy">
                Today
              </Link>
              <Link href="/admin/pipeline" className="hover:text-navy">
                Pipeline
              </Link>
              <Link href="/admin/setup-sheet" className="hover:text-navy">
                Maintenance
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="hidden text-ink/60 sm:inline">{email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="container-page py-6 sm:py-10">{children}</main>
    </div>
  );
}
