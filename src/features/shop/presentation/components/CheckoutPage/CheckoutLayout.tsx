import type { ReactNode } from "react";

type CheckoutLayoutProps = {
  mobileSummary: ReactNode;
  desktopSummary: ReactNode;
  children: ReactNode;
};

export default function CheckoutLayout({ mobileSummary, desktopSummary, children }: CheckoutLayoutProps) {
  return (
    <main className="w-full pb-10 pt-4 text-[var(--brand-cream)] sm:pb-14 sm:pt-6">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {mobileSummary}

        <div className="mt-4 grid items-start gap-6 lg:mt-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] lg:gap-7">
          <section>{children}</section>
          <aside className="hidden lg:block">{desktopSummary}</aside>
        </div>
      </div>
    </main>
  );
}
