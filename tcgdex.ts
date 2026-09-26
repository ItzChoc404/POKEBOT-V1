import type { CardSummary, LanguageCode, PokemonCard, PokemonSet } from "./types.js";

const API_ROOT = "https://api.tcgdex.net/v2";
const languageLabels: Record<LanguageCode, string> = {
  en: "English",
  ja: "Japanese",
  "zh-cn": "Chinese (Simplified)",
  "zh-tw": "Chinese (Traditional)",
};

type SeriesSummary = { id: string; name: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "PokemonSetDiscordBot/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`TCGdex returned HTTP ${response.status} for ${new URL(url).pathname}`);
  }
  return (await response.json()) as T;
}

export class TCGdexClient {
  private setCache = new Map<LanguageCode, { expiresAt: number; sets: PokemonSet[] }>();
  private englishRawSets?: unknown[];
  private series?: SeriesSummary[];

  async listSets(language: LanguageCode): Promise<PokemonSet[]> {
    const cached = this.setCache.get(language);
    if (cached && cached.expiresAt > Date.now()) return cached.sets;

    const raw = await fetchJson<unknown[]>(`${API_ROOT}/${language}/sets`);
    const englishRaw = language === "en" ? raw : await this.getEnglishRawSets();
    const englishById = new Map(
      englishRaw.flatMap((value) => {
        const item = asRecord(value);
        return typeof item.id === "string" && typeof item.name === "string"
          ? [[item.id.toLocaleLowerCase(), item.name] as const]
          : [];
      }),
    );
    const series = await this.getSeries();
    const sets: PokemonSet[] = raw.flatMap((value) => {
        const item = asRecord(value);
        if (typeof item.id !== "string" || typeof item.name !== "string") return [];
        const eraId = inferEraId(item.id, language, series);
        const eraName = series.find((entry) => entry.id === eraId)?.name ?? "Other";
        const englishName =
          language === "en"
            ? item.name
            : englishById.get(item.id.toLocaleLowerCase()) ??
              translatedSetName(language, item.id, item.name, eraName);
        return [{
          id: item.id,
          name: item.name,
          language,
          englishName,
          eraId,
          eraName,
          cardCount: item.cardCount as PokemonSet["cardCount"],
        } satisfies PokemonSet];
      });

    this.setCache.set(language, { expiresAt: Date.now() + 60 * 60 * 1000, sets });
    return sets;
  }

  private async getEnglishRawSets(): Promise<unknown[]> {
    if (this.englishRawSets) return this.englishRawSets;
    this.englishRawSets = await fetchJson<unknown[]>(`${API_ROOT}/en/sets`);
    return this.englishRawSets;
  }

  private async getSeries(): Promise<SeriesSummary[]> {
    if (this.series) return this.series;
    const raw = await fetchJson<unknown[]>(`${API_ROOT}/en/series`);
    this.series = raw.flatMap((value) => {
      const item = asRecord(value);
      return typeof item.id === "string" && typeof item.name === "string"
        ? [{ id: item.id, name: item.name }]
        : [];
    });
    return this.series;
  }

  async getSet(language: LanguageCode, setId: string): Promise<{ set: PokemonSet; cards: PokemonCard[] }> {
    const raw = asRecord(
      await fetchJson<unknown>(`${API_ROOT}/${language}/sets/${encodeURIComponent(setId)}`),
    );
    if (typeof raw.id !== "string" || typeof raw.name !== "string") {
      throw new Error("TCGdex returned an invalid set.");
    }

    const listedSet = (await this.listSets(language)).find((item) => item.id === raw.id);
    const set: PokemonSet = {
      id: raw.id,
      name: raw.name,
      language,
      ...(listedSet
        ? {
            englishName: listedSet.englishName,
            eraId: listedSet.eraId,
            eraName: listedSet.eraName,
          }
        : {}),
      cardCount: raw.cardCount as PokemonSet["cardCount"],
    };
    const summaries = Array.isArray(raw.cards)
      ? (raw.cards as unknown[])
          .map((item) => {
            const card = asRecord(item);
            if (
              typeof card.id !== "string" ||
              typeof card.name !== "string" ||
              typeof card.localId !== "string"
            ) {
              return null;
            }
            return { id: card.id, name: card.name, localId: card.localId } satisfies CardSummary;
          })
          .filter((card): card is CardSummary => Boolean(card))
      : [];

    if (summaries.length === 0) {
      throw new Error(`TCGdex did not list any cards for ${set.name}.`);
    }

    const cards = await mapWithConcurrency(summaries, 6, async (summary) => {
      const detail = asRecord(
        await fetchJson<unknown>(`${API_ROOT}/${language}/cards/${encodeURIComponent(summary.id)}`),
      );
      return {
        ...summary,
        ...detail,
        id: summary.id,
        localId: summary.localId,
        name: typeof detail.name === "string" ? detail.name : summary.name,
      } as PokemonCard;
    });

    if (language !== "en") {
      try {
        const englishRaw = asRecord(
          await fetchJson<unknown>(
            `${API_ROOT}/en/sets/${encodeURIComponent(setId.toLowerCase())}`,
          ),
        );
        if (typeof englishRaw.name === "string") set.englishName = englishRaw.name;
        if (Array.isArray(englishRaw.cards)) {
          const namesByNumber = new Map<string, string>();
          for (const entry of englishRaw.cards) {
            const card = asRecord(entry);
            if (typeof card.localId === "string" && typeof card.name === "string") {
              namesByNumber.set(card.localId, card.name);
            }
          }
          for (const card of cards) {
            card.englishName = namesByNumber.get(card.localId);
          }
        }
      } catch {
        // Chinese releases do not always have a one-to-one English set or card number.
      }
    }

    return { set, cards };
  }

