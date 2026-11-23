import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steuerbot",
  description: "Steuererstattung schätzen – mit KI-Assistent für die Familie",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
