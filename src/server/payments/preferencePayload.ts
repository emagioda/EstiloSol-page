import type { OrderItem } from "@/src/server/orders/types";

type BuildUrlsInput = {
  appBaseUrl: string;
  externalReference: string;
  successUrl?: string;
  failureUrl?: string;
  pendingUrl?: string;
  webhookUrl?: string;
};

export const buildPreferenceUrls = (input: BuildUrlsInput) => {
  const success = (
    input.successUrl || `${input.appBaseUrl}/tienda/success?ref={EXTERNAL_REFERENCE}`
  ).replace("{EXTERNAL_REFERENCE}", input.externalReference);

  const failure = input.failureUrl || `${input.appBaseUrl}/tienda`;
  const pending = input.pendingUrl || `${input.appBaseUrl}/tienda`;
  const webhook = input.webhookUrl || `${input.appBaseUrl}/api/mp/webhook`;

  const isHttpsSuccessUrl = success.startsWith("https://");
  const isLocalSuccessUrl =
    success.startsWith("http://localhost") || success.startsWith("http://127.0.0.1");
  const shouldUseAutoReturn = isHttpsSuccessUrl || isLocalSuccessUrl;

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
