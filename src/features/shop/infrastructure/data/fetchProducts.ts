import { Product } from "../../presentation/view-models/useProductsStore";

const DEFAULT_SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbz6DR8Q1sFG4CuZ0UtMn889EUQNQAUQjdDMbjt689wLfY45jWFvBkgkEKlgapYaQm1sIg/exec";

const getSheetsEndpoint = () =>
  process.env.NEXT_PUBLIC_SHEETS_ENDPOINT || DEFAULT_SHEETS_ENDPOINT;

// --- ADAPTADOR: Convierte datos "sucios" del Excel a "limpios" para la App ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adaptSheetRowToProduct = (row: any): Product => {
  // Buscamos la imagen en 'images' (lo que devuelve tu script nuevo) 
  // O en 'images_csv' (nombre real de la columna por si el script falla o devuelve crudo)
  const rawImages = row.images || row.images_csv;

  return {
    // Si no hay ID, generamos uno temporal para no romper la app
    id: String(row.id || row.ID || `temp-${Math.random().toString(36).slice(2)}`),
    
    // Aseguramos que siempre haya texto
    name: String(row.name || row.Nombre || "Producto sin nombre"),
    slug: row.slug ? String(row.slug) : undefined,
    description: String(row.description || row.Descripcion || ""),
    category: String(row.category || row.Categoria || "General"),
    
    // Limpiamos el precio: quitamos símbolos de moneda y convertimos a número
    price: typeof row.price === 'number' 
      ? row.price 
      : Number(String(row.price || row.Precio || "0").replace(/[^0-9.-]+/g, "")),
      
    currency: String(row.currency || row.Moneda || "ARS"),
    
    // Lógica robusta para imágenes:
    // 1. Soporta Array (si viene del script procesado)
    // 2. Soporta String (si viene del CSV crudo), separando por comas
    // 3. filter(Boolean) elimina huecos vacíos si hay comas extra
    images: rawImages 
      ? (Array.isArray(rawImages) 
          ? rawImages 
          : String(rawImages).split(',').map(s => s.trim()).filter(Boolean))
      : [],
      
    is_new: Boolean(row.is_new || row.Nuevo),
    is_sale: Boolean(row.is_sale || row.Oferta),
  };
};

export const fetchProductsFromSheets = async (): Promise<Product[]> => {
  // MEJORA: revalidate: 60 hace que la carga sea rápida (cache)
  // y se actualiza cada 60 segundos en segundo plano.
  const res = await fetch(getSheetsEndpoint(), { 
    next: { revalidate: 60 } 
  });
  
  if (!res.ok) {
    throw new Error(`Failed to fetch products: ${res.status}`);
  }
  
  const rawData = await res.json();
  
  // Aplicamos el adaptador a cada fila
  if (Array.isArray(rawData)) {
    return rawData.map(adaptSheetRowToProduct);
  }
  
  return [];
};