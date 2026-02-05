import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";

type Props = { params: { slug: string } };

export default function ProductDetailRoute({ params }: Props) {
  return <ProductDetail params={params} />;
}
