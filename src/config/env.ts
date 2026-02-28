type ServerEnvKey =
	| "MP_ACCESS_TOKEN"
	| "APP_BASE_URL"
	| "MP_WEBHOOK_SECRET"
	| "MP_WEBHOOK_URL"
	| "MP_SUCCESS_URL"
	| "MP_FAILURE_URL"
	| "MP_PENDING_URL"
	| "OPS_METRICS_TOKEN"
	| "MP_ACCESS_TOKEN_ROTATED_AT"
	| "MP_WEBHOOK_SECRET_ROTATED_AT";

type PublicEnvKey =
	| "NEXT_PUBLIC_MP_PUBLIC_KEY"
	| "NEXT_PUBLIC_SHEETS_ENDPOINT"
	| "NEXT_PUBLIC_BASE_PATH";

const readEnv = (key: string): string | undefined => {
	const value = process.env[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

const getRequiredServer = (key: ServerEnvKey): string => {
	const value = readEnv(key);
	if (!value) {
		throw new Error(`${key} missing`);
	}
	return value;
};

const getOptionalServer = (key: ServerEnvKey): string | undefined => {
	return readEnv(key);
};

const getPublic = (key: PublicEnvKey): string | undefined => {
	return readEnv(key);
};

const validatePaymentsServerEnv = (): { ok: boolean; missing: ServerEnvKey[] } => {
	const required: ServerEnvKey[] = ["MP_ACCESS_TOKEN"];
	const missing = required.filter((key) => !readEnv(key));
	return {
		ok: missing.length === 0,
		missing,
	};
};

export const env = {
	getRequiredServer,
	getOptionalServer,
	getPublic,
	validatePaymentsServerEnv,
} as const;

