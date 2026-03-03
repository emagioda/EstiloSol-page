import Link from "next/link";
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
        <div className="pointer-events-none relative z-50 mx-auto mt-3 -mb-4 w-fit max-w-[94vw] rounded-full border border-[var(--brand-violet-700)] bg-[var(--brand-cream)] px-4 py-2 text-center text-[10px] tracking-[0.12em] text-[var(--brand-violet-950)] shadow-[0_8px_24px_rgba(28,10,48,0.25)] sm:px-6 sm:text-sm sm:tracking-[0.16em]">
          <span
            style={{
              fontFamily: typography.body,
              color: "color-mix(in srgb, var(--brand-violet-950) 78%, black)",
            }}
          >
            ELEGÍ CÓMO QUERÉS EMPEZAR: RESERVÁ TU TURNO O COMPRÁ ONLINE
          </span>
        </div>
        <section className="relative z-0 flex w-full flex-1 flex-col overflow-hidden md:flex-row md:hover:[&>article:not(:hover)]:scale-[0.996] md:[&>article:hover]:scale-[1.028]">
          {heroSections.map((section, index) => {
            const isBookingSection = index === 0;
            const titleShadow = isBookingSection
              ? "0 4px 18px rgba(0, 0, 0, 0.9)"
              : "0 2px 10px rgba(0, 0, 0, 0.35)";
            const bodyShadow = isBookingSection
              ? "0 2px 10px rgba(0, 0, 0, 0.7)"
              : "0 2px 8px rgba(0, 0, 0, 0.3)";
            const TitleTag = "h2";
            const hoverOverlapClassName =
              isBookingSection
                ? "md:z-20 md:origin-left md:transform-gpu md:will-change-transform md:hover:z-30 md:hover:-translate-x-1"
                : "md:z-20 md:origin-right md:transform-gpu md:will-change-transform md:hover:z-30 md:hover:translate-x-1";
            const imagePositionClassName = section.imagePositionClassName ?? "bg-center";

            return (
              <article
                key={section.title}
                className={`group relative isolate flex min-h-[50vh] w-full flex-1 flex-col items-center justify-center overflow-visible bg-[var(--brand-violet-800)] px-6 py-20 text-center text-[var(--brand-cream)] transition-transform md:min-h-0 md:basis-1/2 md:px-10 md:py-24 ${hoverOverlapClassName}`}
                style={{
                  transitionDuration: "460ms",
                  transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                {section.image.isAvailable && (
                  <div
                    aria-hidden="true"
                    className={`absolute inset-0 z-0 bg-black bg-cover bg-no-repeat ${imagePositionClassName}`}
                    style={{
                      backgroundImage: `url(${section.image.src})`,
                      filter: isBookingSection ? "brightness(0.55)" : "brightness(0.72)",
                    }}
                  />
                )}
                <div
                  aria-hidden="true"
                  className={`absolute inset-0 z-[1] ${isBookingSection ? "bg-black/30" : "bg-black/45"}`}
                />
                <Link
                  href={section.ctaHref}
                  aria-label={section.ctaLabel}
                  className="relative z-10 flex h-full w-full items-center justify-center outline-none"
                >
                  <div className="flex h-full w-full max-w-2xl flex-col items-center justify-center gap-5">
                    <span
                      className="inline-flex items-center rounded-full border border-[var(--brand-gold-300)]/50 bg-black/35 px-4 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--brand-gold-300)]"
                      style={{ fontFamily: typography.body }}
                    >
                      {heroSupport[index]?.kicker}
                    </span>
                    <TitleTag
                      className="text-3xl font-semibold leading-tight text-[var(--brand-cream)] sm:text-4xl md:text-[2.8rem]"
                      style={{ fontFamily: typography.display, textShadow: titleShadow }}
                    >
                      {section.title}
                    </TitleTag>
                    <p
                      className="max-w-xl text-sm leading-relaxed text-[var(--brand-cream)]/95 sm:text-base"
                      style={{ fontFamily: typography.body, textShadow: bodyShadow }}
                    >
                      {section.subtitle}
                    </p>
                    <span
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--brand-gold-300)] bg-[var(--brand-violet-950)]/80 px-6 py-2.5 text-sm font-semibold text-[var(--brand-cream)] transition-colors duration-200 hover:border-[var(--brand-gold-400)] hover:text-[var(--brand-gold-300)] sm:text-base"
                      style={{ fontFamily: typography.body, textShadow: bodyShadow }}
                    >
                      {section.ctaLabel}
                    </span>
                    <p
                      className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--brand-cream)]/85 sm:text-sm"
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
