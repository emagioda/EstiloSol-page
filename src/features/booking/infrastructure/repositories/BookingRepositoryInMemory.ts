import type { BookingRepository } from "../../domain/repositories/BookingRepository";
import type { Booking, BookingService } from "../../domain/entities/Booking";
import servicesMock from "../data/services.mock.json";

const inMemoryBookings: Booking[] = [];

const toService = (item: unknown): BookingService | null => {
	if (!item || typeof item !== "object") return null;
	const row = item as Record<string, unknown>;

	const id = String(row.id ?? "").trim();
	const name = String(row.name ?? "").trim();
	const description = String(row.description ?? "").trim();
	const durationMinutes = Number(row.durationMinutes);
	const price = Number(row.price);
	const currency = String(row.currency ?? "ARS").toUpperCase();

	if (!id || !name || !description) return null;
	if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
	if (!Number.isFinite(price) || price < 0) return null;
	if (currency !== "ARS") return null;

	return {
		id,
		name,
		description,
		durationMinutes,
		price,
		currency: "ARS",
	};
};

const defaultServices = Array.isArray(servicesMock)
	? servicesMock.map(toService).filter((service): service is BookingService => service !== null)
	: [];

export class BookingRepositoryInMemory implements BookingRepository {
	async listServices(): Promise<BookingService[]> {
		return [...defaultServices];
	}

	async create(booking: Booking): Promise<Booking> {
		inMemoryBookings.push(booking);
		return { ...booking };
	}
}
