import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { adminEnabled } from "@/server/config";
import { isAdmin } from "@/server/security/admin";
import { ActionForm, inputCls } from "./ActionForm";
import { loginAction, logoutAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const NAV = [
  ["/admin", "Overview"],
  ["/admin/templates", "Templates"],
  ["/admin/references", "Reference motion"],
  ["/admin/lab", "Dance Lab"],
  ["/admin/trends", "Trend Lab"],
  ["/admin/jobs", "Jobs"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!adminEnabled()) {
    return (
      <main className="mx-auto max-w-lg px-5 py-16">
        <Wordmark className="text-2xl" />
        <h1 className="mt-6 text-2xl font-bold">Admin is disabled</h1>
        <p className="mt-2 text-muted">
          Set <code className="text-fg">ADMIN_TOKEN</code> (at least 32 random characters) in the server
          environment to enable the admin area. Without it, no admin data is readable and no mutations are
          possible.
        </p>
      </main>
    );
  }
  if (!(await isAdmin())) {
    return (
      <main className="mx-auto max-w-sm px-5 py-16">
        <Wordmark className="text-2xl" />
        <h1 className="mt-6 text-2xl font-bold">Admin sign-in</h1>
        <ActionForm action={loginAction} submitLabel="Sign in" className="mt-4">
          <label className="block text-sm text-muted">
            Admin token
            <input
              name="token"
              type="password"
              autoComplete="current-password"
              required
              minLength={32}
              className={`${inputCls} mt-1`}
            />
          </label>
        </ActionForm>
      </main>
    );
  }
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 overflow-x-auto px-4 py-3">
          <Link href="/" className="shrink-0">
            <Wordmark className="text-lg" />
          </Link>
          <nav className="flex gap-1 text-sm" aria-label="Admin">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:bg-surface hover:text-fg"
              >
                {label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="ml-auto">
            <button className="rounded-lg px-3 py-2 text-sm text-muted hover:text-fg">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
