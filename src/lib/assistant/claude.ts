import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { berechne, type TaxResult } from "../tax/engine";
import type { TaxInput } from "../tax/schema";
import { PatchSchema, applyPatch, compactInput } from "./patch";

export const MODEL = process.env.STEUERBOT_MODEL ?? "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;

let client: Anthropic | undefined;
function getClient() {
  client ??= new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `Du bist „Steuerbot“, ein freundlicher Helfer für die deutsche Einkommensteuererklärung von Arbeitnehmer:innen in einer Familie. Du sprichst Deutsch, duzt die Nutzer:innen und erklärst Steuerbegriffe in einfachen Worten.

Deine Aufgabe:
- Führe ein lockeres Interview, um die Angaben für die Steuererklärung zu sammeln (Lohnsteuerbescheinigung, Arbeitsweg, Homeoffice, Arbeitsmittel, Fortbildung, Kinder, Spenden, Handwerker, haushaltsnahe Dienstleistungen, Krankheitskosten, Kirchensteuer …).
- Stelle pro Nachricht höchstens zwei Fragen. Beginne mit den Dingen, die am meisten bringen.
- Trage jede neue Angabe sofort mit dem Werkzeug \`daten_aktualisieren\` ein. Frage nach, wenn ein Wert unklar ist, statt zu raten.
- Rechne NIE selbst Steuern aus. Die Zahlen kommen ausschließlich aus den Werkzeugen. Nenne die voraussichtliche Erstattung so, wie das Werkzeug sie liefert.
- Nutze \`was_waere_wenn\`, um zu zeigen, wie viel ein möglicher Abzug bringen würde, bevor du danach fragst (z. B. „Wenn du einen Laptop für 1.000 € gekauft hast, bringt das etwa X €“).
- Weise auf typische vergessene Posten hin, aber nur, wenn sie zur Situation passen.
- Wenn Werbungskosten unter dem Arbeitnehmer-Pauschbetrag liegen, erkläre, dass kleine Belege dann nichts bringen.

Grenzen:
- Du bist keine Steuerberatung. Bei Selbstständigkeit, Vermietung, Kapitalerträgen über dem Sparerpauschbetrag, Auslandseinkünften, Trennung/Scheidung oder Unterhalt empfiehl eine Steuerberatung oder einen Lohnsteuerhilfeverein; diese Fälle rechnet die App nicht.
- Frage nie nach Steuer-ID, IBAN, Adresse oder Geburtsdatum – die werden für die Schätzung nicht gebraucht.
- Das Ergebnis ist eine Schätzung. Die tatsächliche Erstattung steht erst im Steuerbescheid.

Antworte knapp (meist 2–6 Sätze), mit Euro-Beträgen im Format 1.234 €. Keine Tabellen, kein Markdown außer gelegentlichem **Fettdruck**.`;

const patchJsonSchema = z.toJSONSchema(PatchSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
delete patchJsonSchema.$schema;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "daten_aktualisieren",
    description:
      "Speichert neue oder geänderte Angaben im Datenstand des Haushalts und liefert die neu berechnete voraussichtliche Erstattung. Nur Felder angeben, die sich ändern. Beträge in Euro pro Jahr.",
    input_schema: patchJsonSchema as Anthropic.Beta.BetaTool.InputSchema,
  },
  {
    name: "was_waere_wenn",
    description:
      "Berechnet hypothetisch, wie sich Änderungen auf die Erstattung auswirken würden, OHNE sie zu speichern. Liefert die Differenz zur aktuellen Erstattung.",
    input_schema: patchJsonSchema as Anthropic.Beta.BetaTool.InputSchema,
  },
  {
    name: "berechnung_anzeigen",
    description:
      "Liefert den aktuellen Datenstand und die vollständige Berechnung (Einkünfte, Werbungskosten, Sonderausgaben, zu versteuerndes Einkommen, Steuer, Erstattung, Hinweise).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export function resultSummary(r: TaxResult) {
  return {
    voraussichtlicheErstattung: r.erstattung,
    bedeutung: r.erstattung >= 0 ? "Erstattung" : "Nachzahlung",
    steuerGeschuldet: r.steuerGesamt,
    bereitsGezahlt: r.bereitsGezahlt.gesamt,
    zuVersteuerndesEinkommen: r.zvE,
    grenzsteuersatzProzent: Math.round(r.grenzsteuersatz * 1000) / 10,
    werbungskosten: r.personen.map((p) => ({
      name: p.name,
      angesetzt: p.werbungskostenAngesetzt,
      tatsaechlich: p.werbungskostenTatsaechlich,
      pauschbetragGenutzt: p.pauschbetragGenutzt,
    })),
    hinweise: r.hinweise,
  };
}

interface ToolOutcome {
  content: string;
  isError?: boolean;
  newInput?: TaxInput;
}

function runTool(name: string, rawInput: unknown, input: TaxInput): ToolOutcome {
  try {
    if (name === "berechnung_anzeigen") {
      return { content: JSON.stringify({ datenstand: compactInput(input), berechnung: berechne(input) }) };
    }
    if (name === "daten_aktualisieren" || name === "was_waere_wenn") {
      const parsed = PatchSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { content: `Ungültige Eingabe: ${z.prettifyError(parsed.error)}`, isError: true };
      }
      const next = applyPatch(input, parsed.data);
      const vorher = berechne(input).erstattung;
      const nachher = berechne(next);
      if (name === "was_waere_wenn") {
        return {
          content: JSON.stringify({
            erstattungAktuell: vorher,
            erstattungMitAenderung: nachher.erstattung,
            differenz: Math.round((nachher.erstattung - vorher) * 100) / 100,
          }),
        };
      }
      return {
        content: JSON.stringify({ gespeichert: true, ...resultSummary(nachher), differenzZuVorher: Math.round((nachher.erstattung - vorher) * 100) / 100 }),
        newInput: next,
      };
    }
    return { content: `Unbekanntes Werkzeug: ${name}`, isError: true };
  } catch (e) {
    return { content: `Fehler: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}

export interface ChatTurnResult {
  messages: Anthropic.Beta.BetaMessageParam[];
  input: TaxInput;
  reply: string;
  changed: boolean;
}

/**
 * Ein Gesprächszug: Nutzer-Nachricht anhängen, Werkzeug-Schleife ausführen,
 * aktualisierten Verlauf + Datenstand zurückgeben.
 */
export async function chatTurn(
  history: Anthropic.Beta.BetaMessageParam[],
  userText: string,
  startInput: TaxInput,
): Promise<ChatTurnResult> {
  let input = startInput;
  let changed = false;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history,
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        {
          type: "text",
          text: `<aktueller_datenstand>\n${JSON.stringify(compactInput(input))}\n</aktueller_datenstand>\n<aktuelle_schaetzung>\n${JSON.stringify(resultSummary(berechne(input)))}\n</aktuelle_schaetzung>`,
        },
      ],
    },
  ];

  const replyParts: string[] = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      replyParts.push("Dazu kann ich leider nichts sagen. Formuliere die Frage gern anders.");
      // Abgelehnte Antwort nicht in den Verlauf übernehmen
      break;
    }

    // Vollständigen Inhalt (inkl. Thinking-Blöcke) übernehmen
    messages.push({ role: "assistant", content: response.content });
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) replyParts.push(block.text.trim());
    }

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const out = runTool(block.name, block.input, input);
      if (out.newInput) {
        input = out.newInput;
        changed = true;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: out.content, is_error: out.isError });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { messages, input, reply: replyParts.join("\n\n") || "…", changed };
}

// ---------------------------------------------------------------------------
// Belege auslesen
// ---------------------------------------------------------------------------

const num = (beschreibung: string) => z.number().nullable().describe(beschreibung);

export const BelegSchema = z.object({
  belegart: z.enum([
    "lohnsteuerbescheinigung",
    "handwerkerrechnung",
    "haushaltsnahe_dienstleistung",
    "spendenquittung",
    "krankheitskosten",
    "arbeitsmittel",
    "fortbildung",
    "kinderbetreuung",
    "nebenkostenabrechnung",
    "sonstiges",
  ]),
  beschreibung: z.string().describe("Ein Satz: was ist das für ein Beleg (Aussteller, Datum, Zweck)"),
  steuerjahr: num("Steuerjahr, auf das sich der Beleg bezieht"),
  betragGesamt: num("Gesamtbetrag brutto in Euro"),
  lohnkostenAnteil: num("Bei Handwerker/haushaltsnahen Leistungen: Arbeits- und Fahrtkosten inkl. MwSt, ohne Material"),
  lohnsteuerbescheinigung: z
    .object({
      bruttolohn: num("Zeile 3"),
      lohnsteuer: num("Zeile 4"),
      soli: num("Zeile 5"),
      kirchensteuer: num("Zeile 6 + 7"),
      rvArbeitgeber: num("Zeile 22a"),
      rvArbeitnehmer: num("Zeile 23a"),
      kvArbeitnehmer: num("Zeile 25"),
      pvArbeitnehmer: num("Zeile 26"),
      avArbeitnehmer: num("Zeile 27"),
      lohnersatzleistungen: num("Zeile 15 Kurzarbeitergeld u. ä."),
    })
    .nullable(),
  unsicherheiten: z.array(z.string()).describe("Werte, die schlecht lesbar oder mehrdeutig waren"),
});
export type Beleg = z.infer<typeof BelegSchema>;

export async function belegAuslesen(
  data: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf",
): Promise<Beleg> {
  const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
  const file: Anthropic.Beta.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16_000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(BelegSchema) },
    messages: [
      {
        role: "user",
        content: [
          file,
          {
            type: "text",
            text: "Lies diesen Beleg für die deutsche Einkommensteuererklärung aus. Übernimm nur Beträge, die tatsächlich auf dem Beleg stehen; fehlende Werte sind null. Bei einer Lohnsteuerbescheinigung die Zeilennummern beachten. Persönliche Kennungen (Steuer-ID, eTIN, Adresse) nicht übernehmen.",
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("Der Beleg konnte nicht ausgelesen werden.");
  }
  return response.parsed_output;
}
