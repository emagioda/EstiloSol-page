"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SEGMENT_LABELS: Record<string, string> = {
  admin: "Admin",
  ventas: "Ventas",
  productos: "Productos",
};

const toLabel = (segment: string) => {
  const known = SEGMENT_LABELS[segment];
  if (known) return known;

  const spaced = segment.replace(/[-_]+/g, " ").trim();
  if (!spaced) return segment;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export default function AdminBreadcrumbs() {
  const pathname = usePathname() || "/admin";
  const segments = pathname
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean);

  if (segments.length === 0 || segments[0] !== "admin") return null;

  const adminSections = segments.slice(1);
  const crumbs = [
    {
      href: "/",
      label: "Inicio",
      isCurrent: adminSections.length === 0,
    },
    ...adminSections.map((segment, index) => {
      const href = `/${["admin", ...adminSections.slice(0, index + 1)].join("/")}`;
      return {
        href,
        label: toLabel(segment),
        isCurrent: index === adminSections.length - 1,
      };
    }),
  ];

  return (
    <nav aria-label="Migas de pan" className="flex flex-wrap items-center gap-1 text-xs text-[var(--brand-cream)]/75">
      {crumbs.map((crumb, index) => (
        <span key={crumb.href} className="inline-flex items-center gap-1">
          {index > 0 ? <span aria-hidden className="text-[var(--brand-gold-300)]/80">/</span> : null}
          {crumb.isCurrent ? (
            <span className="font-semibold text-[var(--brand-cream)]">{crumb.label}</span>
          ) : (
            <Link
              href={crumb.href}
              className="transition hover:text-[var(--brand-gold-300)]"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
