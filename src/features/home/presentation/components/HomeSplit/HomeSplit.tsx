import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import brandConfig from "@/src/config/brand";

const heroSections = [brandConfig.heroLeft, brandConfig.heroRight];
const heroSupport = [
  {
    kicker: "Peluquería",
    trust: "Turnos online • Confirmación inmediata",
  },
  {
    kicker: "Tienda",
    trust: "Envíos en Rosario • Múltiples medios de pago",
  },
];

export default function HomeSplit() {
  const { typography } = brandConfig;

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <section className="home-split relative z-0 flex min-h-[calc(100dvh-var(--header-height-mobile))] w-full flex-1 flex-col overflow-hidden md:min-h-[calc(100dvh-var(--header-height-desktop))] md:flex-row">
          {heroSections.map((section, index) => {
            const isBookingSection = index === 0;
            const titleShadow = isBookingSection
              ? "0 4px 18px rgba(0, 0, 0, 0.9)"
              : "0 2px 10px rgba(0, 0, 0, 0.35)";
            const bodyShadow = isBookingSection
              ? "0 2px 10px rgba(0, 0, 0, 0.7)"
              : "0 2px 8px rgba(0, 0, 0, 0.3)";
            const TitleTag = "h2";
            const imageObjectPosition = isBookingSection ? "center 28%" : "center 42%";
            const panelStyle = {
              "--home-image-filter": isBookingSection
                ? "brightness(0.54) saturate(0.92) contrast(1.04)"
                : "brightness(0.62) saturate(0.9) contrast(1.02)",
              "--home-image-hover-filter": isBookingSection
                ? "brightness(0.68) saturate(1.03) contrast(1.08)"
                : "brightness(0.76) saturate(1.05) contrast(1.06)",
              "--home-image-rest-filter": "brightness(0.43) saturate(0.78) contrast(1.02)",
              "--home-veil-opacity": isBookingSection ? "0.34" : "0.42",
              "--home-veil-hover-opacity": isBookingSection ? "0.22" : "0.3",
            } as CSSProperties;

            return (
              <article
                key={section.title}
                className="home-panel group relative isolate flex w-full flex-1 flex-col items-center justify-center overflow-hidden bg-[var(--brand-violet-800)] px-6 py-10 text-center text-[var(--brand-cream)] sm:py-14 md:basis-1/2 md:px-10 md:py-24"
                style={panelStyle}
              >
                {section.image.isAvailable && (
                  <Image
                    src={section.image.src}
                    alt={section.image.alt}
                    fill
                    priority
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="home-panel__image absolute inset-0 z-0 object-cover"
                    style={{
                      objectPosition: imageObjectPosition,
                    }}
                  />
                )}
                <div
                  aria-hidden="true"
                  className="home-panel__veil absolute inset-0 z-[1] bg-black"
                />
                <div
                  aria-hidden="true"
                  className="home-panel__wash absolute inset-x-0 bottom-0 z-[2] h-1/2"
                />
                <div
                  aria-hidden="true"
                  className={`home-panel__edge absolute top-0 z-[3] hidden h-full w-px md:block ${
                    isBookingSection ? "right-0" : "left-0"
                  }`}
                />
                <div
                  aria-hidden="true"
                  className="home-panel__spotlight pointer-events-none absolute inset-0 z-[3] hidden md:block"
                />
                <div
                  aria-hidden="true"
                  className={`md:hidden ${
                    isBookingSection
                      ? "absolute -bottom-1 left-0 right-0 h-24 bg-gradient-to-t from-[#130d1a] to-transparent z-[2]"
                      : "absolute -top-1 left-0 right-0 h-24 bg-gradient-to-b from-[#130d1a] to-transparent z-[2]"
                  }`}
                />
                <div
                  aria-hidden="true"
                  className={`md:hidden ${
                    isBookingSection
                      ? "absolute -top-1 left-0 right-0 h-20 bg-gradient-to-b from-[#130d1a]/55 to-transparent z-[2]"
                      : "absolute -bottom-1 left-0 right-0 h-20 bg-gradient-to-t from-[#130d1a]/55 to-transparent z-[2]"
                  }`}
                />
                <Link
                  href={section.ctaHref}
                  aria-label={section.ctaLabel}
                  className="relative z-10 flex h-full w-full items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--brand-violet-950)]"
                >
                  <div className="home-panel__content flex h-full w-full max-w-2xl flex-col items-center justify-center gap-4 sm:gap-5">
                    <span
                      className="home-panel__kicker inline-flex items-center rounded-full border border-[var(--brand-gold-300)]/55 bg-black/35 px-5 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-gold-300)] sm:text-sm"
                      style={{ fontFamily: typography.body }}
                    >
                      {heroSupport[index]?.kicker}
                    </span>
                    <TitleTag
                      className="home-panel__title max-w-[13ch] text-3xl font-semibold leading-tight text-[var(--brand-cream)] sm:text-4xl md:max-w-[15ch] md:text-[2.9rem] lg:text-[3.15rem]"
                      style={{ fontFamily: typography.display, textShadow: titleShadow }}
                    >
                      {section.title}
                    </TitleTag>
                    <p
                      className="home-panel__subtitle max-w-xl text-sm leading-relaxed text-[var(--brand-cream)]/95 sm:text-base"
                      style={{ fontFamily: typography.body, textShadow: bodyShadow }}
                    >
                      {section.subtitle}
                    </p>
                    <span
                      className="home-panel__cta inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--brand-gold-300)] bg-[var(--brand-violet-950)]/80 px-6 py-2.5 text-sm font-semibold text-[var(--brand-cream)] sm:text-base"
                      style={{ fontFamily: typography.body, textShadow: bodyShadow }}
                    >
                      {section.ctaLabel}
                    </span>
                    <p
                      className="home-panel__trust whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--brand-cream)]/85 sm:text-sm sm:tracking-[0.12em]"
                      style={{ fontFamily: typography.body, textShadow: bodyShadow }}
                    >
                      {heroSupport[index]?.trust}
                    </p>
                  </div>
                </Link>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
