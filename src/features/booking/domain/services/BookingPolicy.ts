const SLOT_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const bookingPolicy = {
  isValidTimeSlot(slot: string): boolean {
    if (!SLOT_REGEX.test(slot)) return false;
    const [hours, minutes] = slot.split(":").map(Number);
    const total = hours * 60 + minutes;
    const open = 9 * 60;
    const close = 20 * 60;
    return total >= open && total <= close && minutes % 30 === 0;
  },

  isFutureDate(date: string): boolean {
    if (!date) return false;
    const selected = new Date(`${date}T00:00:00`);
    if (Number.isNaN(selected.getTime())) return false;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return selected.getTime() >= today.getTime();
  },
} as const;

