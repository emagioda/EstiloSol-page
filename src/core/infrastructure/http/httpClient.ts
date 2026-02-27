export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestConfig = {
	method?: HttpMethod;
	headers?: Record<string, string>;
	body?: unknown;
	timeoutMs?: number;
	cache?: RequestCache;
};

const DEFAULT_TIMEOUT_MS = 12_000;

const request = async <T>(url: string, config: RequestConfig = {}): Promise<T> => {
	const controller = new AbortController();
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method: config.method ?? "GET",
			headers: {
				"Content-Type": "application/json",
				...(config.headers ?? {}),
			},
			body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
			cache: config.cache,
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("application/json")) {
			return null as T;
		}

		return (await response.json()) as T;
	} finally {
		clearTimeout(timeoutId);
	}
};

export const httpClient = {
	request,
	get: <T>(url: string, config: Omit<RequestConfig, "method" | "body"> = {}) =>
		request<T>(url, { ...config, method: "GET" }),
	post: <T>(url: string, body?: unknown, config: Omit<RequestConfig, "method" | "body"> = {}) =>
		request<T>(url, { ...config, method: "POST", body }),
	put: <T>(url: string, body?: unknown, config: Omit<RequestConfig, "method" | "body"> = {}) =>
		request<T>(url, { ...config, method: "PUT", body }),
	patch: <T>(url: string, body?: unknown, config: Omit<RequestConfig, "method" | "body"> = {}) =>
		request<T>(url, { ...config, method: "PATCH", body }),
	del: <T>(url: string, config: Omit<RequestConfig, "method" | "body"> = {}) =>
		request<T>(url, { ...config, method: "DELETE" }),
} as const;
