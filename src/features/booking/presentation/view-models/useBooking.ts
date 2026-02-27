"use client";

import { useEffect, useMemo, useState } from "react";
import { CreateBooking } from "../../application/use-cases/CreateBooking";
import type { BookingDTO } from "../../application/dto/BookingDTO";
import { ListServices } from "../../application/use-cases/ListServices";
import type { Booking, BookingService } from "../../domain/entities/Booking";
import { BookingRepositoryInMemory } from "../../infrastructure/repositories/BookingRepositoryInMemory";

const buildSlots = (): string[] => {
	const slots: string[] = [];
	for (let hour = 9; hour <= 20; hour += 1) {
		for (const minute of [0, 30]) {
			if (hour === 20 && minute > 0) continue;
			slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
		}
	}
	return slots;
};

const initialForm: BookingDTO = {
	serviceId: "",
	date: "",
	timeSlot: "",
	customerName: "",
	customerPhone: "",
	notes: "",
};

export const useBooking = () => {
	const repository = useMemo(() => new BookingRepositoryInMemory(), []);
	const listServicesUseCase = useMemo(() => new ListServices(repository), [repository]);
	const createBookingUseCase = useMemo(() => new CreateBooking(repository), [repository]);

	const [services, setServices] = useState<BookingService[]>([]);
	const [form, setForm] = useState<BookingDTO>(initialForm);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [lastBooking, setLastBooking] = useState<Booking | null>(null);

	const slots = useMemo(() => buildSlots(), []);

	useEffect(() => {
		const load = async () => {
			setLoading(true);
			setError(null);

			const result = await listServicesUseCase.execute();
			if (!result.ok) {
				setError("No pudimos cargar los servicios en este momento.");
				setLoading(false);
				return;
			}

			setServices(result.value);
			if (result.value.length > 0) {
				setForm((prev) => ({ ...prev, serviceId: prev.serviceId || result.value[0].id }));
			}
			setLoading(false);
		};

		void load();
	}, [listServicesUseCase]);

	const selectedService = services.find((service) => service.id === form.serviceId) || null;

	const setField = <K extends keyof BookingDTO>(key: K, value: BookingDTO[K]) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const submitBooking = async () => {
		setSubmitting(true);
		setError(null);
		setSuccessMessage(null);

		const result = await createBookingUseCase.execute(form);

		if (!result.ok) {
			setError(result.error.message || "No se pudo crear el turno.");
			setSubmitting(false);
			return;
		}

		setLastBooking(result.value);
		setSuccessMessage("¡Turno reservado con éxito! Te contactaremos para confirmar.");
		setForm((prev) => ({
			...initialForm,
			serviceId: prev.serviceId,
		}));
		setSubmitting(false);
	};

	return {
		services,
		slots,
		form,
		loading,
		submitting,
		error,
		successMessage,
		selectedService,
		lastBooking,
		setField,
		submitBooking,
	} as const;
};

