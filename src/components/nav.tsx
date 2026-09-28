"use client";

import Link from "next/link";
import Image from "next/image";

/** Local single-user nav: no logout — there is no account to sign out of. */
export function AppNav({ userName }: { userName: string }) {
  return (
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
        <span className="text-mono-label opacity-60 truncate max-w-[160px] md:max-w-none" title={userName}>
          ◉ {userName}
        </span>
      </div>
    </nav>
  );
}
