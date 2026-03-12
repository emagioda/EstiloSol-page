import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import AdminBreadcrumbs from "@/app/admin/AdminBreadcrumbs";
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
    redirect("/auth/signin?callbackUrl=/admin");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(170,138,219,0.45),rgba(86,54,132,0.88)_58%)] px-4 pb-8 pt-2 text-[var(--brand-cream)] md:px-8 md:pb-10 md:pt-3">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-2">
        <div className="px-1 pt-0.5">
          <AdminBreadcrumbs />
        </div>
        {children}
      </div>
    </main>
  );
}
