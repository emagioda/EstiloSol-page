export const CHECKOUT_ATTEMPT_STORAGE_KEY = "es_sol_checkout_attempt_v1";
const CHECKOUT_ATTEMPT_IN_PROGRESS = "CHECKOUT_ATTEMPT_IN_PROGRESS";

const ATTEMPT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,120}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const EXTERNAL_REFERENCE_PATTERN = /^es-[a-z0-9-]{6,80}$/i;

export type StoredCheckoutAttempt = {
  attemptId: string;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
  externalReference?: string;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const fallbackHash = (input: string) => {
  let state = 2166136261;
  let output = "";
  for (let round = 0; round < 8; round += 1) {
    let hash = state ^ round;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    output += (hash >>> 0).toString(16).padStart(8, "0");
    state = hash;
  }
  return output;
};

export async function buildBrowserCheckoutFingerprint(payload: unknown): Promise<string> {
  const canonical = stableStringify(payload);
  const cryptoRef = typeof window !== "undefined" ? window.crypto : globalThis.crypto;
  if (cryptoRef?.subtle) {
    const digest = await cryptoRef.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return bytesToHex(new Uint8Array(digest));
  }
  return fallbackHash(canonical);
}

const createAttemptId = () => {
  const cryptoRef = typeof window !== "undefined" ? window.crypto : globalThis.crypto;
  const randomValue =
    cryptoRef && typeof cryptoRef.randomUUID === "function"
      ? cryptoRef.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ca_${randomValue}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
};

const isStoredCheckoutAttempt = (value: unknown): value is StoredCheckoutAttempt => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredCheckoutAttempt>;
  return (
    typeof record.attemptId === "string" &&
    ATTEMPT_ID_PATTERN.test(record.attemptId) &&
    typeof record.fingerprint === "string" &&
    FINGERPRINT_PATTERN.test(record.fingerprint) &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt) &&
    (record.externalReference === undefined ||
      (typeof record.externalReference === "string" &&
        EXTERNAL_REFERENCE_PATTERN.test(record.externalReference)))
  );
};

export const readStoredCheckoutAttempt = (): StoredCheckoutAttempt | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isStoredCheckoutAttempt(parsed)) return parsed;
    window.localStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable or contain corrupt data. A fresh attempt is safe.
  }
  return null;
};

const writeStoredCheckoutAttempt = (attempt: StoredCheckoutAttempt) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // The server remains the idempotency authority when storage is unavailable.
  }
};

export async function getOrCreateBrowserCheckoutAttempt(payload: unknown): Promise<StoredCheckoutAttempt> {
  const fingerprint = await buildBrowserCheckoutFingerprint(payload);
  const existing = readStoredCheckoutAttempt();
  if (existing?.fingerprint === fingerprint) return existing;

  const now = Date.now();
  const candidate: StoredCheckoutAttempt = {
    attemptId: createAttemptId(),
    fingerprint,
    createdAt: now,
    updatedAt: now,
  };
  writeStoredCheckoutAttempt(candidate);

  // localStorage is shared by tabs. Re-reading lets a same-payload writer that
  // won the browser race become the common active attempt.
  const winner = readStoredCheckoutAttempt();
  return winner?.fingerprint === fingerprint ? winner : candidate;
}

export const bindCheckoutAttemptExternalReference = (attemptId: string, externalReference: string) => {
  const current = readStoredCheckoutAttempt();
  if (
    !current ||
    current.attemptId !== attemptId ||
    !EXTERNAL_REFERENCE_PATTERN.test(externalReference)
  ) {
    return;
  }
  writeStoredCheckoutAttempt({
    ...current,
    externalReference,
    updatedAt: Date.now(),
  });
};

export const rebindBrowserCheckoutAttempt = (
  attempt: StoredCheckoutAttempt,
  canonicalAttemptId: string
): StoredCheckoutAttempt => {
  if (!ATTEMPT_ID_PATTERN.test(canonicalAttemptId)) return attempt;

  const current = readStoredCheckoutAttempt();
  const source = current?.fingerprint === attempt.fingerprint ? current : attempt;
  const { externalReference: sourceExternalReference, ...sourceWithoutReference } = source;
  const canonicalChanged = source.attemptId !== canonicalAttemptId;
  const rebound: StoredCheckoutAttempt = {
    ...sourceWithoutReference,
    attemptId: canonicalAttemptId,
    updatedAt: Date.now(),
    ...(!canonicalChanged && sourceExternalReference
      ? { externalReference: sourceExternalReference }
      : {}),
  };

  // Do not replace a newer checkout with a different material payload while
  // an older request is finishing in the background.
  if (!current || current.fingerprint === attempt.fingerprint) {
    writeStoredCheckoutAttempt(rebound);
  }
  return rebound;
};

export const clearBrowserCheckoutAttempt = (attemptId?: string) => {
  if (typeof window === "undefined") return;
  const current = readStoredCheckoutAttempt();
  if (attemptId && current?.attemptId !== attemptId) return;
  try {
    window.localStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  } catch {
    // Ignore storage failures after a completed checkout.
  }
};

export const clearBrowserCheckoutAttemptForOrder = (externalReference: string) => {
  const current = readStoredCheckoutAttempt();
  if (current?.externalReference !== externalReference) return;
  clearBrowserCheckoutAttempt(current.attemptId);
};

export async function submitCheckoutAttempt<T extends Record<string, unknown>>(
  url: string,
  payload: Record<string, unknown>,
  options: { retryDelaysMs?: number[] } = {}
): Promise<{ response: Response; data: T | null; attempt: StoredCheckoutAttempt }> {
  let attempt = await getOrCreateBrowserCheckoutAttempt(payload);
  const retryDelaysMs = options.retryDelaysMs ?? [150, 300, 600, 1_200];

  for (let index = 0; ; index += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, checkoutAttemptId: attempt.attemptId }),
    });
    const data = (await response.json().catch(() => null)) as T | null;
    const canonicalAttemptId =
      data &&
      typeof (data as Record<string, unknown>).checkoutAttemptId === "string"
        ? String((data as Record<string, unknown>).checkoutAttemptId)
        : undefined;
    if (canonicalAttemptId) {
      attempt = rebindBrowserCheckoutAttempt(attempt, canonicalAttemptId);
    }
    const code = data && typeof data.code === "string" ? data.code : undefined;
    const retryDelay = retryDelaysMs[index];

    if (code !== CHECKOUT_ATTEMPT_IN_PROGRESS || retryDelay === undefined) {
      return { response, data, attempt };
    }

    if (retryDelay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
    }
  }
}
