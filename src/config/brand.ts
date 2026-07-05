export type BrandLink = {
  label: string;
  href: string;
  visible?: boolean;
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
  imagePositionClassName?: string;
  ctaLabel: string;
  ctaHref: string;
};

export type BrandSocialNetwork = {
  name: "Instagram" | "WhatsApp";
  label: string;
  href: string;
  icon: "instagram" | "whatsapp";
};

export type BrandContactInfo = {
  email: string;
  whatsappPhone: string;
  initialContactMessage: string;
  socialNetworks: BrandSocialNetwork[];
};

export type BrandBankTransferInfo = {
  bankName: string;
  alias: string;
  cvu: string;
};

export type BrandFooterLinks = {
  primary: BrandLink[];
  support: BrandLink[];
};

const DEFAULT_WHATSAPP_PHONE = "5493416888926";
const DEFAULT_WHATSAPP_MESSAGE = "Hola Estilo Sol, quisiera consultar sobre ";

const buildWhatsappUrl = (phone: string, message: string): string => {
  const cleanPhone = phone.replace(/\D/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
};

const formatWhatsappLabel = (phone: string): string => {
  const cleanPhone = phone.replace(/\D/g, "");
  const argentinaMobileMatch = cleanPhone.match(/^(\d{2})(\d{1})(\d{3})(\d{3})(\d{4})$/);
  if (argentinaMobileMatch) {
    const [, country, mobilePrefix, areaCode, firstBlock, secondBlock] = argentinaMobileMatch;
    return `+${country} ${mobilePrefix} ${areaCode} ${firstBlock}-${secondBlock}`;
  }
  return `+${cleanPhone}`;
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
    { label: "Contacto", href: "/contacto" },
  ] as BrandLink[],
  footerLinks: {
    primary: [
      { label: "Inicio", href: "/" },
      { label: "Turnos", href: "/turnos" },
      { label: "Tienda", href: "/tienda" },
    ],
    support: [
      { label: "Preguntas Frecuentes", href: "/preguntas-frecuentes", visible: false },
      { label: "Quién soy", href: "/quien-soy", visible: false },
      { label: "Contacto y Redes", href: "/contacto" },
    ],
  } as BrandFooterLinks,
  shopTickerMessages: [
    "Envios en Rosario",
    "10% OFF en efectivo o transferencia",
    "Productos profesionales y bijouterie",
  ],
  palette: {
    violet: {
      deepest: "#b497d6",
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
  contactInfo: {
    email: "estilosol.ms@gmail.com",
    whatsappPhone: DEFAULT_WHATSAPP_PHONE,
    initialContactMessage: DEFAULT_WHATSAPP_MESSAGE,
    socialNetworks: [
      {
        name: "Instagram",
        label: "estilosol_ms",
        href: "https://www.instagram.com/estilosol_ms",
        icon: "instagram",
      },
      {
        name: "WhatsApp",
        label: formatWhatsappLabel(DEFAULT_WHATSAPP_PHONE),
        href: buildWhatsappUrl(DEFAULT_WHATSAPP_PHONE, DEFAULT_WHATSAPP_MESSAGE),
        icon: "whatsapp",
      },
    ],
  } as BrandContactInfo,
  paymentInfo: {
    transfer: {
      bankName: "Mercado Pago",
      alias: "estilosol.ms",
      cvu: "0000003100095356162045",
    } as BrandBankTransferInfo,
  },
  heroLeft: {
    title: "Brillá vos Profesional",
    subtitle: "Reservá tu turno en minutos y recibí atención experta para potenciar tu look.",
    image: {
      src: "/home/turnos-placeholder.webp",
      alt: "Turno de peluquería en Estilo Sol",
      isAvailable: true,
    },
    imagePositionClassName: "bg-[position:center_28%] sm:bg-[position:center_24%] md:bg-center",
    ctaLabel: "Reservar turno ahora",
    ctaHref: "/turnos",
  } as BrandSection,
  heroRight: {
    title: "Productos Profesionales y Diseños Únicos",
    subtitle: "Descubrí productos de peluquería y bijouterie seleccionados para mimarte todos los días.",
    image: {
      src: "/home/tienda-placeholder.webp",
      alt: "Accesorios disponibles en Estilo Sol",
      isAvailable: true,
    },
    imagePositionClassName: "bg-[position:center_42%] sm:bg-center md:bg-center",
    ctaLabel: "Comprar en la tienda",
    ctaHref: "/tienda",
  } as BrandSection,
};

export default brandConfig;
