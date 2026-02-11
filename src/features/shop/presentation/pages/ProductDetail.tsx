import Image from "next/image";

type Props = {
  params?: { slug?: string };
};

export default function ProductDetail({ params }: Props) {
  const slug = params?.slug ?? "[slug]";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 text-[var(--brand-cream)]">
      <h1 className="text-2xl font-semibold">Detalle del producto</h1>
      <p className="mt-2 text-sm text-[var(--brand-gold-300)]">Slug: {slug}</p>
      <section className="mt-6 space-y-4">
        <div className="relative aspect-square w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)]">
          <Image
            src="/next.svg"
            alt={`Imagen principal de ${slug}`}
            fill
            className="object-cover"
            sizes="(max-width:768px) 100vw, 640px"
            priority
          />
        </div>
        <p>Aquí irá la galería, variantes y acciones de compra.</p>
      </section>
    </main>
  );
}
