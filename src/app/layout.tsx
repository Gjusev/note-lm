import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-provider";
import { ToastProvider } from "@/components/ui/toaster";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "KI Research Notebook",
  description:
    "Lade Dokumente, Audios und Videos hoch. Stelle Fragen und erhalte präzise Antworten mit nachvollziehbaren Quellen.",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={`${inter.variable} ${jetbrains.variable} font-sans antialiased`}>
        <ConvexClientProvider>
          <ToastProvider>{children}</ToastProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
