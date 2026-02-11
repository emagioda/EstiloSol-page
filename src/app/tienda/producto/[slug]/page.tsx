import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ProductDetailPage({ params }: PageProps) {
  const resolvedParams = await params;

  return <ProductDetail params={resolvedParams} />;
}
