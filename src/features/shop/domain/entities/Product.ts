export type Product = {
  id: string;
  name: string;
  slug?: string;
  active?: boolean;
  department?: string;
  description?: string;
  short_description?: string;
  category?: string;
  product_type?: string;
  includes?: string | null;
  tags?: string[];
  price: number;
  currency?: string;
  images?: string[];
  is_new?: boolean;
  is_sale?: boolean;
  [k: string]: unknown;
};
