export type Departament = "PELUQUERIA" | "BIJOUTERIE";
export type ProductType = "UNICO" | "KIT";

export type Product = {
  id: string;
  name: string;
  slug?: string;
  departament?: Departament;          // columna nueva
  category?: string;                  // ahora categoría dentro del departamento
  price: number;
  currency?: string;
  short_description?: string;
  description?: string;
  images?: string[];
  tags?: string[];                    // parseo de tags_csv aunque hoy no se use
  product_type?: ProductType;         // UNICO | KIT
  includes?: string[];                // sólo relleno cuando product_type === "KIT"
  is_new?: boolean;
  is_sale?: boolean;
  active?: boolean;                   // campo de activación
  [k: string]: unknown;
};
