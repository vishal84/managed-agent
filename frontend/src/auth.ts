import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { env, GOOGLE_CALENDAR_SCOPE } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: `openid email profile ${GOOGLE_CALENDAR_SCOPE}`,
          // Google only issues a refresh token on a consent screen, so force one every sign-in.
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account }) {
      if (account?.provider !== "google") return false;
      if (!account.refresh_token) return "/login?error=NoRefreshToken";
      if (!account.scope?.includes(GOOGLE_CALENDAR_SCOPE)) return "/login?error=NoCalendarScope";
      // The adapter only stores tokens when the account is first linked; keep them current.
      await prisma.account.updateMany({
        where: { provider: "google", providerAccountId: account.providerAccountId },
        data: {
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
          scope: account.scope,
        },
      });
      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = user.role;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id && user.email && env.managerEmails().includes(user.email.toLowerCase())) {
        await prisma.user.update({ where: { id: user.id }, data: { role: "MANAGER" } });
      }
    },
  },
});