  autocompleteLabel(language: LanguageCode, setName: string): string {
    return `${languageLabels[language]} | ${setName}`.slice(0, 100);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      output[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

function inferEraId(setId: string, language: LanguageCode, series: SeriesSummary[]): string {
  const id = setId.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const known = [...series].sort((a, b) => b.id.length - a.id.length);
  const prefix = known.find((entry) => id.startsWith(entry.id.toLocaleLowerCase()));
  if (prefix) return prefix.id;

  if (/^(a|b)\d|^pa$/.test(id)) return "tcgp";
  if (/^me|^m\d/.test(id)) return "me";
  if (/^(sv|svp|csv|\d{4}sv)/.test(id)) return "sv";
  if (/^(swsh|\d{4}swsh)/.test(id)) return "swsh";
  if (/^(s\d|sc|sd|sh|sj|sk|sl|sp|cs\d)/.test(id)) return "swsh";
  if (/^(sm|csm)/.test(id)) return "sm";
  if (/^xy/.test(id)) return "xy";
  if (/^bw/.test(id)) return "bw";
  if (/^(dp|pl)/.test(id)) return id.startsWith("pl") ? "pl" : "dp";
  if (/^(neo|l\d|ll)/.test(id)) return id.startsWith("neo") ? "neo" : "hgss";
  if (/^(pmcg|vs|e\d)/.test(id)) return "base";
  return "misc";
}

function translatedSetName(
  language: LanguageCode,
  setId: string,
  localName: string,
  eraName: string,
): string {
  const key = `${language}:${setId.toLocaleLowerCase()}`;
  const known: Record<string, string> = {
    "ja:pmcg1": "Base Set",
    "ja:pmcg2": "Jungle",
    "ja:pmcg3": "Fossil",
    "ja:pmcg4": "Base Set 2",
    "ja:pmcg5": "Team Rocket",
    "ja:xy1a": "XY Base Set",
    "ja:xy1b": "XY Base Set",
    "ja:xy2": "Flashfire",
    "ja:xy3": "Furious Fists",
    "ja:xy4": "Phantom Forces",
    "ja:sm1s": "Sun & Moon Base Set",
    "ja:sm1m": "Sun & Moon Base Set",
    "ja:s1w": "Sword & Shield Base Set",
    "ja:s1h": "Sword & Shield Base Set",
    "ja:sv1s": "Scarlet & Violet Base Set",
    "ja:sv1v": "Scarlet & Violet Base Set",
    "ja:sv2p": "Paldea Evolved",
    "ja:sv3": "Obsidian Flames",
    "ja:sv4k": "Paradox Rift",
    "ja:sv4m": "Paradox Rift",
    "ja:sv5k": "Temporal Forces",
    "ja:sv5m": "Temporal Forces",
    "ja:sv6": "Twilight Masquerade",
    "ja:sv6a": "Shrouded Fable",
    "ja:sv7": "Stellar Crown",
    "ja:sv8": "Surging Sparks",
    "ja:sv8a": "Prismatic Evolutions",
    "ja:sv9": "Journey Together",
    "ja:sv10": "Destined Rivals",
  };
  if (known[key]) return known[key];
  if (/^[\x00-\x7F]*$/.test(localName) && localName.trim()) return localName;
  return `${eraName} set (${setId})`;
}

export function parseSetChoice(
  value: string,
): { language: LanguageCode; eraId?: string; setId: string } | null {
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const language = parts[0] as LanguageCode;
  const eraId = parts.length >= 3 ? parts[1] : undefined;
  const setId = parts.length >= 3 ? parts.slice(2).join(":") : parts[1];
  if (!["en", "ja", "zh-cn", "zh-tw"].includes(language) || !setId) return null;
  return { language, ...(eraId ? { eraId } : {}), setId };
}