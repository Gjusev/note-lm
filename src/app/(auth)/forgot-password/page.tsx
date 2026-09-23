"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (err) {
      setError(err.message || "Fehler beim Senden der E-Mail.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="border-2 border-rule p-8 md:p-10 text-center">
            <div className="text-5xl mb-6">&#9993;</div>
            <p className="text-mono-label text-accent mb-4">&#91; E-MAIL GESENDET &#93;</p>
            <h1 className="text-3xl font-black uppercase tracking-tight mb-2">
              Passwort zurücksetzen
            </h1>
            <p className="text-mono-data mb-6">
              Falls ein Konto mit <strong>{email}</strong> existiert, erhälst du einen Link zum Zurücksetzen.
              Bitte prüfe auch deinen Spam-Ordner.
            </p>
            <Link
              href="/login"
              className="inline-block bg-accent text-white border-2 border-accent px-8 py-4 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors"
            >
              ZUR ANMELDUNG
            </Link>
          </div>
          <div className="mt-4 text-center">
            <Link href="/" className="text-mono-label hover:text-accent transition-colors">
              &#91; ZURÜCK &#93;
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="border-2 border-rule p-8 md:p-10">
          <p className="text-mono-label text-accent mb-4">&#91; PASSWORT VERGESSEN &#93;</p>
          <h1 className="text-3xl font-black uppercase tracking-tight mb-2">Passwort zurücksetzen</h1>
          <p className="text-mono-data mb-8">
            Gib deine E-Mail-Adresse ein und wir senden dir einen Link zum Zurücksetzen.
          </p>

          {error && (
            <div className="border-2 border-accent bg-accent/5 p-3 mb-6">
              <p className="text-mono-data text-accent">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="email" className="text-mono-label block mb-2">
                E-MAIL
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border-2 border-rule bg-paper px-4 py-3 text-mono-data focus:outline-none focus:border-accent"
                placeholder="deine@email.de"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-white border-2 border-accent px-6 py-4 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors disabled:opacity-50"
            >
              {loading ? "WIRD GELADEN..." : "LINK SENDEN"}
            </button>
          </form>

          <p className="text-mono-data mt-6 text-center">
            Doch eingefallen?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Zur Anmeldung
            </Link>
          </p>
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="text-mono-label hover:text-accent transition-colors">
            &#91; ZURÜCK &#93;
          </Link>
        </div>
      </div>
    </div>
  );
}
