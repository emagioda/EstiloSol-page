import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import AdminTabs from "@/app/admin/AdminTabs";
import { isAdminEmail } from "@/src/server/auth/adminEmail";
import { authOptions } from "@/src/server/auth/options";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/auth/signin?callbackUrl=/admin/ventas");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(122,89,177,0.36),rgba(58,31,95,0.96)_58%)] px-4 py-8 text-[var(--brand-cream)] md:px-8">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6">
        <header className="glass-panel rounded-3xl border border-[var(--brand-gold-300)]/30 p-6 shadow-[0_20px_42px_rgba(11,4,24,0.4)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-gold-300)]">Panel admin</p>
              <h1 className="[font-family:var(--font-brand-display)] text-3xl text-[var(--brand-cream)]">Estilo Sol</h1>
              <p className="mt-1 text-sm text-[var(--brand-cream)]/75">{session?.user?.email}</p>
            </div>
            <Link
              href="/api/auth/signout?callbackUrl=/"
              className="rounded-xl border border-rose-300/60 bg-rose-50/90 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              Cerrar sesion
            </Link>
          </div>
          <AdminTabs />
        </header>

        {children}
      </div>
    </main>
  );
}
