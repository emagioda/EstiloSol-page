"use client";
import { useEffect, useState } from "react";
import { Product } from "../view-models/useProductsStore";
import { useCart } from "../view-models/useCartStore";
import { ChevronLeft, ShoppingCart, Truck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ProductGallery } from "../components/ProductGallery/ProductGallery";

interface ProductDetailProps {
  product: Product;
}

export default function ProductDetail({ product }: ProductDetailProps) {
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);

  // Asegurar que sube al inicio al cargar
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const formattedPrice = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(product.price);

  return (
    <div className="min-h-screen bg-[var(--brand-dark)] pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        
        {/* Breadcrumb / Botón Volver */}
        <Link 
          href="/tienda" 
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-gold-300)] hover:text-[var(--brand-cream)] transition-colors"
        >
          <ChevronLeft size={16} />
          Volver a la tienda
        </Link>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          
          {/* COLUMNA IZQUIERDA: GALERÍA DE IMÁGENES */}
          <div>
             <ProductGallery 
               images={product.images || []} 
               productName={product.name} 
             />
          </div>

          {/* COLUMNA DERECHA: INFORMACIÓN */}
          <div className="flex flex-col gap-6">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-block rounded-full bg-[var(--brand-violet-strong)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--brand-cream)]">
                  {/* CORRECCIÓN AQUÍ: Usamos String() para asegurar que sea texto */}
                  {String(product.category || "Joyería")}
                </span>
                {product.is_new && (
                  <span className="inline-block rounded-full bg-[var(--brand-gold-400)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--brand-dark)]">
                    Nuevo
                  </span>
                )}
              </div>
              
              <h1 className="text-3xl font-bold text-[var(--brand-cream)] sm:text-4xl">
                {product.name}
              </h1>
              
              <div className="mt-4 flex items-end gap-4">
                <span className="text-3xl font-bold text-[var(--brand-gold-300)]">
                  {formattedPrice}
                </span>
                {product.is_sale && (
                  <span className="mb-1 text-lg text-gray-400 line-through decoration-red-500">
                    ${(product.price * 1.2).toLocaleString("es-AR")}
                  </span>
                )}
              </div>
            </div>

            <div className="h-px bg-[var(--brand-gold-400)]/20" />

            <p className="text-lg leading-relaxed text-gray-300">
              {String(product.description || "Sin descripción disponible para este producto.")}
            </p>

            {/* CONTROLES DE COMPRA */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center rounded-full border border-[var(--brand-gold-400)]/50 bg-[rgba(255,255,255,0.05)] p-1">
                <button 
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--brand-cream)] hover:bg-[var(--brand-violet-strong)] transition-colors"
                >
                  -
                </button>
                <span className="w-12 text-center text-lg font-semibold text-[var(--brand-cream)]">
                  {qty}
                </span>
                <button 
                  onClick={() => setQty(qty + 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--brand-cream)] hover:bg-[var(--brand-violet-strong)] transition-colors"
                >
                  +
                </button>
              </div>

              <button
                onClick={() => addItem({ 
                  productId: product.id, 
                  name: product.name, 
                  unitPrice: product.price, 
                  qty: qty, 
                  image: product.images?.[0] || "" 
                })}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--brand-gold-400)] px-8 py-3 text-base font-bold text-[var(--brand-dark)] shadow-[0_0_20px_rgba(212,175,55,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(212,175,55,0.6)] active:scale-95"
              >
                <ShoppingCart size={20} />
                Agregar al Carrito
              </button>
            </div>

            {/* BENEFITS / GARANTÍAS */}
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-3 rounded-xl border border-[var(--brand-gold-400)]/10 bg-[rgba(255,255,255,0.02)] p-3">
                <Truck className="text-[var(--brand-gold-300)]" size={20} />
                <span>Envío a todo el país</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-[var(--brand-gold-400)]/10 bg-[rgba(255,255,255,0.02)] p-3">
                <ShieldCheck className="text-[var(--brand-gold-300)]" size={20} />
                <span>Garantía de calidad</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}