import type { OrderItem } from "@/src/server/orders/types";

type BuildUrlsInput = {
  appBaseUrl: string;
  externalReference: string;
  successUrl?: string;
  failureUrl?: string;
  pendingUrl?: string;
  webhookUrl?: string;
};

const EXTERNAL_REFERENCE_PATTERNS = [/\{EXTERNAL_REFERENCE\}/g, /\{external_reference\}/g];

const applyExternalReference = (url: string, externalReference: string) => {
  const replaced = EXTERNAL_REFERENCE_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, externalReference),
    url
  );

  try {
    const parsed = new URL(replaced);
    if (!parsed.searchParams.has("ref") && !parsed.searchParams.has("external_reference")) {
      parsed.searchParams.set("ref", externalReference);
    }
    return parsed.toString();
  } catch {
    return replaced;
  }
};

const normalizeLocalhostUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const isLocalhost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname === "::1";

    if (isLocalhost && parsed.protocol === "https:") {
      parsed.protocol = "http:";
      return parsed.toString();
    }

    return url;
  } catch {
    return url;
  }
};

export const buildPreferenceUrls = (input: BuildUrlsInput) => {
  const appBaseUrl = normalizeLocalhostUrl(input.appBaseUrl).replace(/\/$/, "");
  const rawSuccess = input.successUrl || `${appBaseUrl}/tienda/success`;
  const success = normalizeLocalhostUrl(applyExternalReference(rawSuccess, input.externalReference));

  const failure = normalizeLocalhostUrl(input.failureUrl || `${appBaseUrl}/tienda`);
  const pending = normalizeLocalhostUrl(input.pendingUrl || `${appBaseUrl}/tienda`);
  const webhook = normalizeLocalhostUrl(input.webhookUrl || `${appBaseUrl}/api/mp/webhook`);

  const isHttpsSuccessUrl = success.startsWith("https://");
  const shouldUseAutoReturn = isHttpsSuccessUrl;

  return {
    success,
    failure,
    pending,
    webhook,
    isHttpsSuccessUrl,
    shouldUseAutoReturn,
  };
};

type BuildPreferencePayloadInput = {
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  notes: string;
  externalReference: string;
  urls: ReturnType<typeof buildPreferenceUrls>;
  includeAutoReturn: boolean;
};

export const buildPreferencePayload = (input: BuildPreferencePayloadInput) => {
  return {
    items: input.items.map((item) => ({
      id: item.productId,
      title: item.title,
      quantity: item.qty,
      unit_price: item.unitPrice,
      currency_id: "ARS",
    })),
    payer: {
      ...(input.customerName ? { name: input.customerName } : {}),
      ...(input.customerPhone ? { phone: { number: input.customerPhone } } : {}),
    },
    back_urls: {
      success: input.urls.success,
      failure: input.urls.failure,
      pending: input.urls.pending,
    },
    ...(input.includeAutoReturn ? { auto_return: "approved" as const } : {}),
    binary_mode: true,
    notification_url: input.urls.webhook,
    external_reference: input.externalReference,
    metadata: {
      store: "estilo-sol",
      ...(input.notes ? { notes: input.notes } : {}),
    },
  };
};
