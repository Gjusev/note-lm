/**
 * Ambient type for Vite asset imports: `...?url` yields the emitted asset's
 * URL string at runtime. Only the desktop build uses this pattern (the pdf.js
 * worker); the Next.js web app never imports with ?url.
 */
declare module "*?url" {
  const url: string;
  export default url;
}
