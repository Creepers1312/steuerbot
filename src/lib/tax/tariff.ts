import type { TariffZones } from "./params";

/** Einkommensteuer nach Grundtarif (§ 32a Abs. 1 EStG), auf volle Euro abgerundet. */
export function grundtarif(zvE: number, t: TariffZones): number {
  const x = Math.floor(Math.max(0, zvE));
  let tax: number;
  if (x <= t.grundfreibetrag) {
    tax = 0;
  } else if (x <= t.zone2End) {
    const y = (x - t.grundfreibetrag) / 10_000;
    tax = (t.zone2A * y + t.zone2B) * y;
  } else if (x <= t.zone3End) {
    const z = (x - t.zone2End) / 10_000;
    tax = (t.zone3A * z + t.zone3B) * z + t.zone3C;
  } else if (x <= t.zone4End) {
    tax = 0.42 * x - t.zone4D;
  } else {
    tax = 0.45 * x - t.zone5E;
  }
  return Math.floor(tax);
}

/** Splittingtarif (§ 32a Abs. 5 EStG): 2 × Grundtarif der Hälfte. */
export function splittingtarif(zvE: number, t: TariffZones): number {
  return 2 * grundtarif(Math.floor(Math.max(0, zvE)) / 2, t);
}

function tarif(zvE: number, t: TariffZones, splitting: boolean): number {
  return splitting ? splittingtarif(zvE, t) : grundtarif(zvE, t);
}

/**
 * Einkommensteuer unter Progressionsvorbehalt (§ 32b EStG): Der Steuersatz
 * wird auf zvE + Lohnersatzleistungen ermittelt, aber nur auf das zvE angewendet.
 */
export function tarifMitProgressionsvorbehalt(
  zvE: number,
  progressionsBetrag: number,
  t: TariffZones,
  splitting: boolean,
): number {
  const x = Math.floor(Math.max(0, zvE));
  if (progressionsBetrag <= 0 || x === 0) return tarif(x, t, splitting);
  const basis = Math.floor(x + progressionsBetrag);
  const satz = tarif(basis, t, splitting) / basis;
  return Math.floor(x * satz);
}

/** Grenzsteuersatz (für Erklärungen: „jeder weitere Euro Abzug spart X Cent“). */
export function grenzsteuersatz(zvE: number, t: TariffZones, splitting: boolean): number {
  const a = tarif(zvE, t, splitting);
  const b = tarif(zvE + 100, t, splitting);
  return Math.max(0, (b - a) / 100);
}
