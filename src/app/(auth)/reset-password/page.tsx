"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? null;

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }

    if (!token) {
      setError("Ungültiger oder abgelaufener Link. Bitte fordere einen neuen an.");
      return;
    }

    setLoading(true);

    const { error: err } = await authClient.resetPassword({
      newPassword: password,
      token,
    });

    if (err) {
      setError(err.message || "Fehler beim Zurücksetzen.");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="border-2 border-rule p-8 md:p-10 text-center">
            <p className="text-mono-label text-accent mb-4">&#91; FEHLER &#93;</p>
            <h1 className="text-3xl font-black uppercase tracking-tight mb-2">Link ungültig</h1>
            <p className="text-mono-data mb-6">
              Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.
            </p>
            <Link
              href="/forgot-password"
              className="inline-block bg-accent text-white border-2 border-accent px-8 py-4 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors"
            >
              NEUEN LINK ANFORDERN
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="border-2 border-rule p-8 md:p-10 text-center">
            <p className="text-mono-label text-accent mb-4">&#91; ERFOLG &#93;</p>
            <h1 className="text-3xl font-black uppercase tracking-tight mb-2">
              Passwort geändert
            </h1>
            <p className="text-mono-data mb-6">
              Dein Passwort wurde erfolgreich zurückgesetzt. Du kannst dich jetzt anmelden.
            </p>
            <Link
              href="/login"
              className="inline-block bg-accent text-white border-2 border-accent px-8 py-4 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors"
            >
              ANMELDEN
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
          <p className="text-mono-label text-accent mb-4">&#91; NEUES PASSWORT &#93;</p>
          <h1 className="text-3xl font-black uppercase tracking-tight mb-2">
            Passwort festlegen
          </h1>
          <p className="text-mono-data mb-8">
            Wähle ein neues Passwort mit mindestens 8 Zeichen.
          </p>

          {error && (
            <div className="border-2 border-accent bg-accent/5 p-3 mb-6">
              <p className="text-mono-data text-accent">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="password" className="text-mono-label block mb-2">
                NEUES PASSWORT
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border-2 border-rule bg-paper px-4 py-3 pr-12 text-mono-data focus:outline-none focus:border-accent"
                  placeholder="Mindestens 8 Zeichen"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink transition-colors px-1"
                  aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                >
                  {showPassword ? "VERSTECKEN" : "ZEIGEN"}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-white border-2 border-accent px-6 py-4 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors disabled:opacity-50"
            >
              {loading ? "WIRD GELADEN..." : "PASSWORT SPEICHERN"}
            </button>
          </form>
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
