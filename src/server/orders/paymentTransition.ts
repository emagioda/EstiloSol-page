import type {
  OrderPaymentMethod,
  OrderPaymentStatus,
} from "./types";

export type PaymentTransitionAuthority =
  | "admin_manual"
  | "mp_authoritative"
  | "recovery"
  | "system";

export const PAYMENT_TRANSITION_BLOCK_REASONS = {
  notAllowed: "PAYMENT_TRANSITION_NOT_ALLOWED",
  confirmedCannotBeDowngraded: "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED",
  terminalRequiresCorrection: "PAYMENT_TERMINAL_REQUIRES_CORRECTION",
  providerAuthorityRequired: "PAYMENT_PROVIDER_AUTHORITY_REQUIRED",
  mercadoPagoNotApproved: "PAYMENT_MP_NOT_APPROVED",
  authorityRequired: "PAYMENT_TRANSITION_AUTHORITY_REQUIRED",
  incoherentState: "PAYMENT_STATE_INCOHERENT",
} as const;

export type PaymentTransitionBlockReason =
  (typeof PAYMENT_TRANSITION_BLOCK_REASONS)[keyof typeof PAYMENT_TRANSITION_BLOCK_REASONS];

export type PaymentTransitionDecision =
  | { allowed: true; replay: boolean }
  | { allowed: false; reason: PaymentTransitionBlockReason };

type PaymentTransitionInput = {
  current: OrderPaymentStatus;
  requested: OrderPaymentStatus;
  paymentMethod?: OrderPaymentMethod;
  authority: PaymentTransitionAuthority;
};

const TERMINAL_PAYMENT_STATUSES = new Set<OrderPaymentStatus>([
  "cancelled",
  "refunded",
  "charged_back",
]);

export const evaluatePaymentTransition = ({
  current,
  requested,
  paymentMethod,
  authority,
}: PaymentTransitionInput): PaymentTransitionDecision => {
  if (current === requested) return { allowed: true, replay: true };

  if (authority !== "admin_manual") {
    return { allowed: true, replay: false };
  }

  if (current === "confirmed") {
    return {
      allowed: false,
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.confirmedCannotBeDowngraded,
    };
  }

  if (TERMINAL_PAYMENT_STATUSES.has(current)) {
    return {
      allowed: false,
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.terminalRequiresCorrection,
    };
  }

  if (paymentMethod === "mercadopago") {
    return {
      allowed: false,
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired,
    };
  }

  if (
    current === "pending" &&
    requested === "confirmed" &&
    (paymentMethod === "cash" || paymentMethod === "transfer")
  ) {
    return { allowed: true, replay: false };
  }

  return {
    allowed: false,
    reason: PAYMENT_TRANSITION_BLOCK_REASONS.notAllowed,
  };
};

export type AdminPaymentTransitionRequestDecision =
  | {
      allowed: true;
      replay: boolean;
      authority: Extract<PaymentTransitionAuthority, "admin_manual" | "mp_authoritative">;
    }
  | { allowed: false; reason: PaymentTransitionBlockReason };

export const evaluateAdminPaymentTransitionRequest = (
  input: Omit<PaymentTransitionInput, "authority">
): AdminPaymentTransitionRequestDecision => {
  const manualDecision = evaluatePaymentTransition({
    ...input,
    authority: "admin_manual",
  });
  if (manualDecision.allowed) {
    return {
      allowed: true,
      replay: manualDecision.replay,
      authority: "admin_manual",
    };
  }

  if (
    manualDecision.reason === PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired &&
    input.current === "pending" &&
    input.requested === "confirmed" &&
    input.paymentMethod === "mercadopago"
  ) {
    return { allowed: true, replay: false, authority: "mp_authoritative" };
  }

  return manualDecision;
};

export const getPaymentTransitionBlockMessage = (
  reason: PaymentTransitionBlockReason
): string => {
  if (reason === PAYMENT_TRANSITION_BLOCK_REASONS.confirmedCannotBeDowngraded) {
    return "Un pago confirmado no puede cambiar desde la edición normal.";
  }
  if (reason === PAYMENT_TRANSITION_BLOCK_REASONS.terminalRequiresCorrection) {
    return "Este estado financiero requiere una corrección explícita.";
  }
  if (reason === PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired) {
    return "El estado de Mercado Pago sólo puede cambiar con información confirmada por Mercado Pago.";
  }
  if (reason === PAYMENT_TRANSITION_BLOCK_REASONS.mercadoPagoNotApproved) {
    return "Mercado Pago no informa este pago como aprobado.";
  }
  if (reason === PAYMENT_TRANSITION_BLOCK_REASONS.authorityRequired) {
    return "La operación financiera no tiene una autoridad válida.";
  }
  if (reason === PAYMENT_TRANSITION_BLOCK_REASONS.incoherentState) {
    return "La operación financiera no mantiene estados coherentes.";
  }
  return "Ese cambio financiero no está permitido desde la edición normal.";
};

export class PaymentTransitionBlockedError extends Error {
  readonly reason: PaymentTransitionBlockReason;

  constructor(reason: PaymentTransitionBlockReason) {
    super(getPaymentTransitionBlockMessage(reason));
    this.name = "PaymentTransitionBlockedError";
    this.reason = reason;
  }
}

export const isAdminPaymentStatusSelectable = (input: {
  current: OrderPaymentStatus;
  requested: OrderPaymentStatus;
  paymentMethod?: OrderPaymentMethod;
}): boolean => evaluateAdminPaymentTransitionRequest(input).allowed;
