import type { ServiceId } from "../value-objects/ServiceId";
import type { TimeSlot } from "../value-objects/TimeSlot";

export type BookingService = {
	id: ServiceId;
	name: string;
	description: string;
	durationMinutes: number;
	price: number;
	currency: "ARS";
};

export type Booking = {
	id: string;
	serviceId: ServiceId;
	serviceName: string;
	date: string;
	timeSlot: TimeSlot;
	customerName: string;
	customerPhone: string;
	notes?: string;
	createdAt: number;
};

