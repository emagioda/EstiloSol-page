import { NextRequest, NextResponse } from "next/server";

import { env } from "@/src/config/env";
import { logEvent } from "@/src/server/observability/log";
import { checkRateLimit } from "@/src/server/security/rateLimit";

export const runtime = "nodejs";

type ContactPayload = {
  nombre?: string;
  telefono?: string;
  email?: string;
  mensaje?: string;
  website?: string;
};

const RATE_LIMIT_MAX_REQUESTS = 5;

const normalize = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const isValidPhone = (value: string): boolean => {
  if (!/^[\d\s()+-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ContactPayload;

  const nombre = normalize(body.nombre);
  const telefono = normalize(body.telefono);
  const email = normalize(body.email);
  const mensaje = normalize(body.mensaje);
  const website = normalize(body.website);

  if (website.length > 0) {
    return NextResponse.json({ ok: true, message: "Mensaje recibido." });
  }

  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:contact",
    max: RATE_LIMIT_MAX_REQUESTS,
    windowSeconds: 10 * 60,
  });

  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Realizaste demasiados envios. Intenta nuevamente en unos minutos.",
      },
      { status: 429 },
    );
  }

  if (!nombre || !telefono || !email || !mensaje) {
    return NextResponse.json(
      { ok: false, error: "Completa todos los campos del formulario." },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "El email no tiene un formato valido." },
      { status: 400 },
    );
  }

  if (!isValidPhone(telefono)) {
    return NextResponse.json(
      { ok: false, error: "El telefono no tiene un formato valido." },
      { status: 400 },
    );
  }

  if (mensaje.length < 10) {
    return NextResponse.json(
      { ok: false, error: "El mensaje es muy corto." },
      { status: 400 },
    );
  }

  const resendApiKey = env.getOptionalServer("RESEND_API_KEY");
  const contactToEmail = env.getOptionalServer("CONTACT_TO_EMAIL");
  const contactFromEmail =
    env.getOptionalServer("CONTACT_FROM_EMAIL") || "Estilo Sol <onboarding@resend.dev>";

  if (!resendApiKey || !contactToEmail) {
    logEvent("error", "contact.email_env_missing", {
      missing: [
        !resendApiKey ? "RESEND_API_KEY" : null,
        !contactToEmail ? "CONTACT_TO_EMAIL" : null,
      ].filter(Boolean),
    });

    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo enviar el mensaje en este momento.",
      },
      { status: 503 },
    );
  }

  const safeNombre = escapeHtml(nombre);
  const safeTelefono = escapeHtml(telefono);
  const safeEmail = escapeHtml(email);
  const safeMensaje = escapeHtml(mensaje).replace(/\n/g, "<br />");

  const subject = `Nuevo contacto web - ${nombre}`;
  const text = [
    "Nuevo mensaje desde el formulario de contacto:",
    `Nombre: ${nombre}`,
    `Telefono: ${telefono}`,
    `Email: ${email}`,
    "",
    "Mensaje:",
    mensaje,
  ].join("\n");

  const html = `
    <h2>Nuevo mensaje desde el formulario web</h2>
    <p><strong>Nombre:</strong> ${safeNombre}</p>
    <p><strong>Telefono:</strong> ${safeTelefono}</p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <p><strong>Mensaje:</strong></p>
    <p>${safeMensaje}</p>
  `;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: contactFromEmail,
      to: [contactToEmail],
      reply_to: email,
      subject,
      text,
      html,
    }),
  });

  if (!resendResponse.ok) {
    logEvent("error", "contact.resend_failed", {
      status: resendResponse.status,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo enviar el mensaje en este momento.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, message: "Mensaje enviado correctamente." });
}
