type Props = {
  params?: { slug?: string };
};

export default function ProductDetail({ params }: Props) {
  const slug = params?.slug ?? "[slug]";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 text-[var(--brand-cream)]">
      <h1 className="text-2xl font-semibold">Detalle del producto</h1>
      <p className="mt-2 text-sm text-[var(--brand-gold-300)]">Slug: {slug}</p>
      <section className="mt-6">Aquí irá la galería, variantes y acciones de compra.</section>
    </main>
  );
}
