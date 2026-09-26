# Pokémon set Discord bot

The bot posts Pokémon card sets from TCGdex, including Japanese and Simplified/Traditional Chinese sets, searches configured Discord channels for matching posts, and adds prices from PriceCharting when API access is configured.

## Start it

1. Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**, enable the privileged **Message Content Intent**. The bot reads configured channel history to locate matching cards.
3. Add `DISCORD_BOT_TOKEN` as a Replit Secret.
4. Start the **Pokémon Discord Bot** workflow. It registers slash commands and prints a server-install link to the workflow log.
5. Open that link, select the server, and install the bot.
6. Grant it View Channel, Send Messages, Embed Links, Read Message History, Create Public Threads, and Send Messages in Threads in the channels where it will post/search.
7. In the server, use `/locateadd channel:<channel>` to choose channels the bot should search.

The invite URL uses `scope=bot applications.commands`; its application ID is read from the bot token/API when the service starts. A template, if you need to build the link yourself, is:

`https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=309237816336&scope=bot%20applications.commands`

## Commands

- `/set language:<language> era:<era> subset:<subset>` — choose a language, era, and set, then choose a forum. The forum post contains only the set summary/statistics and a sort dropdown. Sorting loads the full card list privately for the person who selected it; it does not create one public message per card.
- `/locate name:<card name> number:<card number>` — search configured channels and public threads for both the card name and number.
- `/locateadd channel:<channel>` — add a text or forum channel to the locate range. Forums and their public threads are supported.
- `/locaterange ...` — legacy add/remove/list configuration remains available.
- `/auctionpage add|remove|list` — configure text/forum channels where tagged verified posts become auctions. `/auctionpage ownerrole role:<role>` lets that role bid on its own auctions.
- `/buypagelocate add|remove|list` — configure forums where the bot automatically adds a buy-listing message with Negotiate and Buy now buttons.
- `/buy` — manually open a negotiation ticket for the current buy listing thread.
- `/ticket setup` — administrator panel setup. Enter `Category ID | Panel channel ID`, then `Staff ID | optional ping ID | optional log ID | optional name format | optional middleman ID | optional dispute ID` in the setup form. The bot stores the panel and posts its button.
- `/ticket open` — open a private support ticket using the saved setup. Buyer/seller tickets are created by marketplace and auction buttons.
- `/auction create title:<title>` — create an auction from the latest message in the current channel. The message must include labeled `Starting bid` and `Buy now` prices. The listing has buttons for placing/changing a bid, buying immediately, and ending the auction.
- `/auction end auction_id:<id>` — end one of your auctions. Server managers can end any auction.

Set publishing no longer scans for matches or posts “another copy” cross-links. `/locate` is the only card search flow. Tagged auction forum posts are processed automatically, and buy-page forum posts receive a private-ticket panel automatically.

## Tickets and auctions

Ticket and auction participants are identified by their Discord account IDs. A panel ticket is private to the creator, configured staff role, and bot. Marketplace and auction buy clicks create private buyer/seller tickets with **Middleman** and **Dispute** controls. Closing a configured panel ticket posts a transcript summary to its configured log channel. Auction bids must be higher than the current bid and below the buy-now price; the configured owner role may also bid on its own auction.

## PriceCharting price data

PriceCharting requires a paid subscription and an API token. Add the token as the `PRICECHARTING_API_TOKEN` Replit Secret. Card prices use PriceCharting's ungraded (`loose-price`) value, returned in USD. Some cards may not have a matching listing or a reported price; card/set publishing still works when prices are unavailable.

PriceCharting's API token is tied to the guide and access purchased with the subscription. A rejected token or missing paid API access leaves card/set publishing available but disables price lookups.

TCGdex language codes are `ja` for Japanese, `zh-cn` for Simplified Chinese, and `zh-tw` for Traditional Chinese.

## Development

- `pnpm --filter @workspace/scripts run pokemon-bot` — start the bot process
- `pnpm --filter @workspace/scripts run typecheck` — typecheck the bot and scripts package

Runtime settings and tracked posts are saved locally in `scripts/data/pokemon-discord-bot-state.json` and excluded from Git.