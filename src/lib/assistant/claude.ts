import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { berechne, type TaxResult } from "../tax/engine";
import type { TaxInput } from "../tax/schema";
import { GehaltsabrechnungSchema, hochrechnen } from "../tax/hochrechnung";
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
- Für das laufende Jahr gibt es meist noch keine Lohnsteuerbescheinigung (sie kommt im Februar des Folgejahres). Frag dann nach der letzten Gehaltsabrechnung – am besten nach den Jahressummen bis zum Abrechnungsmonat – und nutze \`gehaltsabrechnung_hochrechnen\`. Frag auch nach noch ausstehendem Weihnachtsgeld oder Bonus.

Grenzen:
- Du bist keine Steuerberatung. Bei Selbstständigkeit, Vermietung, Kapitalerträgen über dem Sparerpauschbetrag, Auslandseinkünften, Trennung/Scheidung oder Unterhalt empfiehl eine Steuerberatung oder einen Lohnsteuerhilfeverein; diese Fälle rechnet die App nicht.
- Frage nie nach Steuer-ID, IBAN, Adresse oder Geburtsdatum – die werden für die Schätzung nicht gebraucht.
- Das Ergebnis ist eine Schätzung. Die tatsächliche Erstattung steht erst im Steuerbescheid.

Antworte knapp (meist 2–6 Sätze), mit Euro-Beträgen im Format 1.234 €. Keine Tabellen, kein Markdown außer gelegentlichem **Fettdruck**.`;

const patchJsonSchema = z.toJSONSchema(PatchSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
delete patchJsonSchema.$schema;
const hochrechnungJsonSchema = z.toJSONSchema(
  z.object({
    personIndex: z.number().int().min(0).max(1).describe("0 = erste Person, 1 = Ehepartner:in"),
    abrechnung: GehaltsabrechnungSchema,
  }),
  { io: "input" },
) as Record<string, unknown>;
delete hochrechnungJsonSchema.$schema;

const TOOLS: Anthropic.Beta.BetaTool[] = ([
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
    name: "gehaltsabrechnung_hochrechnen",
    description:
      "Für das laufende Jahr ohne Lohnsteuerbescheinigung: rechnet Werte einer Gehaltsabrechnung (Monatswerte oder Jahressummen bis zum Abrechnungsmonat) auf das ganze Jahr hoch und speichert sie bei der angegebenen Person. Liefert die neue Schätzung.",
    input_schema: hochrechnungJsonSchema as Anthropic.Beta.BetaTool.InputSchema,
  },
  {
    name: "berechnung_anzeigen",
    description:
      "Liefert den aktuellen Datenstand und die vollständige Berechnung (Einkünfte, Werbungskosten, Sonderausgaben, zu versteuerndes Einkommen, Steuer, Erstattung, Hinweise).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
] satisfies Anthropic.Beta.BetaTool[]).map((t) => ({ ...t, eager_input_streaming: true }));

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

const HochrechnungToolSchema = z.object({
  personIndex: z.number().int().min(0).max(1),
  abrechnung: GehaltsabrechnungSchema,
});

function runTool(name: string, rawInput: unknown, input: TaxInput): ToolOutcome {
  try {
    if (name === "berechnung_anzeigen") {
      return { content: JSON.stringify({ datenstand: compactInput(input), berechnung: berechne(input) }) };
    }
    if (name === "gehaltsabrechnung_hochrechnen") {
      const parsed = HochrechnungToolSchema.safeParse(rawInput);
      if (!parsed.success) return { content: `Ungültige Eingabe: ${z.prettifyError(parsed.error)}`, isError: true };
      const werte = hochrechnen(parsed.data.abrechnung, input.jahr);
      const vorher = berechne(input).erstattung;
      const next = applyPatch(input, {
        personen: [
          { index: parsed.data.personIndex, felder: { ...werte, ...(werte.kirchensteuerEinbehalten > 0 ? { kirchenmitglied: true } : {}) } },
        ],
      });
      const nachher = berechne(next);
      return {
        content: JSON.stringify({
          gespeichert: true,
          hochgerechneteJahreswerte: werte,
          ...resultSummary(nachher),
          differenzZuVorher: Math.round((nachher.erstattung - vorher) * 100) / 100,
        }),
        newInput: next,
      };
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

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "status"; text: string }
  | { type: "input"; input: TaxInput }
  | { type: "done"; messages: Anthropic.Beta.BetaMessageParam[]; reply: string }
  | { type: "error"; error: string };

const TOOL_STATUS: Record<string, string> = {
  daten_aktualisieren: "trägt ein …",
  was_waere_wenn: "rechnet durch …",
  berechnung_anzeigen: "schaut in die Berechnung …",
  gehaltsabrechnung_hochrechnen: "rechnet aufs Jahr hoch …",
};

/**
 * Ein Gesprächszug mit Streaming: Text-Häppchen, Datenstand-Änderungen und am Ende
 * der vollständige Verlauf (inkl. Thinking-Blöcke) werden als Ereignisse gemeldet.
 */
export async function chatTurn(
  history: Anthropic.Beta.BetaMessageParam[],
  userText: string,
  startInput: TaxInput,
  emit: (e: ChatEvent) => void,
): Promise<void> {
  let input = startInput;
  const heute = new Date().toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history,
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        {
          type: "text",
          text: `<kontext>Heute ist der ${heute}.</kontext>\n<aktueller_datenstand>\n${JSON.stringify(compactInput(input))}\n</aktueller_datenstand>\n<aktuelle_schaetzung>\n${JSON.stringify(resultSummary(berechne(input)))}\n</aktuelle_schaetzung>`,
        },
      ],
    },
  ];

  const replyParts: string[] = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    let textInRound = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (!textInRound && replyParts.length) emit({ type: "text", delta: "\n\n" });
        textInRound += event.delta.text;
        emit({ type: "text", delta: event.delta.text });
      } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        emit({ type: "status", text: TOOL_STATUS[event.content_block.name] ?? "arbeitet …" });
      }
    }
    const response = await stream.finalMessage();
    if (textInRound.trim()) replyParts.push(textInRound.trim());

    if (response.stop_reason === "refusal") {
      const hinweis = "Dazu kann ich leider nichts sagen. Formuliere die Frage gern anders.";
      emit({ type: "text", delta: (textInRound ? "\n\n" : "") + hinweis });
      replyParts.push(hinweis);
      break; // abgelehnte Antwort nicht in den Verlauf übernehmen
    }

    // Vollständigen Inhalt (inkl. Thinking-Blöcke) übernehmen
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason === "max_tokens") {
      const hinweis = "(Antwort wurde abgeschnitten – frag gern nach.)";
      emit({ type: "text", delta: "\n\n" + hinweis });
      replyParts.push(hinweis);
      // Unvollständige Werkzeugaufrufe nicht ausführen
      if (response.content.some((b) => b.type === "tool_use")) messages.pop();
      break;
    }
    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const out = runTool(block.name, block.input, input);
      if (out.newInput) {
        input = out.newInput;
        emit({ type: "input", input });
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: out.content, is_error: out.isError });
    }
    messages.push({ role: "user", content: toolResults });
  }

  emit({ type: "done", messages, reply: replyParts.join("\n\n") || "…" });
}

