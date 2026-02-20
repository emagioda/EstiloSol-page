"use client";

import Link from "next/link";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type Props = {
  items: BreadcrumbItem[];
};

export default function Breadcrumbs({ items }: Props) {
  return (
    <nav
      className="mb-6 flex items-center gap-2 text-sm"
      aria-label="Breadcrumb"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div key={`${item.label}-${index}`} className="flex items-center gap-2">
            {index > 0 && (
              <span className="text-[var(--brand-gold-300)]/60">/</span>
            )}
            {isLast ? (
              <span className="text-[var(--brand-cream)]/70">{item.label}</span>
            ) : (
              <Link
                href={item.href || "#"}
                className="text-[var(--brand-gold-300)] transition hover:text-[var(--brand-gold-400)]"
              >
                {item.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
