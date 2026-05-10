"use client";

import { useEffect, useState } from "react";

type BackToTopButtonProps = {
  hidden?: boolean;
};

export default function BackToTopButton({ hidden = false }: BackToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => {
      const shouldShow = window.scrollY > 520;
      setVisible((current) => (current === shouldShow ? current : shouldShow));
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateVisibility);
    };
  }, []);

  if (!visible || hidden) return null;

  const handleClick = () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  return (
    <button
      type="button"
      aria-label="Volver arriba"
      title="Volver arriba"
      onClick={handleClick}
      className="animate-fadeInSoft fixed bottom-[calc(5.5rem+var(--safe-area-bottom))] right-4 z-[90] inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--brand-gold-400)]/80 bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)] shadow-[0_12px_28px_rgba(18,8,35,0.28)] transition duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)] md:bottom-8 md:right-6"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
  );
}
