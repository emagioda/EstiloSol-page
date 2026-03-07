import type { Departament, ProductType } from "../../domain/entities/Product";

export interface ProductDTO {
  id: string;
  name: string;
  slug?: string;
  departament?: Departament;
  category?: string;
  price: number;
  old_price?: number | null;
  currency?: string;
  short_description?: string | null;
  description?: string | null;
  images?: string[];
  tags?: string[];
  specifications?: Record<string, string>;
  product_type?: ProductType;
  includes?: string[];
  is_new?: boolean;
  is_sale?: boolean;
  active?: boolean;
  stock_status?: string;
  stock_qty?: number | null;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}
