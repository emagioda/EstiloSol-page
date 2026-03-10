import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { env } from "@/src/config/env";
import { isAdminEmail } from "@/src/server/auth/adminEmail";

const googleClientId = env.getOptionalServer("GOOGLE_CLIENT_ID");
const googleClientSecret = env.getOptionalServer("GOOGLE_CLIENT_SECRET");
const authSecret = env.getOptionalServer("AUTH_SECRET") || process.env.NEXTAUTH_SECRET;

const providers = [];

if (googleClientId && googleClientSecret) {
  providers.push(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  secret: authSecret,
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return false;
      return isAdminEmail(user.email);
    },
  },
};
