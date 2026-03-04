import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ContactPayload = {
  nombre?: string;
  telefono?: string;
  email?: string;
  mensaje?: string;
  website?: string;
};

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const requestBuckets = new Map<string, number[]>();

const normalize = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const isValidPhone = (value: string): boolean => {
  if (!/^[\d\s()+-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ContactPayload;

  const nombre = normalize(body.nombre);
  const telefono = normalize(body.telefono);
  const email = normalize(body.email);
  const mensaje = normalize(body.mensaje);
  const website = normalize(body.website);

  if (website.length > 0) {
    return NextResponse.json({ ok: true, message: "Mensaje recibido." });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  const now = Date.now();
  const recentRequests = (requestBuckets.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
  );

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestBuckets.set(ip, recentRequests);
    return NextResponse.json(
      {
        ok: false,
        error: "Realizaste demasiados envíos. Intentá nuevamente en unos minutos.",
      },
      { status: 429 }
    );
  }

  recentRequests.push(now);
  requestBuckets.set(ip, recentRequests);

  if (!nombre || !telefono || !email || !mensaje) {
    return NextResponse.json(
      { ok: false, error: "Completá todos los campos del formulario." },
      { status: 400 }
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "El email no tiene un formato válido." },
      { status: 400 }
    );
  }

  if (!isValidPhone(telefono)) {
    return NextResponse.json(
      { ok: false, error: "El teléfono no tiene un formato válido." },
      { status: 400 }
    );
  }

  if (mensaje.length < 10) {
    return NextResponse.json(
      { ok: false, error: "El mensaje es muy corto." },
      { status: 400 }
    );
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const contactToEmail = process.env.CONTACT_TO_EMAIL?.trim();
  const contactFromEmail =
    process.env.CONTACT_FROM_EMAIL?.trim() || "Estilo Sol <onboarding@resend.dev>";

  if (!resendApiKey || !contactToEmail) {
    const missing = [
      !resendApiKey ? "RESEND_API_KEY" : null,
      !contactToEmail ? "CONTACT_TO_EMAIL" : null,
    ].filter(Boolean);

    return NextResponse.json(
      {
        ok: false,
        error:
          "Falta configurar el envío de emails en el servidor (RESEND_API_KEY y CONTACT_TO_EMAIL).",
        missing,
      },
      { status: 503 }
    );
  }

  const subject = `Nuevo contacto web - ${nombre}`;
  const text = [
    "Nuevo mensaje desde el formulario de contacto:",
    `Nombre: ${nombre}`,
    `Teléfono: ${telefono}`,
    `Email: ${email}`,
    "",
    "Mensaje:",
    mensaje,
  ].join("\n");

  const html = `
    <h2>Nuevo mensaje desde el formulario web</h2>
    <p><strong>Nombre:</strong> ${nombre}</p>
    <p><strong>Teléfono:</strong> ${telefono}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Mensaje:</strong></p>
    <p>${mensaje.replace(/\n/g, "<br />")}</p>
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
    const errorDetail = await resendResponse.text();
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo enviar el mensaje en este momento.",
        detail: errorDetail,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, message: "Mensaje enviado correctamente." });
}