// ---------------------------------------------------------------------------
// Belege auslesen
// ---------------------------------------------------------------------------

const num = (beschreibung: string) => z.number().nullable().describe(beschreibung);

export const BelegSchema = z.object({
  belegart: z.enum([
    "lohnsteuerbescheinigung",
    "gehaltsabrechnung",
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
  gehaltsabrechnung: z
    .object({
      monat: num("Abrechnungsmonat 1–12"),
      monatswerte: z
        .object({
          brutto: num("Steuerbrutto des Monats"),
          lohnsteuer: num("Lohnsteuer des Monats"),
          soli: num("Solidaritätszuschlag des Monats"),
          kirchensteuer: num("Kirchensteuer des Monats"),
          rv: num("Rentenversicherung Arbeitnehmeranteil des Monats"),
          kv: num("Krankenversicherung Arbeitnehmeranteil des Monats"),
          pv: num("Pflegeversicherung Arbeitnehmeranteil des Monats"),
          av: num("Arbeitslosenversicherung Arbeitnehmeranteil des Monats"),
        })
        .nullable(),
      jahressummen: z
        .object({
          brutto: num("Steuerbrutto kumuliert seit Januar"),
          lohnsteuer: num("Lohnsteuer kumuliert"),
          soli: num("Soli kumuliert"),
          kirchensteuer: num("Kirchensteuer kumuliert"),
          rv: num("RV-AN kumuliert"),
          kv: num("KV-AN kumuliert"),
          pv: num("PV-AN kumuliert"),
          av: num("AV-AN kumuliert"),
        })
        .nullable()
        .describe("Nur falls die Abrechnung Jahres-/kumulierte Summen ausweist"),
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
