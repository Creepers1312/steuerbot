import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Steuerbot – Steuererstattung schätzen",
    short_name: "Steuerbot",
    description: "Voraussichtliche Steuererstattung für Arbeitnehmer – mit KI-Assistent",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f4",
    theme_color: "#1f6f4a",
    lang: "de",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
