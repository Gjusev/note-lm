"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signUp, authClient, useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  useEffect(() => {
    if (session) router.replace("/app");
  }, [session, router]);

  async function handleGoogleSignUp() {
    setError("");
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/app",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }

    setLoading(true);
    const result = await signUp.email(
      { name, email, password, callbackURL: "/app" }
    );

    if (result.error) {
      const msg = result.error.message || "";
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exist")) {
        setError("Diese E-Mail ist bereits registriert.");
      } else {
        setError(msg || "Registrierung fehlgeschlagen.");
      }
      setLoading(false);
      return;
    }

    setVerificationSent(true);
    setLoading(false);
  }

  if (verificationSent) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="border-2 border-rule p-8 md:p-10 text-center">
            <div className="text-5xl mb-6">&#9993;</div>
            <p className="text-mono-label text-accent mb-4">&#91; BESTÄTIGUNG &#93;</p>
            <h1 className="text-3xl font-black uppercase tracking-tight mb-2">
              E-Mail bestätigen
            </h1>
            <p className="text-mono-data mb-6">
              Wir haben einen Bestätigungslink an <strong>{email}</strong> gesendet.
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

  const passwordStrength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : 3;

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="border-2 border-rule p-8 md:p-10">
          <p className="text-mono-label text-accent mb-4">&#91; REGISTRIERUNG &#93;</p>
          <h1 className="text-3xl font-black uppercase tracking-tight mb-2">Konto erstellen</h1>
          <p className="text-mono-data mb-8">
            Starte kostenlos mit deinem KI Research Notebook.
          </p>

          {error && (
            <div className="border-2 border-accent bg-accent/5 p-3 mb-6">
              <p className="text-mono-data text-accent">{error}</p>
              {(error.includes("bereits") || error.includes("schon")) && (
                <Link href="/login" className="text-mono-label text-accent hover:underline mt-1 inline-block">
                  Stattdessen anmelden →
                </Link>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignUp}
            className="w-full border-2 border-rule bg-white px-6 py-4 text-mono-label font-bold hover:bg-paper-muted transition-colors flex items-center justify-center gap-3"
          >
            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            MIT GOOGLE REGISTRIEREN
          </button>

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-rule" />
            <span className="text-mono-label opacity-30">ODER</span>
            <div className="flex-1 h-px bg-rule" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="name" className="text-mono-label block mb-2">
                NAME
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border-2 border-rule bg-paper px-4 py-3 text-mono-data focus:outline-none focus:border-accent"
                placeholder="Dein Name"
                autoComplete="name"
              />
            </div>
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
            <div>
              <label htmlFor="password" className="text-mono-label block mb-2">
                PASSWORT
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
              {password.length > 0 && (
                <div className="mt-2 flex gap-1">
                  {[1, 2, 3].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 transition-colors ${
                        passwordStrength >= level
                          ? level === 1 ? "bg-red-400" : level === 2 ? "bg-yellow-400" : "bg-green-500"
                          : "bg-rule"
                      }`}
                    />
                  ))}
                  <span className="text-mono-label text-ink/40 ml-2 text-xs">
                    {passwordStrength === 1 ? "Schwach" : passwordStrength === 2 ? "Okay" : "Stark"}
                  </span>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-white border-2 border-accent px-6 py-4 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors disabled:opacity-50"
            >
              {loading ? "WIRD GELADEN..." : "KOSTENLOS REGISTRIEREN"}
            </button>
          </form>

          <p className="text-mono-data mt-4 text-center text-xs opacity-50">
            Kostenlos, keine Kreditkarte erforderlich.
          </p>

          <p className="text-mono-data mt-4 text-center">
            Bereits registriert?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Anmelden
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
