"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

type TopInfoTickerProps = {
  messages: string[];
  durationSeconds?: number;
  hidden?: boolean;
  className?: string;
};

export default function TopInfoTicker({
  messages,
  durationSeconds = 44,
  hidden = false,
  className = "",
}: TopInfoTickerProps) {
  const [isHovered, setIsHovered] = useState(false);
  const hoverResumeTimerRef = useRef<number | null>(null);

  const clearHoverResumeTimer = () => {
    if (hoverResumeTimerRef.current !== null) {
      window.clearTimeout(hoverResumeTimerRef.current);
      hoverResumeTimerRef.current = null;
    }
  };

  const handlePointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      setIsHovered(true);
      clearHoverResumeTimer();
      hoverResumeTimerRef.current = window.setTimeout(() => {
        setIsHovered(false);
        hoverResumeTimerRef.current = null;
      }, 2200);
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      setIsHovered(false);
      clearHoverResumeTimer();
    }
  };
  
  useEffect(() => {
    return () => {
      clearHoverResumeTimer();
    };
  }, []);

  const safeMessages = messages.length > 0 ? messages : ["Agregar texto informativo"];
  const baseMessage = safeMessages.join("      ✦      ");
  const content = `${Array.from({ length: 10 }, () => baseMessage).join("      ✦      ")}      ✦      `;

  return (
    <div
      className={`group relative overflow-hidden border-b border-[var(--brand-gold-500)] bg-[var(--brand-gold-300)] transition-all duration-300 ease-out ${
        hidden
          ? "max-h-0 -translate-y-1 border-transparent opacity-0"
          : "max-h-12 translate-y-0 opacity-100"
      } ${className}`}
      role="status"
      aria-label={safeMessages.join(". ")}
      aria-hidden={hidden}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[var(--brand-gold-300)] to-transparent md:w-14" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--brand-gold-300)] to-transparent md:w-14" />

      <div className="relative h-7 overflow-hidden">
        <div
          className="ticker-marquee pointer-events-none inline-flex min-w-max items-center whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-violet-950)] will-change-transform md:text-[11px]"
          style={{
            animation: `ticker-marquee ${durationSeconds}s linear infinite`,
            animationPlayState: isHovered ? "paused" : "running",
          }}
        >
          <span className="pr-20">{content}</span>
          <span className="pr-20" aria-hidden>
            {content}
          </span>
        </div>
      </div>
    </div>
  );
}