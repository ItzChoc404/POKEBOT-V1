import { DiscordRest, truncate } from "./discord-rest.js";
import type { StateStore } from "./state.js";
import type { PriceChartingClient } from "./pricecharting.js";
import type {
  DiscordChannel,
  PokemonCard,
  PokemonSet,
} from "./types.js";

const FORUM_CHANNEL = 15;

export class SetPublisher {
  constructor(
    private readonly rest: DiscordRest,
    private readonly state: StateStore,
    private readonly market: PriceChartingClient,
  ) {}

  async publish(
    guildId: string,
    destinationId: string,
    set: PokemonSet,
    cards: PokemonCard[],
    onProgress: (completed: number, total: number) => Promise<void>,
  ): Promise<number> {
    const destination: DiscordChannel = await this.rest.channel(destinationId);
    if (destination.guild_id !== guildId || destination.type !== FORUM_CHANNEL) {
      throw new Error("Choose a forum channel in this server.");
    }

    const setPost = await this.rest.createThread(destinationId, {
      name: truncate(`${set.englishName ?? set.name} · ${languageLabel(set.language)}`, 100),
      auto_archive_duration: 10080,
      message: {
        content: `**${set.englishName ?? set.name}** · ${languageLabel(set.language)}`,
        embeds: [setSummaryEmbed(set, cards)],
        components: [setSortComponents(set)],
        allowed_mentions: { parse: [] },
      },
    });
    await onProgress(cards.length, cards.length);
    return setPost.id ? cards.length : 0;
  }
}

function languageLabel(language: PokemonSet["language"]): string {
  if (language === "en") return "English";
  if (language === "ja") return "Japanese";
  return language === "zh-cn" ? "Chinese" : "Chinese (Traditional)";
}

function setSummaryEmbed(set: PokemonSet, cards: PokemonCard[]) {
  const total = set.cardCount?.total ?? cards.length;
  const official = set.cardCount?.official;
  return {
    title: truncate(set.englishName ?? set.name, 256),
    description: [
      `**Language:** ${languageLabel(set.language)}`,
      set.eraName ? `**Era:** ${set.eraName}` : "",
      `**Set ID:** \`${set.id}\``,
    ].filter(Boolean).join("\n"),
    color: 0x3b82f6,
    fields: [
      { name: "Total cards", value: String(total), inline: true },
      ...(official !== undefined ? [{ name: "Official cards", value: String(official), inline: true }] : []),
      { name: "Loaded cards", value: String(cards.length), inline: true },
      { name: "How to browse", value: "Use the dropdown below to view every card privately, sorted by name, number, or rarity." },
    ],
    footer: { text: "TCGdex set summary" },
  };
}

function setSortComponents(set: PokemonSet) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `set-sort|${set.language}|${set.id}`,
      placeholder: "Sort and view all cards",
      options: [
        { label: "A–Z", value: "name-asc", description: "Alphabetical card names" },
        { label: "Card number", value: "number", description: "Lowest card number first" },
        { label: "Rarity", value: "rarity", description: "Rarity, then card name" },
      ],
    }],
  };
}