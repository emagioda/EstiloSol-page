import { Redis } from "@upstash/redis";

type KvValue = unknown;

type KvClient = {
  get<T = KvValue>(key: string): Promise<T | null>;
  set(key: string, value: KvValue, options?: { ex?: number }): Promise<"OK">;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
};

type MemoryEntry = {
  value: KvValue;
  expiresAt: number | null;
};

const hasRedisEnv =
  Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);

const createRedisClient = (): KvClient => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return memoryKv;

  return new Redis({ url, token }) as unknown as KvClient;
};

const memoryStore = new Map<string, MemoryEntry>();

const getMemoryEntry = (key: string): MemoryEntry | null => {
  const entry = memoryStore.get(key);
  if (!entry) return null;

  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return entry;
};

const memoryKv: KvClient = {
  async get<T = KvValue>(key: string): Promise<T | null> {
    const entry = getMemoryEntry(key);
    return (entry?.value as T | undefined) ?? null;
  },
  async set(key: string, value: KvValue, options?: { ex?: number }): Promise<"OK"> {
    const expiresAt = options?.ex ? Date.now() + options.ex * 1000 : null;
    memoryStore.set(key, { value, expiresAt });
    return "OK";
  },
  async del(key: string): Promise<number> {
    return memoryStore.delete(key) ? 1 : 0;
  },
  async incr(key: string): Promise<number> {
    const entry = getMemoryEntry(key);
    const current = Number(entry?.value ?? 0);
    const next = Number.isFinite(current) ? current + 1 : 1;

    memoryStore.set(key, {
      value: next,
      expiresAt: entry?.expiresAt ?? null,
    });

    return next;
  },
  async incrby(key: string, amount: number): Promise<number> {
    const entry = getMemoryEntry(key);
    const current = Number(entry?.value ?? 0);
    const safeAmount = Number.isFinite(amount) ? Math.trunc(amount) : 0;
    const next = Number.isFinite(current) ? current + safeAmount : safeAmount;

    memoryStore.set(key, {
      value: next,
      expiresAt: entry?.expiresAt ?? null,
    });

    return next;
  },
  async expire(key: string, seconds: number): Promise<number> {
    const entry = getMemoryEntry(key);
    if (!entry) return 0;

    memoryStore.set(key, {
      value: entry.value,
      expiresAt: Date.now() + seconds * 1000,
    });

    return 1;
  },
};

export const kv: KvClient = hasRedisEnv ? createRedisClient() : memoryKv;

if (!hasRedisEnv && process.env.NODE_ENV === "production") {
  throw new Error("Persistent KV is required in production");
}

if (!hasRedisEnv && process.env.NODE_ENV !== "production") {
  console.warn("[kv] Using in-memory KV fallback. Configure KV_REST_API_* or UPSTASH_REDIS_REST_* env vars to use persistent storage.");
}

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
