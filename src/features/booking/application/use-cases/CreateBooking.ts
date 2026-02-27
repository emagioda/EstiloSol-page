import type { Result } from "@/src/core/application/result/Result";
import { DomainError } from "@/src/core/domain/errors/DomainError";
import type { BookingDTO } from "../dto/BookingDTO";
import type { Booking } from "../../domain/entities/Booking";
import type { BookingRepository } from "../../domain/repositories/BookingRepository";
import { bookingPolicy } from "../../domain/services/BookingPolicy";

const normalizeText = (value: string, maxLength: number): string =>
	value
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);

const buildBookingId = () => {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid) return uuid;
	return `booking-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
};

export class CreateBooking {
	constructor(private readonly bookingRepository: BookingRepository) {}

	async execute(input: BookingDTO): Promise<Result<Booking>> {
		try {
			const customerName = normalizeText(input.customerName, 80);
			const customerPhone = normalizeText(input.customerPhone, 30).replace(/[^\d+]/g, "");
			const notes = normalizeText(input.notes ?? "", 240);

			if (!input.serviceId || !input.date || !input.timeSlot || !customerName || !customerPhone) {
				throw new DomainError("Completá los campos obligatorios para reservar el turno.");
			}

			if (!bookingPolicy.isFutureDate(input.date)) {
				throw new DomainError("La fecha seleccionada no es válida.");
			}

			if (!bookingPolicy.isValidTimeSlot(input.timeSlot)) {
				throw new DomainError("El horario seleccionado no es válido.");
			}

			if (customerPhone.replace(/\D/g, "").length < 8) {
				throw new DomainError("Ingresá un teléfono válido.");
			}

			const services = await this.bookingRepository.listServices();
			const service = services.find((item) => item.id === input.serviceId);
			if (!service) {
				throw new DomainError("El servicio seleccionado no existe.");
			}

			const booking: Booking = {
				id: buildBookingId(),
				serviceId: service.id,
				serviceName: service.name,
				date: input.date,
				timeSlot: input.timeSlot,
				customerName,
				customerPhone,
				...(notes ? { notes } : {}),
				createdAt: Date.now(),
			};

			const createdBooking = await this.bookingRepository.create(booking);
			return { ok: true, value: createdBooking };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error : new Error("No se pudo crear el turno"),
			};
		}
	}
}

