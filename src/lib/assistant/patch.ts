import { z } from "zod";
import {
  HAUSHALT_DEFAULTS,
  HaushaltFields,
  KindSchema,
  PERSON_DEFAULTS,
  PersonFields,
  PersonSchema,
  parseTaxInput,
  type TaxInput,
} from "../tax/schema";

/**
 * Änderungen, die der Assistent (oder ein ausgelesener Beleg) am Datenstand vornimmt.
 * Felder sind optional; nur angegebene Werte werden überschrieben.
 */
export const PatchSchema = z.object({
  allgemein: HaushaltFields.partial()
    .optional()
    .describe("Haushaltsweite Angaben: jahr, bundesland, zusammenveranlagung, spenden, krankheitskosten usw."),
  personen: z
    .array(
      z.object({
        index: z.number().int().min(0).max(1).describe("0 = erste Person, 1 = Ehepartner:in"),
        felder: PersonFields.partial(),
      }),
    )
    .optional()
    .describe("Änderungen je Person"),
  kinder: z.array(KindSchema).optional().describe("Ersetzt die komplette Kinderliste"),
});
export type Patch = z.infer<typeof PatchSchema>;

export function applyPatch(input: TaxInput, patch: Patch): TaxInput {
  const next = structuredClone(input) as Record<string, unknown> & TaxInput;
  if (patch.allgemein) {
    for (const [k, v] of Object.entries(patch.allgemein)) {
      if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    }
  }
  // Partner:in anlegen, falls Zusammenveranlagung neu aktiviert wurde
  const roh = { ...next, personen: [...next.personen] };
  for (const p of patch.personen ?? []) {
    while (roh.personen.length <= p.index) roh.personen.push(PersonSchema.parse({ name: "Partner:in" }));
    roh.personen[p.index] = { ...roh.personen[p.index], ...stripUndefined(p.felder) };
  }
  if (patch.kinder) roh.kinder = patch.kinder;
  if (roh.personen.length > 1 && !roh.zusammenveranlagung && patch.personen?.some((p) => p.index === 1)) {
    roh.zusammenveranlagung = true;
  }
  return parseTaxInput(roh);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Kompakte Darstellung für den Prompt: nur Werte, die von den Standardwerten abweichen. */
export function compactInput(input: TaxInput): unknown {
  const defPerson = PERSON_DEFAULTS as Record<string, unknown>;
  const defTop = HAUSHALT_DEFAULTS as Record<string, unknown>;
  const diff = (obj: Record<string, unknown>, def: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(obj).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(def[k])));
  const { personen, kinder, ...rest } = input;
  return {
    ...diff(rest, defTop),
    jahr: input.jahr,
    personen: (input.zusammenveranlagung ? personen : personen.slice(0, 1)).map((p) => diff(p, defPerson)),
    ...(kinder.length ? { kinder } : {}),
  };
}
