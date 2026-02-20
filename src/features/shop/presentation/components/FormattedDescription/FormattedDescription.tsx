"use client";

type Props = {
  description: string;
};

// Helper para parsear la descripción en secciones
const parseDescriptionSections = (text: string) => {
  const sections: Array<{
    title?: string;
    content: string[];
  }> = [];

  const lines = text.split("\n").filter((line) => line.trim());

  let currentSection: (typeof sections)[0] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detectar títulos (líneas que terminan en "?" o son todas mayúsculas sin puntuación)
    const isTitle =
      trimmed.endsWith("?") ||
      (trimmed === trimmed.toUpperCase() &&
        trimmed.length > 3 &&
        !trimmed.includes(":")) ||
      trimmed.endsWith(":");

    if (isTitle) {
      // Guardar sección anterior si existe
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: trimmed,
        content: [],
      };
    } else if (currentSection) {
      // Agregar línea al contenido de la sección actual
      currentSection.content.push(trimmed);
    } else {
      // Primera sección sin título (introducción)
      if (!currentSection) {
        currentSection = { content: [] };
      }
      currentSection.content.push(trimmed);
    }
  }

  // Guardar última sección
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
};

export default function FormattedDescription({ description }: Props) {
  if (!description || description.trim().length === 0) {
    return (
      <p className="text-sm leading-relaxed text-[var(--brand-cream)]/85">
        Sin descripción detallada por el momento.
      </p>
    );
  }

  const sections = parseDescriptionSections(description);

  return (
    <div className="space-y-6">
      {sections.map((section, idx) => (
        <div key={idx}>
          {section.title && (
            <>
              <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--brand-gold-300)]">
                {section.title}
              </h3>
              <div className="mt-2 h-px bg-gradient-to-r from-[var(--brand-gold-400)]/40 via-[var(--brand-gold-300)]/20 to-transparent" />
            </>
          )}
          <div className="mt-4 space-y-3">
            {section.content.map((line, lineIdx) => (
              <p
                key={lineIdx}
                className="text-sm leading-relaxed text-[var(--brand-cream)]/85"
              >
                {line.startsWith("-") ? (
                  <>
                    <span className="text-[var(--brand-gold-400)]">•</span>
                    <span className="ml-2">{line.slice(1).trim()}</span>
                  </>
                ) : (
                  line
                )}
              </p>
            ))}
          </div>
          {idx < sections.length - 1 && (
            <div className="mt-6 h-px bg-gradient-to-r from-transparent via-[var(--brand-violet-800)]/30 to-transparent" />
          )}
        </div>
      ))}
    </div>
  );
}
