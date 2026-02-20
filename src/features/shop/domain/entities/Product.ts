export type Product = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  short_description?: string;
  departament?: string;
  category?: string;
  product_type?: "UNICO" | "KIT" | string;
  includes?: string;
  price: number;
  currency?: string;
  images?: string[];
  is_new?: boolean;
  is_sale?: boolean;
  [k: string]: unknown;
};
