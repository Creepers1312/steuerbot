import { NextResponse, type NextRequest } from "next/server";
import { SITZUNGS_COOKIE, authKonfig, pruefeSitzung } from "@/lib/sicherheit/sitzung";

/**
 * Zentrale Schutzschicht für jede Anfrage:
 *  1. Content-Security-Policy mit Nonce (verhindert eingeschleuste Skripte)
 *  2. Origin-Prüfung für schreibende Anfragen (CSRF-Schutz zusätzlich zu SameSite=Strict)
 *  3. Anmeldung: ohne gültige Sitzung → /login bzw. 401
 */
const OEFFENTLICH = new Set(["/login", "/api/login", "/api/health", "/manifest.webmanifest"]);

function csp(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React setzt style-Attribute; keine externen Styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function gleicherUrsprung(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    } catch {
      return false;
    }
  }
  // Ohne Origin-Header: nur bei eindeutig gleicher Seite (moderne Browser senden Sec-Fetch-Site)
  const site = req.headers.get("sec-fetch-site");
  return site === "same-origin" || site === null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);

  const mitHeadern = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", policy);
    return res;
  };

  // 2. CSRF: schreibende API-Aufrufe nur von der eigenen Seite
  if (req.method !== "GET" && req.method !== "HEAD" && !gleicherUrsprung(req)) {
    return mitHeadern(NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 }));
  }

  // 3. Anmeldung
  const konf = authKonfig();
  if (konf.fehlkonfiguriert && pathname !== "/api/health") {
    return mitHeadern(
      new NextResponse(
        "Steuerbot ist nicht konfiguriert: STEUERBOT_BENUTZER und STEUERBOT_SESSION_SECRET (mind. 32 Zeichen) setzen – siehe README.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      ),
    );
  }
  if (konf.aktiv && !OEFFENTLICH.has(pathname)) {
    const sitzung = await pruefeSitzung(req.cookies.get(SITZUNGS_COOKIE)?.value, konf.geheimnis);
    if (!sitzung) {
      if (pathname.startsWith("/api/")) {
        return mitHeadern(NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 }));
      }
      const ziel = req.nextUrl.clone();
      ziel.pathname = "/login";
      ziel.search = pathname === "/" ? "" : `?weiter=${encodeURIComponent(pathname)}`;
      return mitHeadern(NextResponse.redirect(ziel));
    }
  }

  // 1. Nonce an Next.js weitergeben (wird automatisch an die eigenen Skripte gehängt)
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  return mitHeadern(NextResponse.next({ request: { headers } }));
}

export const config = {
  // Node-Laufzeit: Umgebungsvariablen zur Laufzeit, volle WebCrypto-Unterstützung
  runtime: "nodejs",
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon-192.png|icon-512.png).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
