type FetchPolicy = {
  timeoutMs: number;
  retries: number;
  retryDelayMs?: number;
  retryOnStatuses?: number[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithPolicy(
  input: RequestInfo | URL,
  init: RequestInit,
  policy: FetchPolicy
): Promise<Response> {
  const retryOnStatuses = policy.retryOnStatuses ?? [408, 409, 429, 500, 502, 503, 504];
  const retryDelayMs = policy.retryDelayMs ?? 200;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok || attempt === policy.retries || !retryOnStatuses.includes(response.status)) {
        return response;
      }
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === policy.retries) {
        throw error;
      }
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithPolicy failed");
}
