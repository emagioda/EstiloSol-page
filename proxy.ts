import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { env } from "@/src/config/env";
import { isAdminEmail } from "@/src/server/auth/adminEmail";

const authSecret = env.getOptionalServer("AUTH_SECRET") || process.env.NEXTAUTH_SECRET;

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: authSecret,
  });

  const email = typeof token?.email === "string" ? token.email : null;
  if (isAdminEmail(email)) {
    return NextResponse.next();
  }

  const signInUrl = new URL("/auth/signin", request.url);
  signInUrl.searchParams.set("callbackUrl", request.nextUrl.href);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
