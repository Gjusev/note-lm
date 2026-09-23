import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db/auth";
import { sendEmail } from "@/lib/email";

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 30, // 30 minutes
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Passwort zurücksetzen — KI Research Notebook",
        text: `Klicke auf den Link, um dein Passwort zurückzusetzen: ${url}`,
        html: `<p>Hallo,</p><p>klicke auf den Link, um dein Passwort zurückzusetzen:</p><p><a href="${url}">Passwort zurücksetzen</a></p><p>Dieser Link ist 30 Minuten gültig.</p>`,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "E-Mail bestätigen — KI Research Notebook",
        text: `Klicke auf den Link, um deine E-Mail zu bestätigen: ${url}`,
        html: `<p>Hallo,</p><p>willkommen bei KI Research Notebook! Bitte bestätige deine E-Mail:</p><p><a href="${url}">E-Mail bestätigen</a></p>`,
      });
    },
    sendOnSignUp: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
