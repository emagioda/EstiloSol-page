type Factory<T> = () => T;

class Container {
	private readonly factories = new Map<string, Factory<unknown>>();
	private readonly singletons = new Map<string, unknown>();

	register<T>(key: string, factory: Factory<T>): void {
		this.factories.set(key, factory as Factory<unknown>);
	}

	registerValue<T>(key: string, value: T): void {
		this.singletons.set(key, value);
	}

	resolve<T>(key: string): T {
		if (this.singletons.has(key)) {
			return this.singletons.get(key) as T;
		}

		const factory = this.factories.get(key);
		if (!factory) {
			throw new Error(`Service not registered: ${key}`);
		}

		return factory() as T;
	}

	resolveSingleton<T>(key: string): T {
		if (this.singletons.has(key)) {
			return this.singletons.get(key) as T;
		}

		const factory = this.factories.get(key);
		if (!factory) {
			throw new Error(`Service not registered: ${key}`);
		}

		const instance = factory();
		this.singletons.set(key, instance);
		return instance as T;
	}
}

export const container = new Container();
