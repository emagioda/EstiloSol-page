import { Product } from "../../presentation/view-models/useProductsStore";

const DEFAULT_SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbz6DR8Q1sFG4CuZ0UtMn889EUQNQAUQjdDMbjt689wLfY45jWFvBkgkEKlgapYaQm1sIg/exec";

const getSheetsEndpoint = () =>
  process.env.NEXT_PUBLIC_SHEETS_ENDPOINT || DEFAULT_SHEETS_ENDPOINT;

// --- ADAPTADOR: Convierte datos "sucios" del Excel a "limpios" para la App ---
const adaptSheetRowToProduct = (row: any): Product => {
  return {
    // Si no hay ID, generamos uno temporal o usamos un string vacío para no romper
    id: String(row.id || row.ID || `temp-${Math.random().toString(36).slice(2)}`),
    
    // Aseguramos que siempre haya texto
    name: String(row.name || row.Nombre || "Producto sin nombre"),
    description: String(row.description || row.Descripcion || ""),
    category: String(row.category || row.Categoria || "General"),
    
    // Limpiamos el precio: quitamos símbolos de moneda si vienen en el excel y convertimos a número
    price: typeof row.price === 'number' 
      ? row.price 
      : Number(String(row.price || row.Precio || "0").replace(/[^0-9.-]+/g, "")),
      
    currency: String(row.currency || row.Moneda || "ARS"),
    
    // Manejo robusto de imágenes (si vienen separadas por comas o es una sola url)
    images: row.images 
      ? (Array.isArray(row.images) ? row.images : String(row.images).split(',').map(s => s.trim()))
      : [],
      
    is_new: Boolean(row.is_new || row.Nuevo),
    is_sale: Boolean(row.is_sale || row.Oferta),
  };
};

export const fetchProductsFromSheets = async (): Promise<Product[]> => {
  // MEJORA: revalidate: 60 hace que la carga sea INSTANTÁNEA (cache)
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