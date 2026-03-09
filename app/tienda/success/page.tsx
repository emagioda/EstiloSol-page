"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

type PaymentData = {
  approved?: boolean;
  message?: string;
  paymentId?: string | number;
  externalReference?: string;
  date?: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ESTILO_SOL_SUPPORT_EMAIL = "estilosol26@gmail.com";
const ESTILO_SOL_WHATSAPP_LABEL = "+54 9 341 688-8926";
const ESTILO_SOL_WHATSAPP_PHONE = "5493416888926";
const RECEIPT_PDF_MODE: "compact" | "a4" = "compact";

const formatDateTime24h = (input?: string | number | Date) => {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
};

const buildWhatsappOrderMessage = (externalReference?: string, date?: string) => {
  const referenceText = externalReference?.trim() || "N/A";
  const dateText = date?.trim() || formatDateTime24h();
  return [
    "Hola Estilo Sol, quiero consultar por mi pedido.",
    `Numero de referencia: ${referenceText}`,
    `Fecha del pago: ${dateText}`,
  ].join("\n");
};

const buildWhatsappOrderUrl = (externalReference?: string, date?: string) =>
  `https://wa.me/${ESTILO_SOL_WHATSAPP_PHONE}?text=${encodeURIComponent(
    buildWhatsappOrderMessage(externalReference, date)
  )}`;

export default function SuccessPage() {
  const { clear } = useCart();
  const [status, setStatus] = useState<"loading" | "approved" | "error">("loading");
  const [message, setMessage] = useState("Procesando tu pago...");
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const clearRef = useRef(clear);
  const hasStartedPollingRef = useRef(false);

  useEffect(() => {
    clearRef.current = clear;
  }, [clear]);

  useEffect(() => {
    if (hasStartedPollingRef.current) return;
    hasStartedPollingRef.current = true;

    let cancelled = false;

    const verifyWithPolling = async (
      ref: string,
      paymentId?: string | null,
      approvedHint?: boolean
    ) => {
      const delays = [0, 1000, 2000, 3000, 5000, 8000, 8000, 8000, 8000, 8000, 8000];

      for (const delay of delays) {
        if (cancelled) return;
        if (delay > 0) await wait(delay);

        try {
          const verifyUrl = new URL("/api/mp/verify-payment", window.location.origin);
          verifyUrl.searchParams.set("ref", ref);
          if (paymentId) {
            verifyUrl.searchParams.set("payment_id", paymentId);
          }

          const res = await fetch(verifyUrl.toString(), {
            cache: "no-store",
          });
          const data = (await res.json().catch(() => null)) as PaymentData | null;

          if (cancelled) return;

          if (data) {
            setPaymentData((previous) => {
              if (
                previous?.paymentId === data.paymentId &&
                previous?.externalReference === data.externalReference &&
                previous?.approved === data.approved &&
                previous?.date === data.date
              ) {
                return previous;
              }
              return data;
            });
          }

          if (data?.approved) {
            clearRef.current();
            setStatus("approved");
            setMessage("Pago completado. Gracias por tu compra.");
            return;
          }

          if (!approvedHint) {
            setStatus("loading");
            setMessage("Procesando tu pago...");
          }
        } catch {
          if (!approvedHint) {
            setStatus("loading");
            setMessage("Procesando tu pago...");
          }
        }
      }

      if (!cancelled) {
        if (approvedHint) {
          setStatus("approved");
          setMessage("Pago recibido. Estamos terminando de validar el comprobante.");
          return;
        }
        setStatus("error");
        setMessage("No pudimos confirmar el pago todavia. Intenta de nuevo en unos minutos.");
      }
    };

    const start = async () => {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref") || params.get("external_reference");
      const paymentId = params.get("payment_id") || params.get("collection_id");
      const paymentStatus =
        (params.get("status") || params.get("collection_status") || "").toLowerCase();
      const approvedHint = paymentStatus === "approved";

      if (!ref) {
        setStatus("error");
        setMessage("No se encontro referencia de pago.");
        return;
      }

      if (approvedHint) {
        clearRef.current();
        setStatus("approved");
        setMessage("Pago recibido. Estamos validando el comprobante...");
        setPaymentData((previous) =>
          previous ?? {
            approved: true,
            paymentId: paymentId ?? undefined,
            externalReference: ref,
            date: formatDateTime24h(),
          }
        );
      }

      await verifyWithPolling(ref, paymentId, approvedHint);
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, []);

  const downloadReceiptPdf = async () => {
    if (!paymentData) return;

    try {
      const { jsPDF } = await import("jspdf");
      const pageWidth = RECEIPT_PDF_MODE === "a4" ? 595 : 430;
      const marginX = RECEIPT_PDF_MODE === "a4" ? 56 : 30;
      const headerHeight = RECEIPT_PDF_MODE === "a4" ? 122 : 102;
      const cardX = marginX;
      const cardY = headerHeight + 18;
      const cardWidth = pageWidth - marginX * 2;
      const labelWidth = RECEIPT_PDF_MODE === "a4" ? 155 : 118;
      const valueWidth = cardWidth - 24 - labelWidth - 18;

      const details: Array<{ label: string; value: string }> = [
        { label: "Estado", value: "Aprobado" },
        { label: "ID de pago", value: String(paymentData.paymentId || "N/A") },
        { label: "Numero de pedido", value: String(paymentData.externalReference || "N/A") },
        { label: "Fecha de pago", value: String(paymentData.date || formatDateTime24h()) },
        { label: "Metodo", value: "Mercado Pago" },
      ];

      const measureDoc = new jsPDF({ unit: "pt", format: [pageWidth, 400] });
      measureDoc.setFont("helvetica", "normal");
      measureDoc.setFontSize(11);

      let detailRowsHeight = 0;
      for (const detail of details) {
        const wrappedValue = measureDoc.splitTextToSize(detail.value, valueWidth) as string[];
        detailRowsHeight += Math.max(32, wrappedValue.length * 14 + 10);
      }

      const cardHeight = 86 + detailRowsHeight;
      const footerHeight = 94;
      const compactPageHeight = cardY + cardHeight + footerHeight + 22;
      const pageHeight =
        RECEIPT_PDF_MODE === "a4" ? 842 : Math.max(420, compactPageHeight);

      const doc = new jsPDF({ unit: "pt", format: [pageWidth, pageHeight] });

      const backgroundColor: [number, number, number] = [250, 248, 243];
      const headerColor: [number, number, number] = [45, 30, 77];
      const accentColor: [number, number, number] = [212, 175, 55];
      const textColor: [number, number, number] = [24, 24, 28];
      const mutedColor: [number, number, number] = [96, 96, 104];
      const successColor: [number, number, number] = [31, 129, 78];

      doc.setFillColor(...backgroundColor);
      doc.rect(0, 0, pageWidth, pageHeight, "F");

      doc.setFillColor(...headerColor);
      doc.rect(0, 0, pageWidth, headerHeight, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(RECEIPT_PDF_MODE === "a4" ? 28 : 24);
      doc.text("Estilo Sol", marginX, RECEIPT_PDF_MODE === "a4" ? 56 : 50);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.text("Comprobante de compra", marginX, RECEIPT_PDF_MODE === "a4" ? 80 : 72);

      const badgeText = "PAGO APROBADO";
      const badgeTextWidth = doc.getTextWidth(badgeText);
      const badgeWidth = Math.max(RECEIPT_PDF_MODE === "a4" ? 118 : 108, badgeTextWidth + 24);
      const badgeHeight = 28;
      const badgeX = pageWidth - marginX - badgeWidth;
      const badgeY = RECEIPT_PDF_MODE === "a4" ? 36 : 30;
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 10, 10, "F");
      doc.setTextColor(...successColor);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(badgeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + 3, { align: "center" });

      doc.setFillColor(255, 255, 255);
      doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 12, 12, "F");
      doc.setDrawColor(230, 225, 215);
      doc.setLineWidth(1);
      doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 12, 12, "S");

      const statusIconX = cardX + 24;
      const statusIconY = cardY + 30;
      doc.setDrawColor(...successColor);
      doc.setLineWidth(1.8);
      doc.circle(statusIconX, statusIconY, 9, "S");
      doc.line(statusIconX - 4, statusIconY, statusIconX - 1, statusIconY + 4);
      doc.line(statusIconX - 1, statusIconY + 4, statusIconX + 5, statusIconY - 4);

      doc.setTextColor(...textColor);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Operacion confirmada", cardX + 42, cardY + 34);

      doc.setTextColor(...mutedColor);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Conserva este comprobante para seguimiento y soporte.", cardX + 24, cardY + 56);

      let rowTop = cardY + 70;
      for (const detail of details) {
        const wrappedValue = doc.splitTextToSize(detail.value, valueWidth) as string[];
        const valueLinesHeight = wrappedValue.length * 14;
        const rowHeight = Math.max(32, valueLinesHeight + 10);

        doc.setDrawColor(236, 232, 223);
        doc.setLineWidth(1);
        doc.line(cardX + 16, rowTop, cardX + cardWidth - 16, rowTop);

        doc.setTextColor(...mutedColor);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(detail.label.toUpperCase(), cardX + 24, rowTop + rowHeight / 2 + 3);

        doc.setTextColor(...textColor);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(
          wrappedValue,
          cardX + 24 + labelWidth,
          rowTop + (rowHeight - valueLinesHeight) / 2 + 11
        );

        rowTop += rowHeight;
      }

      doc.setDrawColor(236, 232, 223);
      doc.setLineWidth(1);
      doc.line(cardX + 16, rowTop, cardX + cardWidth - 16, rowTop);

      const footerTop = pageHeight - footerHeight;
      const whatsappUrl = buildWhatsappOrderUrl(
        paymentData.externalReference ? String(paymentData.externalReference) : undefined,
        paymentData.date ? String(paymentData.date) : undefined
      );
      doc.setDrawColor(...accentColor);
      doc.setLineWidth(1.4);
      doc.line(marginX, footerTop, pageWidth - marginX, footerTop);

      doc.setTextColor(...mutedColor);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        "Comprobante no fiscal. Documento valido como constancia de compra.",
        marginX,
        footerTop + 22
      );
      doc.text(`Soporte: ${ESTILO_SOL_SUPPORT_EMAIL}`, marginX, footerTop + 40);
      doc.setTextColor(...successColor);
      doc.textWithLink(`WhatsApp: ${ESTILO_SOL_WHATSAPP_LABEL}`, marginX, footerTop + 56, {
        url: whatsappUrl,
      });

      const fileRef = String(paymentData.externalReference || paymentData.paymentId || Date.now())
        .replace(/[^a-zA-Z0-9-_]/g, "-")
        .slice(0, 60);
      doc.save(`comprobante-estilo-sol-${fileRef || "pedido"}.pdf`);
      setActionNotice("PDF descargado correctamente.");
    } catch (error) {
      setActionNotice("No se pudo generar el PDF en este dispositivo.");
      console.error("Error generating receipt PDF", error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-violet-950)] text-[var(--brand-cream)] p-4">
      <div className="w-full max-w-2xl">
        <div className="rounded-lg bg-[var(--brand-violet-900)] p-8 shadow-lg mb-6">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2" aria-live="polite">
              {status === "approved" && "Pago confirmado"}
              {status === "error" && "Error"}
              {status === "loading" && "Procesando"}
            </h1>
            <p className="text-lg text-[var(--brand-cream)]/80">{message}</p>
          </div>

          {status === "approved" && paymentData && (
            <div className="bg-[var(--brand-violet-950)] rounded border border-[var(--brand-violet-800)] p-6 mb-6 font-mono text-sm">
              <div className="text-center mb-4">
                <p className="font-bold text-[var(--brand-gold-300)]" style={{ fontSize: "0.9rem" }}>
                  COMPROBANTE DE PAGO
                </p>
              </div>
              <div className="space-y-2 text-[var(--brand-cream)]/90">
                <div className="flex justify-between border-b border-[var(--brand-violet-800)] pb-2">
                  <span>ID de Pago:</span>
                  <span className="text-[var(--brand-gold-300)]">{paymentData.paymentId}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--brand-violet-800)] pb-2">
                  <span>Referencia:</span>
                  <span className="text-[var(--brand-gold-300)] text-xs break-all">{paymentData.externalReference}</span>
                </div>
                <div className="flex justify-between">
                  <span>Fecha:</span>
                  <span className="text-[var(--brand-gold-300)]">{paymentData.date}</span>
                </div>
              </div>
              <p className="text-center text-xs text-[var(--brand-cream)]/50 mt-4">Te enviaremos los detalles por email.</p>
            </div>
          )}

          <div className={`grid gap-3 ${status === "approved" ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
            {status === "approved" && (
              <button
                onClick={downloadReceiptPdf}
                className="rounded-xl border border-[var(--brand-gold-300)] bg-[var(--brand-gold-300)] px-5 py-3.5 text-[var(--brand-violet-950)] font-semibold tracking-wide shadow-[0_10px_26px_rgba(212,175,55,0.25)] transition hover:-translate-y-0.5 hover:bg-[var(--brand-gold-300)]/95 hover:shadow-[0_14px_30px_rgba(212,175,55,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
              >
                Descargar Comprobante
              </button>
            )}
            <a
              href="/tienda"
              className="rounded-xl border border-[var(--brand-violet-700)] bg-[var(--brand-violet-800)]/80 px-5 py-3.5 text-center font-semibold tracking-wide text-[var(--brand-cream)] transition hover:-translate-y-0.5 hover:border-[var(--brand-gold-300)]/60 hover:bg-[var(--brand-violet-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
            >
              Volver a la Tienda
            </a>
          </div>

          {actionNotice && <p className="mt-4 text-center text-sm text-[var(--brand-cream)]/70">{actionNotice}</p>}
        </div>

        {status === "error" && (
          <div className="rounded-lg bg-[var(--brand-violet-900)] p-6 text-center text-sm text-[var(--brand-cream)]/80">
            <p>
              Si crees que es un error, contacta a <strong>{ESTILO_SOL_SUPPORT_EMAIL}</strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
