export const routes = {
	home: "/",
	tienda: "/tienda",
	tiendaSuccess: "/tienda/success",
	tiendaProducto: (slug: string) => `/tienda/producto/${encodeURIComponent(slug)}`,
	turnos: "/turnos",
	api: {
		health: "/api/health",
		mpCreatePreference: "/api/mp/create-preference",
		mpVerifyPayment: "/api/mp/verify-payment",
		mpWebhook: "/api/mp/webhook",
	},
} as const;
