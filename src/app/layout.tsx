import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steuerbot",
  description: "Steuererstattung schätzen – mit KI-Assistent für die Familie",
  appleWebApp: { capable: true, title: "Steuerbot", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android: Tastatur verkleinert den sichtbaren Bereich, damit die Chat-Eingabe sichtbar bleibt
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#121513" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Dynamisch rendern, damit Next.js die CSP-Nonce aus der Middleware an seine Skripte hängt
  await headers();
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
