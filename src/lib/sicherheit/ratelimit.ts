/**
 * Einfaches Rate-Limiting im Speicher (eine Instanz reicht für den Familienbetrieb).
 * Gleitendes Fenster: höchstens `max` Ereignisse je `fensterMs` und Schlüssel.
 */
const speicher = new Map<string, number[]>();

export function erlaubt(schluessel: string, max: number, fensterMs: number): { ok: boolean; wartenSek: number } {
  const jetzt = Date.now();
  const liste = (speicher.get(schluessel) ?? []).filter((t) => jetzt - t < fensterMs);
  if (liste.length >= max) {
    speicher.set(schluessel, liste);
    return { ok: false, wartenSek: Math.ceil((fensterMs - (jetzt - liste[0])) / 1000) };
  }
  liste.push(jetzt);
  speicher.set(schluessel, liste);
  // Speicher begrenzen
  if (speicher.size > 10_000) {
    for (const [k, v] of speicher) if (!v.some((t) => jetzt - t < fensterMs)) speicher.delete(k);
  }
  return { ok: true, wartenSek: 0 };
}

/** Zählt nur, ohne zu buchen (für Sperrprüfung vor dem Login). */
export function anzahl(schluessel: string, fensterMs: number): number {
  const jetzt = Date.now();
  return (speicher.get(schluessel) ?? []).filter((t) => jetzt - t < fensterMs).length;
}

export function zuruecksetzen(schluessel: string) {
  speicher.delete(schluessel);
}

/** Client-IP: hinter dem Reverse-Proxy (STEUERBOT_TRUST_PROXY=1) der letzte Eintrag von X-Forwarded-For. */
export function clientIp(req: Request): string {
  if (process.env.STEUERBOT_TRUST_PROXY === "1") {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",").at(-1)!.trim();
  }
  return req.headers.get("x-real-ip") ?? "direkt";
}

/** IP für Protokolle kürzen (Datenschutz): IPv4 /24, IPv6 /48. */
export function ipGekuerzt(ip: string): string {
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".") + ".0";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::";
  return ip;
}

/** Sicherheitsrelevante Ereignisse strukturiert protokollieren (ohne Passwörter/Steuerdaten). */
export function protokoll(ereignis: string, daten: Record<string, string | number | boolean> = {}) {
  console.log(JSON.stringify({ zeit: new Date().toISOString(), art: "sicherheit", ereignis, ...daten }));
}
