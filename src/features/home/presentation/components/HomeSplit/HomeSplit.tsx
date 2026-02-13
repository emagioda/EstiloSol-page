import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import brandConfig from "@/src/config/brand";

const heroSections = [brandConfig.heroLeft, brandConfig.heroRight];

export default function HomeSplit() {
  const { palette, typography } = brandConfig;

  const brandStyles = {
    "--brand-violet-950": palette.violet.deepest,
    "--brand-violet-900": palette.violet.deep,
    "--brand-violet-800": palette.violet.base,
    "--brand-violet-700": palette.violet.light,
    "--brand-violet-strong": palette.violet.strong,
    "--brand-gold-600": palette.gold.deep,
    "--brand-gold-500": palette.gold.base,
    "--brand-gold-400": palette.gold.light,
    "--brand-gold-300": palette.gold.glow,
    "--brand-cream": palette.cream,
  } as CSSProperties;

  return (
    <div style={brandStyles} className="flex min-h-screen flex-col bg-[var(--brand-violet-950)]">
      <main className="sparkle-bg flex-1">
        <section className="flex w-full flex-col md:h-[calc(100vh-80px)] md:grid md:grid-cols-2 md:gap-0">
          {heroSections.map((section, index) => {
            const TitleTag = index === 0 ? "h1" : "h2";
            const hasImage = section.image.isAvailable;
            return (
              <article
                key={section.title}
                className="relative flex min-h-[44vh] w-full flex-col items-center justify-center gap-2 px-3 py-2 text-center text-[var(--brand-cream)] sm:min-h-[50vh] sm:gap-4 sm:px-4 sm:py-8 md:h-full md:min-h-0 md:py-0 md:px-8 md:text-left"
              >
                <div className="glass-panel flex h-full w-full flex-col rounded-2xl px-4 py-4 text-center transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl sm:rounded-3xl sm:px-6 sm:py-8 md:text-left">
                  <TitleTag
                    className="text-2xl font-semibold leading-tight text-[var(--brand-cream)] sm:text-3xl md:text-4xl"
                    style={{ fontFamily: typography.display }}
                  >
                    {section.title}
                  </TitleTag>
                  <p
                    className="mt-2 text-xs uppercase tracking-[0.15em] text-[var(--brand-gold-300)] sm:mt-3 sm:text-sm sm:tracking-[0.2em]"
                    style={{ fontFamily: typography.body }}
                  >
                    {section.subtitle}
                  </p>

                  <div className="mt-4 flex flex-1 flex-col items-center justify-between gap-3 sm:mt-8 sm:gap-6">
                    <div className="relative w-full overflow-hidden rounded-xl border border-[var(--brand-gold-300)]/60 bg-[rgba(255,255,255,0.1)] p-1 shadow-[0_0_35px_rgba(0,0,0,0.35)] sm:rounded-2xl sm:p-2">
                      <div className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-[rgba(255,255,255,0.08)] sm:h-40 md:h-56 md:rounded-xl">
                        {hasImage ? (
                          <Image
                            src={section.image.src}
                            alt={section.image.alt}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 100vw, (max-width: 768px) 100vw, 50vw"
                          />
                        ) : (
                          <span className="text-xs uppercase tracking-[0.15em] text-[var(--brand-gold-300)] sm:text-sm">
                            {section.image.alt}
                          </span>
                        )}
                      </div>
                    </div>

                    <Link
                      href={section.ctaHref}
                      aria-label={section.ctaLabel}
                      className="inline-flex items-center justify-center rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.45)] transition hover:brightness-110 sm:px-8 sm:py-3 sm:text-sm sm:tracking-[0.25em]"
                    >
                      {section.ctaLabel}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
