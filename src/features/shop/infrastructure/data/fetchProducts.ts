const DEFAULT_SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbz6DR8Q1sFG4CuZ0UtMn889EUQNQAUQjdDMbjt689wLfY45jWFvBkgkEKlgapYaQm1sIg/exec";

const getSheetsEndpoint = () =>
  process.env.NEXT_PUBLIC_SHEETS_ENDPOINT || DEFAULT_SHEETS_ENDPOINT;

export const fetchProductsFromSheets = async (): Promise<unknown[]> => {
  const res = await fetch(getSheetsEndpoint(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch products: ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};
