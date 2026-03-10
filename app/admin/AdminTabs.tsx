"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin/ventas", label: "Ventas" },
  { href: "/admin/catalogo", label: "Catalogo" },
];

export default function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className="mt-4 flex flex-wrap gap-2" aria-label="Navegacion de admin">
      {tabs.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
              active
                ? "border-[var(--brand-gold-300)] bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)]"
                : "border-[var(--brand-gold-300)]/35 bg-[rgba(255,255,255,0.06)] text-[var(--brand-cream)] hover:border-[var(--brand-gold-300)]/65 hover:bg-[rgba(248,227,176,0.16)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
