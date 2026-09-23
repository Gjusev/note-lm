"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, authClient, useSession } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) router.replace("/app");
  }, [session, router]);

  async function handleGoogleSignIn() {
    setError("");
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/app",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message || "Anmeldung fehlgeschlagen.");
      setLoading(false);
      return;
    }

    router.push("/app");
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="border-2 border-rule p-8 md:p-10">
          <p className="text-mono-label text-accent mb-4">&#91; ANMELDUNG &#93;</p>
          <h1 className="text-3xl font-black uppercase tracking-tight mb-2">Willkommen zurück</h1>
          <p className="text-mono-data mb-8">
            Melde dich an, um deine Notizbücher fortzusetzen.
          </p>

          {error && (
            <div className="border-2 border-accent bg-accent/5 p-3 mb-6">
              <p className="text-mono-data text-accent">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full border-2 border-rule bg-white px-6 py-4 text-mono-label font-bold hover:bg-paper-muted transition-colors flex items-center justify-center gap-3"
          >
            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            MIT GOOGLE ANMELDEN
          </button>

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-rule" />
            <span className="text-mono-label opacity-30">ODER</span>
            <div className="flex-1 h-px bg-rule" />
          </div>

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
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="text-mono-label">
                  PASSWORT
                </label>
                <Link href="/forgot-password" className="text-mono-label text-accent hover:underline text-xs">
                  Passwort vergessen?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border-2 border-rule bg-paper px-4 py-3 pr-12 text-mono-data focus:outline-none focus:border-accent"
                  placeholder="••••••••"
                  autoComplete="current-password"
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
              {loading ? "WIRD GELADEN..." : "ANMELDEN"}
            </button>
          </form>

          <p className="text-mono-data mt-6 text-center">
            Noch kein Konto?{" "}
            <Link href="/register" className="text-accent hover:underline">
              Kostenlos registrieren
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
