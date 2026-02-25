import { kv } from "@vercel/kv";

export { kv };

export async function getJson<T>(key: string): Promise<T | null> {
  const value = await kv.get<T>(key);
  return value ?? null;
}

export async function setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await kv.set(key, value, { ex: ttlSeconds });
}

export async function del(key: string): Promise<void> {
  await kv.del(key);
}
