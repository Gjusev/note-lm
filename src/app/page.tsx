"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const NAV_LINKS = [
  { label: "Funktionen", href: "#funktionen" },
  { label: "So geht's", href: "#ablauf" },
  { label: "Architektur", href: "/architektur" },
];

const FEATURES = [
  {
    id: "01",
    title: "Quellen hochladen",
    body: "PDF, Text, Markdown, Audio und Video — alles an einem Ort.",
    image: "/documents-stack-binder-clip.png",
  },
  {
    id: "02",
    title: "KI-gestützte Analyse",
    body: "Stelle Fragen und erhalte präzise Antworten mit Quellenangaben.",
    image: "/headphones-microphone-audio.png",
  },
  {
    id: "03",
    title: "Lernmaterialien",
    body: "Zusammenfassungen, Karteikarten, Quizze und Podcasts automatisch generieren.",
    image: "/notebook-open-grid-tabs.png",
  },
  {
    id: "04",
    title: "Strukturierte Notizen",
    body: "Alle Erkenntnisse übersichtlich organisiert und jederzeit abrufbar.",
    image: "/notebooks-stacked-color-tabs.png",
  },
];

const STEPS = [
  { num: "01", title: "Notizbuch erstellen", desc: "Neues Notizbuch anlegen und Thema benennen." },
  { num: "02", title: "Quellen hochladen", desc: "Dokumente, Audios oder Videos hinzufügen." },
  { num: "03", title: "Fragen stellen", desc: "KI befragt deine Quellen und antwortet mit Nachweisen." },
  { num: "04", title: "Lernen & exportieren", desc: "Lernmaterialien generieren und exportieren." },
];

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!menuRef.current) return;
    if (open) {
      gsap.fromTo(
        menuRef.current,
        { y: -20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.3, ease: "power2.out" }
      );
      gsap.fromTo(
        menuRef.current.querySelectorAll("a"),
        { x: -20, opacity: 0 },
        { x: 0, opacity: 1, stagger: 0.05, duration: 0.25, ease: "power2.out", delay: 0.1 }
      );
    }
  }, { dependencies: [open], scope: menuRef });

  if (!open) return null;

  return (
    <div ref={menuRef} className="md:hidden fixed inset-x-0 top-[57px] z-40 bg-white border-b border-grid notebook-grid">
      <div className="flex flex-col p-6 gap-4">
        {NAV_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={onClose}
            className="text-mono-label hover:text-accent transition-colors py-2"
          >
            {l.label}
          </Link>
        ))}
        <Link
          href="/login"
          onClick={onClose}
          className="text-mono-label hover:text-accent transition-colors py-2"
        >
          ANMELDEN
        </Link>
        <Link
          href="/register"
          onClick={onClose}
          className="bg-accent text-white px-5 py-3 text-mono-label font-bold text-center hover:bg-ink transition-colors"
        >
          KOSTENLOS STARTEN
        </Link>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const heroRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLElement>(null);
  const stepsRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLElement>(null);
  const heroImageRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  useGSAP(() => {
    const heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });

    heroTl
      .from("[data-animate=nav]", { y: -30, opacity: 0, duration: 0.6 })
      .from("[data-animate=hero-label]", { x: -40, opacity: 0, duration: 0.5 }, "-=0.2")
      .from("[data-animate=hero-title] .line", {
        y: 80,
        opacity: 0,
        rotationX: -20,
        duration: 0.7,
        stagger: 0.1,
        ease: "power4.out",
      }, "-=0.3")
      .from("[data-animate=hero-sub]", { y: 20, opacity: 0, duration: 0.5 }, "-=0.3")
      .from("[data-animate=hero-cta]", {
        y: 20,
        opacity: 0,
        duration: 0.4,
        stagger: 0.08,
      }, "-=0.2")
      .from("[data-animate=hero-image]", {
        clipPath: "inset(100% 0 0 0)",
        duration: 1,
        ease: "power4.inOut",
      }, "-=0.5");

    if (heroImageRef.current) {
      gsap.to("[data-animate=hero-image]", {
        yPercent: -10,
        ease: "none",
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "bottom top",
          scrub: 1,
        },
      });
    }

    gsap.from("[data-animate=feature]", {
      scrollTrigger: {
        trigger: featuresRef.current,
        start: "top 75%",
      },
      y: 60,
      opacity: 0,
      duration: 0.6,
      stagger: 0.12,
    });

    gsap.utils.toArray<HTMLElement>("[data-animate=feature-img]").forEach((img) => {
      gsap.from(img, {
        scrollTrigger: {
          trigger: img,
          start: "top 85%",
        },
        scale: 1.05,
        opacity: 0,
        duration: 0.7,
        ease: "power2.out",
      });
    });

    gsap.from("[data-animate=step]", {
      scrollTrigger: {
        trigger: stepsRef.current,
        start: "top 75%",
      },
      y: 40,
      opacity: 0,
      duration: 0.5,
      stagger: 0.08,
    });

    gsap.from("[data-animate=cta]", {
      scrollTrigger: {
        trigger: ctaRef.current,
        start: "top 80%",
      },
      y: 40,
      opacity: 0,
      duration: 0.7,
    });

    gsap.utils.toArray<HTMLElement>("[data-animate=rule]").forEach((rule) => {
      gsap.from(rule, {
        scaleX: 0,
        transformOrigin: "left center",
        duration: 0.6,
        ease: "power2.inOut",
        scrollTrigger: {
          trigger: rule,
          start: "top 90%",
        },
      });
    });
  });

  return (
    <div className="grain-overlay">
      {/* ── NAV ── */}
      <nav
        data-animate="nav"
        className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-grid flex items-center justify-between px-5 py-3 md:px-12 md:py-4"
      >
        <Link href="/" className="flex items-center gap-2 md:gap-3 shrink-0">
          <Image src="/nobg_notelm-logo.png" alt="NotebookLM" width={28} height={28} />
          <span className="text-mono-label font-bold tracking-widest hidden sm:inline text-ink">
            NOTEBOOK LM
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-mono-label hover:text-accent transition-colors">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden md:inline-block text-mono-label hover:text-accent transition-colors"
          >
            ANMELDEN
          </Link>
          <Link
            href="/register"
            className="hidden md:inline-block bg-accent text-white px-5 py-2 text-mono-label font-bold hover:bg-ink transition-colors"
          >
            KOSTENLOS STARTEN
          </Link>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden flex flex-col justify-center items-center w-10 h-10 gap-1.5"
            aria-label="Menü"
          >
            <span className={`block w-5 h-0.5 bg-ink transition-transform duration-300 ${menuOpen ? "rotate-45 translate-y-2" : ""}`} />
            <span className={`block w-5 h-0.5 bg-ink transition-opacity duration-300 ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block w-5 h-0.5 bg-ink transition-transform duration-300 ${menuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
          </button>
        </div>
      </nav>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* ── HERO ── */}
      <section ref={heroRef} className="notebook-grid-hero overflow-hidden border-b border-grid">
        <div className="grid grid-cols-1 md:grid-cols-12 min-h-[65vh] md:min-h-[75vh]">
          <div className="md:col-span-7 flex flex-col justify-center px-5 py-10 md:px-16 md:py-20">
            <p data-animate="hero-label" className="text-mono-label text-accent mb-3 md:mb-5">
              FORSCHUNGSNOTIZBUCH — KI-GESTÜTZT
            </p>
            <h1 data-animate="hero-title" className="text-hero mb-4 md:mb-7">
              <span className="line block overflow-hidden">Deine</span>
              <span className="line block overflow-hidden">Quellen.</span>
              <span className="line block overflow-hidden text-accent">Klar</span>
              <span className="line block overflow-hidden">verstanden.</span>
            </h1>
            <p data-animate="hero-sub" className="text-mono-data max-w-md mb-5 md:mb-8 leading-relaxed text-ink/60">
              Lade Dokumente, Audios und Videos hoch. Stelle Fragen und erhalte
              präzise Antworten mit nachvollziehbaren Quellen.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                data-animate="hero-cta"
                href="/register"
                className="inline-block bg-ink text-white px-6 py-3 text-mono-label font-bold hover:bg-accent transition-colors"
              >
                KOSTENLOS STARTEN →
              </Link>
              <Link
                data-animate="hero-cta"
                href="#ablauf"
                className="inline-block border border-ink/20 px-6 py-3 text-mono-label font-bold hover:bg-ink hover:text-white transition-colors"
              >
                DEMO ANSEHEN
              </Link>
            </div>
          </div>
          <div className="md:col-span-5 border-l-0 md:border-l border-grid red-margin-line relative bg-paper-muted overflow-hidden min-h-[30vh] md:min-h-0">
            <div ref={heroImageRef} className="absolute inset-0">
              <Image
                data-animate="hero-image"
                src="/pencil-ruler-clip-grid.png"
                alt="KI Research Notebook — Papier, Stift, Lineal"
                width={600}
                height={600}
                className="w-full h-full object-cover mix-blend-multiply"
              />
            </div>
            <span className="absolute bottom-3 right-3 md:bottom-4 md:right-4 text-mono-label opacity-30">
              REF / NB-001
            </span>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="funktionen" ref={featuresRef} className="border-b border-grid notebook-grid">
        <div className="border-b border-grid px-5 py-5 md:px-12 md:py-6">
          <p className="text-mono-label text-accent mb-1">002</p>
          <h2 className="text-section-title">Funktionen</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2">
          {FEATURES.map((f, i) => (
            <div
              key={f.id}
              data-animate="feature"
              className={`border-b border-grid p-6 md:p-10 ${i % 2 === 1 ? "border-l-0 md:border-l border-grid" : ""}`}
            >
              <div className="flex items-start justify-between mb-3 md:mb-4">
                <span className="text-mono-label text-accent font-bold">{f.id}</span>
                <span className="text-mono-label opacity-15">{"///"}</span>
              </div>
              <div className="relative w-full aspect-[4/3] mb-3 md:mb-5 bg-paper-muted overflow-hidden border border-grid">
                <Image
                  data-animate="feature-img"
                  src={f.image}
                  alt={f.title}
                  fill
                  className="object-cover mix-blend-multiply"
                />
              </div>
              <h3 className="text-lg md:text-xl font-black uppercase tracking-tight mb-1.5 md:mb-2">{f.title}</h3>
              <p className="text-mono-data text-ink/60">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── STEPS ── */}
      <section id="ablauf" ref={stepsRef} className="border-b border-grid notebook-grid">
        <div className="border-b border-grid px-5 py-5 md:px-12 md:py-6">
          <p className="text-mono-label text-accent mb-1">003</p>
          <h2 className="text-section-title">So geht&apos;s</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <div
              key={s.num}
              data-animate="step"
              className={`border-b border-grid p-6 md:p-8 sm:border-b-0 ${i > 0 ? "border-t-0 sm:border-t border-grid sm:border-l-0" : ""} ${i % 2 === 1 ? "sm:border-l border-grid" : ""} ${i > 0 ? "md:border-t-0 md:border-l border-grid" : ""}`}
            >
              <span className="text-[clamp(2rem,4vw,4rem)] text-accent/10 font-black leading-none block mb-2 md:mb-3">
                {s.num}
              </span>
              <h3 className="text-sm md:text-base font-black uppercase tracking-tight mb-1.5">{s.title}</h3>
              <p className="text-mono-data text-sm text-ink/60">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── VISUAL BREAK ── */}
      <section className="border-b border-grid overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[45vh] bg-paper-muted overflow-hidden">
            <Image
              data-animate="parallax"
              src="/stationery-flatlay-tape-clips.png"
              alt="Büromaterialien"
              fill
              className="object-cover mix-blend-multiply scale-105"
            />
          </div>
          <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[45vh] bg-paper-muted overflow-hidden border-l-0 md:border-l border-grid">
            <Image
              data-animate="parallax"
              src="/geometric-abstract-grid.png"
              alt="Geometrisches Raster"
              fill
              className="object-cover mix-blend-multiply scale-105"
            />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section ref={ctaRef} className="border-b border-grid notebook-grid">
        <div
          data-animate="cta"
          className="px-5 py-14 md:px-16 md:py-28 text-center"
        >
          <p className="text-mono-label text-accent mb-3">BEREIT?</p>
          <h2 className="text-section-title mb-5 md:mb-7">
            Forschung<br />neu denken.
          </h2>
          <p className="text-mono-data max-w-md mx-auto mb-7 md:mb-9 text-ink/60">
            Starte jetzt kostenlos und erlebe, wie KI deine Quellen versteht.
          </p>
          <Link
            href="/register"
            className="inline-block bg-accent text-white px-9 py-4 md:px-12 md:py-5 text-mono-label font-bold hover:bg-ink transition-colors"
          >
            KOSTENLOS STARTEN →
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-grid notebook-grid px-5 py-6 md:px-12 md:py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/nobg_notelm-logo.png" alt="" width={20} height={20} />
            <span className="text-mono-label opacity-50">© 2025 NOTEBOOK LM</span>
          </div>
          <div className="flex gap-6">
            <Link href="/architektur" className="text-mono-label hover:text-accent transition-colors">
              ARCHITEKTUR
            </Link>
            <Link href="/login" className="text-mono-label hover:text-accent transition-colors">
              ANMELDEN
            </Link>
          </div>
          <span className="text-mono-label opacity-20">REV 1.0</span>
        </div>
      </footer>
    </div>
  );
}
