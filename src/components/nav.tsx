"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function AppNav({ userName }: { userName: string }) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  const router = useRouter();

  return (
    <>
      <nav className="border-b border-rule/40 flex items-center justify-between px-3 py-2 md:px-6 md:py-3 shrink-0 bg-white">
        <div className="flex items-center gap-3 md:gap-6 min-w-0">
          <Link href="/app" className="flex items-center gap-2 shrink-0">
            <Image src="/nobg_notelm-logo.png" alt="" width={22} height={22} />
            <span className="text-mono-label font-bold tracking-widest hidden sm:inline">NOTEBOOK LM</span>
          </Link>
          <Link href="/app" className="text-mono-label hover:text-accent transition-colors hidden md:inline">
            NOTIZBÜCHER
          </Link>
        </div>
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <span className="text-mono-label opacity-40 truncate max-w-[120px] md:max-w-none">{userName}</span>
          <button
            onClick={() => setConfirmLogout(true)}
            className="text-mono-label text-accent hover:text-ink transition-colors shrink-0"
          >
            ABMELDEN
          </button>
        </div>
      </nav>

      {confirmLogout && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmLogout(false)}>
          <div
            className="bg-white border-2 border-rule max-w-sm w-full p-6 animate-[dialogIn_0.15s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-mono-label text-accent mb-3">[ ABMELDEN ]</p>
            <p className="text-sm font-bold mb-2">Wirklich abmelden?</p>
            <p className="text-mono-data text-sm opacity-60 mb-6">
              Deine Notizbücher und Quellen bleiben gespeichert.
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  await signOut();
                  router.push("/login");
                }}
                className="flex-1 bg-accent text-white py-2.5 text-mono-label font-bold hover:bg-red-700 transition-colors"
              >
                JA, ABMELDEN
              </button>
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 border-2 border-rule py-2.5 text-mono-label font-bold hover:bg-paper-muted transition-colors"
              >
                ZURÜCK
              </button>
            </div>
          </div>
          <style>{`
            @keyframes dialogIn {
              from { transform: scale(0.95); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
