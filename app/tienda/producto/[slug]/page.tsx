import ProductDetailClientPage from "./ProductDetailClientPage";

export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export default async function ProductDetailRoute({ params }: Props) {
  const resolvedParams = await params;

  return <ProductDetailClientPage slug={resolvedParams.slug} />;
}
