export type BrandLink = {
  label: string;
  href: string;
};

export type BrandImage = {
  src: string;
  alt: string;
  isAvailable?: boolean;
};

export type BrandSection = {
  title: string;
  subtitle: string;
  image: BrandImage;
  ctaLabel: string;
  ctaHref: string;
};

export type BrandDecorAsset = BrandImage & {
  width: number;
  height: number;
  fallback?: string;
};

export const brandConfig = {
  brandName: "Estilo Sol",
  logo: {
    src: "/brand/logo.png",
    alt: "Logo Estilo Sol",
    isAvailable: false,
  } as BrandImage,
  navLinks: [
    { label: "Inicio", href: "/" },
    { label: "Nosotros", href: "/#nosotros" },
    { label: "Servicios", href: "/#servicios" },
    { label: "Tienda", href: "/tienda" },
    { label: "Contacto", href: "/#contacto" },
  ] as BrandLink[],
  palette: {
    violet: {
      deepest: "#a890c8",
      deep: "#b8a3d8",
      base: "#c8b4e8",
      light: "#e0d5f0",
      strong: "#6b4fa5",
    },
    gold: {
      deep: "#c08a2e",
      base: "#d6a64b",
      light: "#f2c777",
      glow: "#f8e3b0",
    },
    cream: "#f8f1ff",
    white: "#ffffff",
  },
  typography: {
    display: "var(--font-brand-display)",
    body: "var(--font-brand-body)",
  },
  heroLeft: {
    title: "Estilo y Cuidado Profesional",
    subtitle: "Reservá tu turno y potenciá tu look con expertos",
    image: {
      src: "/home/turnos.jpg",
      alt: "Turno de peluquería en Estilo Sol",
      isAvailable: false,
    },
    ctaLabel: "Reservar Turno",
    ctaHref: "/turnos",
  } as BrandSection,
  heroRight: {
    title: "Productos Profesionales y Diseños Únicos",
    subtitle: "Descubrí tus favoritos para mimarte: belleza y detalles que enamoran",
    image: {
      src: "/home/tienda.jpg",
      alt: "Accesorios disponibles en Estilo Sol",
      isAvailable: false,
    },
    ctaLabel: "Ir a la Tienda",
    ctaHref: "/tienda",
  } as BrandSection,
  assetsDecorativos: {
    left: {
      src: "/home/tijeras.png",
      alt: "Tijeras decorativas",
      width: 120,
      height: 80,
      fallback: "✂️",
      isAvailable: false,
    },
    right: {
      src: "/home/joyas.png",
      alt: "Diseños únicos decorativos",
      width: 120,
      height: 120,
      fallback: "💎",
      isAvailable: false,
    },
  } as Record<string, BrandDecorAsset>,
};

export default brandConfig;
