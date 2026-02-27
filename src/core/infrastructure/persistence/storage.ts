const isBrowser = () => typeof window !== "undefined";

const getItem = <T>(key: string): T | null => {
	if (!isBrowser()) return null;

	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
};

const setItem = <T>(key: string, value: T): boolean => {
	if (!isBrowser()) return false;

	try {
		window.localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
};

const removeItem = (key: string): boolean => {
	if (!isBrowser()) return false;

	try {
		window.localStorage.removeItem(key);
		return true;
	} catch {
		return false;
	}
};

export const storage = {
	getItem,
	setItem,
	removeItem,
} as const;
