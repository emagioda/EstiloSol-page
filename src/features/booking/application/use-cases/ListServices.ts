import type { Result } from "@/src/core/application/result/Result";
import type { BookingService } from "../../domain/entities/Booking";
import type { BookingRepository } from "../../domain/repositories/BookingRepository";

export class ListServices {
	constructor(private readonly bookingRepository: BookingRepository) {}

	async execute(): Promise<Result<BookingService[]>> {
		try {
			const services = await this.bookingRepository.listServices();
			return { ok: true, value: services };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error : new Error("No se pudieron listar los servicios"),
			};
		}
	}
}

