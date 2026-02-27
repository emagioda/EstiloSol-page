import type { Booking, BookingService } from "../entities/Booking";

export interface BookingRepository {
  listServices(): Promise<BookingService[]>;
  create(booking: Booking): Promise<Booking>;
}

