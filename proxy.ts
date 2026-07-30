import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { env } from "@/src/config/env";
import { isAdminEmail } from "@/src/server/auth/adminEmail";

const authSecret = env.getOptionalServer("AUTH_SECRET") || process.env.NEXTAUTH_SECRET;

const redirectToSignIn = (request: NextRequest) => {
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const callbackUrl =
    requestedPath === "/admin" ||
    requestedPath.startsWith("/admin/") ||
    requestedPath.startsWith("/admin?")
      ? requestedPath
      : "/admin";
  const signInUrl = new URL("/auth/signin", request.url);
  signInUrl.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(signInUrl);
};

export async function proxy(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: authSecret,
    });

    const email = typeof token?.email === "string" ? token.email : null;
    if (isAdminEmail(email)) {
      return NextResponse.next();
    }
  } catch {
    return redirectToSignIn(request);
  }

  return redirectToSignIn(request);
}

export const config = {
  matcher: ["/admin/:path*"],
};
