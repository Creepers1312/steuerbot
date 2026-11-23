import { NextResponse, type NextRequest } from "next/server";

/**
 * Optionaler Passwortschutz (HTTP Basic Auth) für den Betrieb im Internet,
 * damit Fremde nicht über deinen Claude-API-Schlüssel chatten.
 * Aktiv, sobald STEUERBOT_PASSWORT gesetzt ist. Benutzername beliebig.
 */
export function middleware(req: NextRequest) {
  const passwort = process.env.STEUERBOT_PASSWORT;
  if (!passwort) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const pw = decoded.slice(decoded.indexOf(":") + 1);
    if (pw === passwort) return NextResponse.next();
  }
  return new NextResponse("Anmeldung erforderlich", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Steuerbot", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.png|apple-icon.png|icon-192.png|icon-512.png).*)"] };
