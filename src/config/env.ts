type ServerEnvKey =
	| "MP_ACCESS_TOKEN"
	| "APP_BASE_URL"
	| "MP_WEBHOOK_SECRET"
	| "MP_WEBHOOK_URL"
	| "MP_SUCCESS_URL"
	| "MP_FAILURE_URL"
	| "MP_PENDING_URL"
	| "OPS_METRICS_TOKEN"
	| "RESEND_API_KEY"
	| "CONTACT_TO_EMAIL"
	| "CONTACT_FROM_EMAIL"
	| "SHEETS_ENDPOINT"
	| "AUTH_SECRET"
	| "GOOGLE_CLIENT_ID"
	| "GOOGLE_CLIENT_SECRET"
	| "ADMIN_EMAIL"
	| "MP_ACCESS_TOKEN_ROTATED_AT"
	| "MP_WEBHOOK_SECRET_ROTATED_AT";

type PublicEnvKey =
	| "NEXT_PUBLIC_MP_PUBLIC_KEY"
	| "NEXT_PUBLIC_SHEETS_ENDPOINT"
	| "NEXT_PUBLIC_BASE_PATH"
	| "NEXT_PUBLIC_MP_CHECKOUT_MODE"
	| "NEXT_PUBLIC_WHATSAPP_NUMBER";

type ValidationResult<Key extends string> = {
	ok: boolean;
	missing: Key[];
};

const REQUIRED_PAYMENTS_SERVER_ENV: readonly ServerEnvKey[] = ["MP_ACCESS_TOKEN"];
const REQUIRED_SERVER_ENV: readonly ServerEnvKey[] = [
	"APP_BASE_URL",
	"RESEND_API_KEY",
	"CONTACT_TO_EMAIL",
];
const REQUIRED_PUBLIC_ENV: readonly PublicEnvKey[] = [
	"NEXT_PUBLIC_MP_PUBLIC_KEY",
	"NEXT_PUBLIC_SHEETS_ENDPOINT",
];

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

const validateKeys = <Key extends string>(required: readonly Key[]): ValidationResult<Key> => {
	const missing = required.filter((key) => !readEnv(key));
	return {
		ok: missing.length === 0,
		missing: [...missing],
	};
};

const validatePaymentsServerEnv = (): ValidationResult<ServerEnvKey> => {
	return validateKeys(REQUIRED_PAYMENTS_SERVER_ENV);
};

const validateServerEnv = (): ValidationResult<ServerEnvKey> => {
	return validateKeys(REQUIRED_SERVER_ENV);
};

const validatePublicEnv = (): ValidationResult<PublicEnvKey> => {
	return validateKeys(REQUIRED_PUBLIC_ENV);
};

export const env = {
	getRequiredServer,
	getOptionalServer,
	getPublic,
	validatePaymentsServerEnv,
	validateServerEnv,
	validatePublicEnv,
} as const;

