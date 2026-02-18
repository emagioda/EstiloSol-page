export type Product = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  short_description?: string;
  category?: string;
  price: number;
  currency?: string;
  images?: string[];
  is_new?: boolean;
  is_sale?: boolean;
  [k: string]: unknown;
};
