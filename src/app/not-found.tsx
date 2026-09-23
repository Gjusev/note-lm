import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <p className="text-mono-label text-accent mb-4">&#91; 404 &#93;</p>
        <h1 className="text-hero text-[clamp(3rem,8vw,8rem)] leading-none mb-4">
          <span className="block text-accent">404</span>
        </h1>
        <p className="text-mono-data mb-8">
          Diese Seite wurde nicht gefunden.
        </p>
        <Link
          href="/"
          className="inline-block bg-accent text-white border-2 border-accent px-8 py-4 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors"
        >
          ZUR STARTSEITE
        </Link>
      </div>
    </div>
  );
}
