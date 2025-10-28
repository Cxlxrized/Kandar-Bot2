// index.js
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  ComponentType,
} from "discord.js";
import "dotenv/config";
import fs from "fs";
import fetch from "node-fetch";

/* =========================================
   Setup & Helpers
========================================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
});

if (!fs.existsSync("./data")) fs.mkdirSync("./data");
const PATHS = {
  giveaways: "./data/giveaways.json",
  creators: "./data/creators.json",
  inventory: "./data/inventory.json",
  orders: "./data/orders.json",
  streamers: "./data/streamers.json",
};
for (const p of Object.values(PATHS)) if (!fs.existsSync(p)) fs.writeFileSync(p, "[]");

const BANNER_URL = "https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif";
const BRAND_COLOR = "#9B5DE5";
const BRAND_FOOTER = "Kandar Shop";
const TEAM_ROLE_IDS = (process.env.TEAM_ROLE_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const isTeam = (member) => TEAM_ROLE_IDS.some(id => member.roles.cache.has(id));

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2));

function parseDuration(str) {
  if (!str) return 0;
  const m = String(str).toLowerCase().match(/^(\d+d)?(\d+h)?(\d+m)?$/);
  if (!m) return 0;
  let ms = 0;
  if (m[1]) ms += parseInt(m[1]) * 86400000;
  if (m[2]) ms += parseInt(m[2]) * 3600000;
  if (m[3]) ms += parseInt(m[3]) * 60000;
  return ms;
}

function fmtCurrency(eurNumber) {
  // akzeptiert Centbeträge z.B. 12.34
  return Number(eurNumber).toFixed(2);
}

function ensureFileArray(path) {
  try { const v = readJSON(path); if (Array.isArray(v)) return v; } catch {}
  writeJSON(path, []);
  return [];
}

/* =========================================
   Slash Commands
========================================= */
const commands = [
  // PayPal
  new SlashCommandBuilder()
    .setName("paypal")
    .setDescription("Erstellt einen PayPal-Zahlungslink")
    .addNumberOption(o =>
      o.setName("betrag").setDescription("Betrag in Euro (z.B. 12.34)").setRequired(true)
    ),

  // Tickets Panel
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Sendet das Ticket-Panel (Dropdown)"),

  // Verify
  new SlashCommandBuilder()
    .setName("verifymsg")
    .setDescription("Sendet die Verify-Nachricht"),

  // Nuke
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Löscht viele Nachrichten im aktuellen Channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // Creator
  new SlashCommandBuilder()
    .setName("creator")
    .setDescription("Creator-System verwalten")
    .addSubcommand(sub =>
      sub.setName("add").setDescription("Erstellt ein Creator-Panel mit Social-Links")
    ),

  // Embed
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Erstellt ein Embed über Modal"),

  // Giveaways
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Starte ein neues Giveaway")
    .addStringOption(o => o.setName("preis").setDescription("Preis").setRequired(true))
    .addStringOption(o => o.setName("dauer").setDescription("z. B. 1d, 2h, 30m").setRequired(true))
    .addIntegerOption(o => o.setName("gewinner").setDescription("Anzahl der Gewinner").setRequired(true)),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Ziehe neue Gewinner für ein Giveaway")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID des Giveaways").setRequired(true)),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Beende ein Giveaway vorzeitig")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID des Giveaways").setRequired(true)),

  // Shop-Inventar
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Artikel im Sortiment verwalten")
    .addSubcommand(s =>
      s.setName("add").setDescription("Artikel hinzufügen")
        .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
        .addNumberOption(o => o.setName("preis").setDescription("Preis in Euro, z.B. 12.34").setRequired(true))
    )
    .addSubcommand(s =>
      s.setName("remove").setDescription("Artikel entfernen")
        .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
    )
    .addSubcommand(s =>
      s.setName("list").setDescription("Alle Artikel anzeigen")
    ),

  // Order-System (kein Ticket, läuft im Channel)
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Neue Bestellung starten")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),

  // Finish (Team only, startet Feedback)
  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Bestellung/Ticket abschließen & Feedback einholen (Team)")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),

  // Streamer Auto-Announce
  new SlashCommandBuilder()
    .setName("streamer")
    .setDescription("Streamer Auto-Announce verwalten")
    .addSubcommand(s =>
      s.setName("add").setDescription("Streamer hinzufügen (Auto-Announce in diesem Channel)")
        .addStringOption(o => o.setName("name").setDescription("Twitch-Name").setRequired(true))
    )
    .addSubcommand(s =>
      s.setName("remove").setDescription("Streamer entfernen")
        .addStringOption(o => o.setName("name").setDescription("Twitch-Name").setRequired(true))
    )
    .addSubcommand(s =>
      s.setName("list").setDescription("Streamer-Liste anzeigen")
    ),
].map(c => c.toJSON());

// Commands registrieren
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash Commands registriert!");
  } catch (err) {
    console.error("❌ Fehler beim Registrieren:", err);
  }
})();

/* =========================================
   Ready: Server Stats + Re-Arm Giveaways + Start Streamer Poll
========================================= */
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    // Server Stats
    const categoryName = "📊 Server Stats";
    let category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
    if (!category)
      category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });

    const stats = {
      members: "🧍‍♂️ Mitglieder",
      online: "💻 Online",
      bots: "🤖 Bots",
      boosts: "💎 Boosts"
    };

    for (const name of Object.values(stats)) {
      if (!guild.channels.cache.find(c => c.parentId === category.id && c.name.startsWith(name))) {
        await guild.channels.create({
          name: `${name}: 0`,
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] }]
        });
      }
    }

    async function updateStats() {
      const members = guild.members.cache;
      const online = members.filter(m => m.presence && m.presence.status !== "offline").size;
      const bots = members.filter(m => m.user.bot).size;
      const humans = members.size - bots;
      const boosts = guild.premiumSubscriptionCount || 0;

      const channels = {
        members: guild.channels.cache.find(c => c.name.startsWith(stats.members)),
        online: guild.channels.cache.find(c => c.name.startsWith(stats.online)),
        bots: guild.channels.cache.find(c => c.name.startsWith(stats.bots)),
        boosts: guild.channels.cache.find(c => c.name.startsWith(stats.boosts)),
      };

      if (channels.members) await channels.members.setName(`${stats.members}: ${humans}`);
      if (channels.online) await channels.online.setName(`${stats.online}: ${online}`);
      if (channels.bots) await channels.bots.setName(`${stats.bots}: ${bots}`);
      if (channels.boosts) await channels.boosts.setName(`${stats.boosts}: ${boosts}`);
    }
    updateStats();
    setInterval(updateStats, 5 * 60 * 1000);
  }

  // offene Giveaways reaktivieren
  const giveaways = ensureFileArray(PATHS.giveaways);
  for (const g of giveaways.filter(x => !x.beendet)) {
    const rest = g.endZeit - Date.now();
    if (rest <= 0) endGiveaway(g.messageId).catch(() => {});
    else setTimeout(() => endGiveaway(g.messageId).catch(() => {}), rest);
  }
  console.log(`🎉 Reaktivierte Giveaways: ${giveaways.filter(x => !x.beendet).length}`);

  // Streamer-Poll starten
  initTwitchPolling().catch(console.error);
});

/* =========================================
   Welcome + Booster
========================================= */
client.on("guildMemberAdd", async (member) => {
  const ch = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor("#00FF00")
    .setTitle("👋 Willkommen auf dem Server!")
    .setDescription(`Willkommen ${member}, schön, dass du da bist! 🎉`)
    .setImage(BANNER_URL)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  ch.send({ embeds: [embed] });
});

client.on("guildMemberUpdate", async (oldM, newM) => {
  if (oldM.premiumSince === newM.premiumSince) return;
  if (!newM.premiumSince) return;
  const ch = newM.guild.channels.cache.get(process.env.BOOSTER_CHANNEL_ID);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor("#FF00FF")
    .setTitle("💎 Neuer Server-Boost!")
    .setDescription(`Vielen Dank ${newM} fürs Boosten des Servers! 🚀💖`)
    .setImage(BANNER_URL)
    .setTimestamp();
  ch.send({ embeds: [embed] });
});

/* =========================================
   Interaction Handler (Commands, Buttons, Modals)
========================================= */
const ORDER_STATE = new Map(); // key: messageId => {customerId, items:[{name, price}], active, channelId}

client.on("interactionCreate", async (i) => {
  try {
    /* ---- VERIFY PANEL + BUTTON ---- */
    if (i.isChatInputCommand() && i.commandName === "verifymsg") {
      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("✅ Verifizierung")
        .setDescription("Drücke unten auf **Verifizieren**, um Zugriff auf den Server zu erhalten!")
        .setImage(BANNER_URL);

      const button = new ButtonBuilder()
        .setCustomId("verify_button")
        .setLabel("Verifizieren")
        .setStyle(ButtonStyle.Success);

      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    if (i.isButton() && i.customId === "verify_button") {
      const role = i.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
      if (!role) return i.reply({ content: "❌ Verify-Rolle nicht gefunden!", ephemeral: true });
      try {
        await i.member.roles.add(role);
        return i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
      } catch (e) {
        return i.reply({ content: "❌ Konnte die Verify-Rolle nicht vergeben. Bot-Rechte & Rollen-Hierarchie prüfen.", ephemeral: true });
      }
    }

    /* ---- PAYPAL ---- */
    if (i.isChatInputCommand() && i.commandName === "paypal") {
      const amount = i.options.getNumber("betrag");
      if (amount == null || amount <= 0) return i.reply({ content: "⚠️ Ungültiger Betrag!", ephemeral: true });
      const fixed = fmtCurrency(amount);
      const link = `https://www.paypal.com/paypalme/${process.env.BRAND_PAYPAL_USERNAME}/${fixed}`;
      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("💰 PayPal Zahlung")
        .setDescription(`Klicke auf den Button, um **${fixed}€** zu zahlen.`)
        .setFooter({ text: BRAND_FOOTER })
        .setImage(BANNER_URL);
      const btn = new ButtonBuilder().setLabel(`Jetzt ${fixed}€ zahlen`).setStyle(ButtonStyle.Link).setURL(link);
      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
    }

    /* ---- TICKET PANEL /panel ---- */
    if (i.isChatInputCommand() && i.commandName === "panel") {
      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("🎟 Support & Bewerbungen")
        .setDescription(
          `Bitte wähle unten die Art deines Tickets aus:\n\n` +
          `💰 **Shop Ticket** – Käufe & Bestellungen\n` +
          `🎥 **Streamer Bewerbung** – Bewirb dich als Creator\n` +
          `✍️ **Kandar Bewerbung** – Allgemeine Bewerbung\n` +
          `🎨 **Designer Bewerbung** – Deine Bewerbung als Designer starten\n` +
          `✂️ **Cutter Bewerbung** – Deine Bewerbung als Cutter starten\n` +
          `🛠️ **Highteam Anliegen** – Interne Anliegen\n`+
          `👥 **Support Anliegen** – Support Anliegen\n`
        )
        .setImage(BANNER_URL);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("ticket_select")
        .setPlaceholder("Wähle eine Ticket-Art")
        .addOptions([
          { label: "Shop Ticket", value: "shop", emoji: "💰" },
          { label: "Streamer Bewerbung", value: "streamer", emoji: "🎥" },
          { label: "Kandar Bewerbung", value: "kandar", emoji: "✍️" },
          { label: "Designer Bewerbung", value: "designer", emoji: "🎨" },
          { label: "Cutter Bewerbung", value: "cutter", emoji: "✂️" },
          { label: "Highteam Anliegen", value: "highteam", emoji: "🛠️" },
          { label: "Support Anliegen", value: "support", emoji: "👥" },
        ]);

      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // Dropdown -> ggf. Modals/Channel erstellen
    if (i.isStringSelectMenu() && i.customId === "ticket_select") {
      const choice = i.values[0];

      // SHOP: Modal
      if (choice === "shop") {
        const modal = new ModalBuilder()
          .setCustomId("shopTicketModal")
          .setTitle("💰 Shop Ticket erstellen");

        const payment = new TextInputBuilder()
          .setCustomId("payment")
          .setLabel("Zahlungsmethode (z.B. PayPal, Überweisung)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const item = new TextInputBuilder()
          .setCustomId("item")
          .setLabel("Artikel / Produktname")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(payment),
          new ActionRowBuilder().addComponents(item)
        );
        return i.showModal(modal);
      }

      // STREAMER: Modal
      if (choice === "streamer") {
        const modal = new ModalBuilder()
          .setCustomId("streamerTicketModal")
          .setTitle("🎥 Streamer Bewerbung");

        const follower = new TextInputBuilder()
          .setCustomId("follower")
          .setLabel("Follower (z.B. 1200)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const avgViewer = new TextInputBuilder()
          .setCustomId("avg_viewer")
          .setLabel("Durchschnittliche Viewer")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const twitch = new TextInputBuilder()
          .setCustomId("twitch_link")
          .setLabel("Twitch-Link")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(follower),
          new ActionRowBuilder().addComponents(avgViewer),
          new ActionRowBuilder().addComponents(twitch)
        );
        return i.showModal(modal);
      }

      // Andere Kategorien: Direkt Channel + Close Button + Rename via $rename (Team only via MessageCreate)
      const map = {
        kandar: { title: "✍️ Kandar Bewerbung", cat: "✍️ Kandar Bewerbungen", desc: "Bitte schreibe deine Bewerbung hier." },
        designer: { title: "🎨 Designer Bewerbung", cat: "🎨 Designer Bewerbungen", desc: "Bitte sende dein Portfolio." },
        cutter: { title: "✂️ Cutter Bewerbung", cat: "✂️ Cutter Bewerbungen", desc: "Bitte nenne Software & Erfahrung." },
        highteam: { title: "🛠️ Highteam Ticket", cat: "🛠️ Highteam Anliegen", desc: "Beschreibe bitte dein Anliegen." },
        support: { title: "👥 Support Ticket", cat: "👥 Support Anliegen", desc: "Beschreibe bitte dein Anliegen." },
      };
      const data = map[choice];
      if (!data) return;

      const guild = i.guild;
      let cat = guild.channels.cache.find(c => c.name === data.cat && c.type === ChannelType.GuildCategory);
      if (!cat) cat = await guild.channels.create({ name: data.cat, type: ChannelType.GuildCategory });

      const ch = await guild.channels.create({
        name: `${data.title.split(" ")[0]}-${i.user.username}`,
        type: ChannelType.GuildText,
        parent: cat.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
          { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        ],
      });

      const ticketEmbed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle(data.title)
        .setDescription(data.desc)
        .setFooter({ text: BRAND_FOOTER })
        .setImage(BANNER_URL);

      const closeBtn = new ButtonBuilder()
        .setCustomId("ticket_close")
        .setStyle(ButtonStyle.Danger)
        .setLabel("Ticket schließen ❌");

      await ch.send({ content: `${i.user}`, embeds: [ticketEmbed], components: [new ActionRowBuilder().addComponents(closeBtn)] });

      // Log
      const logCh = guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID);
      if (logCh) logCh.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("🧾 Ticket erstellt").setDescription(`${data.title} von ${i.user}`).setTimestamp()] });

      return i.reply({ content: `✅ Ticket erstellt: ${ch}`, ephemeral: true });
    }

    // Ticket Close (mit Grund)
    if (i.isButton() && i.customId === "ticket_close") {
      if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team-Mitglieder dürfen Tickets schließen.", ephemeral: true });
      const modal = new ModalBuilder().setCustomId("ticket_close_reason").setTitle("Ticket schließen");
      const reasonInput = new TextInputBuilder().setCustomId("reason").setLabel("Grund").setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return i.showModal(modal);
    }
    if (i.isModalSubmit() && i.customId === "ticket_close_reason") {
      const reason = i.fields.getTextInputValue("reason");
      const ch = i.channel;
      await ch.send({ embeds: [new EmbedBuilder().setColor("#ff0000").setTitle("🔒 Ticket geschlossen").setDescription(`Grund: ${reason}`).setTimestamp()] });
      await i.reply({ content: "✅ Ticket wird geschlossen.", ephemeral: true });
      setTimeout(() => ch.delete().catch(() => {}), 3000);
    }

    /* ---- $rename (Team only) ---- */
    // handled in messageCreate below

    /* ---- SHOP INVENTORY ---- */
    if (i.isChatInputCommand() && i.commandName === "shop") {
      const sub = i.options.getSubcommand();
      if (sub === "add") {
        const name = i.options.getString("name").trim();
        const price = Number(i.options.getNumber("preis"));
        if (!name || !(price >= 0)) return i.reply({ content: "⚠️ Ungültige Eingabe.", ephemeral: true });
        const inv = ensureFileArray(PATHS.inventory);
        const exists = inv.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (exists) return i.reply({ content: "⚠️ Artikel existiert bereits.", ephemeral: true });
        inv.push({ name, price: Number(fmtCurrency(price)) });
        writeJSON(PATHS.inventory, inv);
        const e = new EmbedBuilder().setColor(BRAND_COLOR).setTitle("🛒 Artikel hinzugefügt").setDescription(`**${name}** – ${fmtCurrency(price)}€`).setFooter({ text: BRAND_FOOTER }).setImage(BANNER_URL);
        return i.reply({ embeds: [e] });
      }
      if (sub === "remove") {
        const name = i.options.getString("name").trim();
        const inv = ensureFileArray(PATHS.inventory);
        const idx = inv.findIndex(a => a.name.toLowerCase() === name.toLowerCase());
        if (idx === -1) return i.reply({ content: "⚠️ Artikel nicht gefunden.", ephemeral: true });
        const removed = inv.splice(idx, 1)[0];
        writeJSON(PATHS.inventory, inv);
        const e = new EmbedBuilder().setColor("#ff4444").setTitle("🗑️ Artikel entfernt").setDescription(`**${removed.name}** wurde aus dem Sortiment gelöscht.`).setFooter({ text: BRAND_FOOTER }).setImage(BANNER_URL);
        return i.reply({ embeds: [e] });
      }
      if (sub === "list") {
        const inv = ensureFileArray(PATHS.inventory);
        if (!inv.length) return i.reply("📦 Sortiment ist leer.");
        const lines = inv.map(a => `• ${a.name} — **${fmtCurrency(a.price)}€**`).join("\n");
        const e = new EmbedBuilder().setColor(BRAND_COLOR).setTitle("📋 Sortiment").setDescription(lines).setFooter({ text: BRAND_FOOTER }).setImage(BANNER_URL);
        return i.reply({ embeds: [e] });
      }
    }

    /* ---- ORDER SYSTEM ---- */
    if (i.isChatInputCommand() && i.commandName === "order") {
      const customer = i.options.getUser("kunde");
      const inv = ensureFileArray(PATHS.inventory);
      if (!inv.length) return i.reply({ content: "📦 Kein Artikel im Sortiment. Füge erst mit `/shop add` Artikel hinzu.", ephemeral: true });

      const orderEmbed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`🧾 Bestellung von ${customer.username}`)
        .setDescription(`🛍️ **Artikel:** *(noch keine)*\n💶 **Gesamt:** 0.00€`)
        .setFooter({ text: BRAND_FOOTER })
        .setImage(BANNER_URL);

      const components = buildOrderComponents([], 0, false); // team-only Buttons (bearbeiten/abschließen) sind da; Permissions checken wir onClick
      const msg = await i.reply({ embeds: [orderEmbed], components, fetchReply: true });

      ORDER_STATE.set(msg.id, { customerId: customer.id, items: [], active: true, channelId: msg.channel.id });
    }

    // Order Buttons & Selects
    if (i.isButton() || i.isStringSelectMenu() || i.isModalSubmit()) {
      const msgId = i.message?.id || i.customId?.split(":")[1];
      const state = msgId ? ORDER_STATE.get(msgId) : null;

      // Artikel hinzufügen (öffnet Dropdown)
      if (i.isButton() && i.customId === `order:add:${msgId}`) {
        if (!state || !state.active) return i.reply({ content: "❌ Diese Bestellung ist nicht mehr aktiv.", ephemeral: true });
        const inv = ensureFileArray(PATHS.inventory);
        if (!inv.length) return i.reply({ content: "📦 Kein Artikel im Sortiment.", ephemeral: true });

        const options = inv.slice(0, 25).map(a => ({ label: `${a.name} (${fmtCurrency(a.price)}€)`, value: a.name }));
        const select = new StringSelectMenuBuilder().setCustomId(`order:add_select:${msgId}`).setPlaceholder("Artikel auswählen").addOptions(options);
        return i.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      // Artikel aus Dropdown hinzufügen
      if (i.isStringSelectMenu() && i.customId === `order:add_select:${msgId}`) {
        if (!state || !state.active) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
        const inv = ensureFileArray(PATHS.inventory);
        const picked = i.values[0];
        const item = inv.find(a => a.name === picked);
        if (!item) return i.reply({ content: "❌ Artikel nicht gefunden.", ephemeral: true });
        state.items.push({ name: item.name, price: item.price });
        const total = state.items.reduce((s, it) => s + it.price, 0);

        // Update Panel
        await updateOrderPanel(i.message, state, total);
        return i.reply({ content: `✅ **${item.name}** hinzugefügt.`, ephemeral: true });
      }

      // Artikel entfernen (Dropdown mit aktuellen Artikeln)
      if (i.isButton() && i.customId === `order:remove:${msgId}`) {
        if (!state || !state.active) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
        if (!state.items.length) return i.reply({ content: "ℹ️ Keine Artikel in der Bestellung.", ephemeral: true });
        const uniq = state.items.map((it, idx) => ({ label: `${it.name} (${fmtCurrency(it.price)}€)`, value: String(idx) })).slice(0, 25);
        const select = new StringSelectMenuBuilder().setCustomId(`order:remove_select:${msgId}`).setPlaceholder("Artikel auswählen zum Entfernen").addOptions(uniq);
        return i.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }
      if (i.isStringSelectMenu() && i.customId === `order:remove_select:${msgId}`) {
        if (!state || !state.active) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
        const idx = Number(i.values[0]);
        if (Number.isNaN(idx) || idx < 0 || idx >= state.items.length) return i.reply({ content: "❌ Ungültige Auswahl.", ephemeral: true });
        const removed = state.items.splice(idx, 1)[0];
        const total = state.items.reduce((s, it) => s + it.price, 0);
        await updateOrderPanel(i.message, state, total);
        return i.reply({ content: `🗑️ **${removed.name}** entfernt.`, ephemeral: true });
      }

      // Bestellung bearbeiten (Team-only): DM an Kunden + Titel ändern
      if (i.isButton() && i.customId === `order:processing:${msgId}`) {
        if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team.", ephemeral: true });
        if (!state || !state.active) return i.reply({ content: "❌ Bestellung nicht aktiv.", ephemeral: true });

        try {
          const customer = await i.guild.members.fetch(state.customerId);
          const dm = await customer.createDM();
          const dmEmbed = new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle("🛠️ Bestellung in Bearbeitung")
            .setDescription(`⏳ Deine Bestellung wird gerade bearbeitet.\nBitte hab etwas Geduld. Vielen Dank! 🙏`)
            .setFooter({ text: BRAND_FOOTER })
            .setImage(BANNER_URL);
          await dm.send({ embeds: [dmEmbed] });
        } catch {}

        // Titel im Panel ändern
        const embed = EmbedBuilder.from(i.message.embeds[0]);
        embed.setTitle(embed.data.title?.replace(/^🧾 Bestellung von /, "🧾 Bestellung in Bearbeitung (") || `🧾 Bestellung in Bearbeitung (${(await i.guild.members.fetch(state.customerId)).user.username})`);
        await i.message.edit({ embeds: [embed] });
        return i.reply({ content: "✅ Kunde benachrichtigt. Titel aktualisiert.", ephemeral: true });
      }

      // Bestellung abschließen (Team-only): setzt Order inaktiv, zeigt PayPal-Button mit Gesamtpreis & **führt /finish automatisch** aus
      if (i.isButton() && i.customId === `order:complete:${msgId}`) {
        if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team.", ephemeral: true });
        if (!state || !state.active) return i.reply({ content: "❌ Bestellung nicht aktiv.", ephemeral: true });
        const total = state.items.reduce((s, it) => s + it.price, 0);
        const fixed = fmtCurrency(total);
        state.active = false;

        // Panel finalisieren inkl. Paypal-Button
        const embed = EmbedBuilder.from(i.message.embeds[0]);
        embed.setDescription(buildOrderDescription(state.items, total) + `\n\n✅ **Bestellung abgeschlossen.**`);
        const components = buildOrderComponents(state.items, total, true); // disabled + paypal
        await i.message.edit({ embeds: [embed], components });

        // automatisch /finish starten: öffentlicher Trigger -> direkt Feedback-Knopf unter einem neuen Embed
        await triggerFinishFlow(i.guild, i.channel, state.customerId, i.user.id);
        return i.reply({ content: "✅ Bestellung abgeschlossen & /finish ausgeführt.", ephemeral: true });
      }

      // Paypal-Knopf ist Link — keine weitere Logik nötig
    }

    /* ---- CREATOR ADD ---- */
    if (i.isChatInputCommand() && i.commandName === "creator" && i.options.getSubcommand() === "add") {
      const modal = new ModalBuilder().setCustomId("creatorAddModal").setTitle("Creator hinzufügen");
      const fields = [
        { id: "title", label: "Titel des Embeds", style: TextInputStyle.Short, req: true },
        { id: "creatorId", label: "Discord-ID des Creators", style: TextInputStyle.Short, req: true },
        { id: "twitch", label: "Twitch Link", style: TextInputStyle.Short, req: true },
        { id: "youtube", label: "YouTube Link (Optional)", style: TextInputStyle.Short, req: false },
        { id: "tiktok", label: "TikTok Link (Optional)", style: TextInputStyle.Short, req: false },
        { id: "instagram", label: "Instagram Link (Optional)", style: TextInputStyle.Short, req: false },
        { id: "code", label: "Creator Code (Optional)", style: TextInputStyle.Short, req: false },
      ];
      modal.addComponents(fields.map(f =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style).setRequired(f.req)
        )
      ));
      return i.showModal(modal);
    }
    if (i.isModalSubmit() && i.customId === "creatorAddModal") {
      const guild = i.guild;
      const title = i.fields.getTextInputValue("title");
      const creatorId = i.fields.getTextInputValue("creatorId");
      const twitch = i.fields.getTextInputValue("twitch");
      const youtube = i.fields.getTextInputValue("youtube") || "";
      const tiktok = i.fields.getTextInputValue("tiktok") || "";
      const instagram = i.fields.getTextInputValue("instagram") || "";
      const code = i.fields.getTextInputValue("code") || "";

      try {
        const member = await guild.members.fetch(creatorId);
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === "creator");
        if (member && role) await member.roles.add(role).catch(() => null);
      } catch {}

      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(title)
        .addFields({ name: "Twitch", value: twitch });
      if (youtube) embed.addFields({ name: "YouTube", value: youtube });
      if (tiktok) embed.addFields({ name: "TikTok", value: tiktok });
      if (instagram) embed.addFields({ name: "Instagram", value: instagram });
      if (code) embed.addFields({ name: "Creator Code", value: code });

      const msg = await i.reply({ embeds: [embed], fetchReply: true });
      const arr = ensureFileArray(PATHS.creators);
      arr.push({ title, creatorId, twitch, youtube, tiktok, instagram, code, messageId: msg.id, channelId: msg.channel.id });
      writeJSON(PATHS.creators, arr);
      return i.followUp({ content: "✅ Creator erstellt!", ephemeral: true });
    }

    /* ---- NUKE ---- */
    if (i.isChatInputCommand() && i.commandName === "nuke") {
      const ch = i.channel;
      await i.reply({ content: "⚠️ Channel wird geleert...", ephemeral: true });
      try {
        let msgs;
        do {
          msgs = await ch.messages.fetch({ limit: 100 });
          await ch.bulkDelete(msgs, true);
        } while (msgs.size >= 2);
        await ch.send("✅ Channel erfolgreich genukt!");
      } catch {
        await ch.send("❌ Fehler beim Löschen (Hinweis: Nachrichten >14 Tage können nicht gelöscht werden).");
      }
    }

    /* ---- EMBED (Modal) ---- */
    if (i.isChatInputCommand() && i.commandName === "embed") {
      const modal = new ModalBuilder().setCustomId("modal_embed_create").setTitle("Embed erstellen");
      const color = new TextInputBuilder().setCustomId("color").setLabel("Farbe (Hex, optional)").setStyle(TextInputStyle.Short).setRequired(false);
      const title = new TextInputBuilder().setCustomId("title").setLabel("Titel").setStyle(TextInputStyle.Short).setRequired(true);
      const desc = new TextInputBuilder().setCustomId("desc").setLabel("Beschreibung (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false);
      const footer = new TextInputBuilder().setCustomId("footer").setLabel("Footer (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      const thumb = new TextInputBuilder().setCustomId("thumb").setLabel("Thumbnail URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      const image = new TextInputBuilder().setCustomId("image").setLabel("Embed Bild URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(color),
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(desc),
        new ActionRowBuilder().addComponents(footer),
        new ActionRowBuilder().addComponents(thumb),
        new ActionRowBuilder().addComponents(image),
      );
      return i.showModal(modal);
    }
    if (i.isModalSubmit() && i.customId === "modal_embed_create") {
      const color = i.fields.getTextInputValue("color") || BRAND_COLOR;
      const title = i.fields.getTextInputValue("title");
      const desc = i.fields.getTextInputValue("desc");
      const footer = i.fields.getTextInputValue("footer") || BRAND_FOOTER;
      const thumb = i.fields.getTextInputValue("thumb");
      const img = i.fields.getTextInputValue("image");

      const e = new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: footer });
      if (desc) e.setDescription(desc);
      if (thumb) e.setThumbnail(thumb);
      if (img) e.setImage(img);
      return i.reply({ embeds: [e] });
    }

    /* ---- GIVEAWAY ---- */
    if (i.isChatInputCommand() && i.commandName === "giveaway") {
      const preis = i.options.getString("preis");
      const dauerStr = i.options.getString("dauer");
      const gewinner = i.options.getInteger("gewinner");
      if (!gewinner || gewinner < 1)
        return i.reply({ content: "⚠️ Bitte gib eine gültige Gewinneranzahl an!", ephemeral: true });

      const dauer = parseDuration(dauerStr);
      if (!dauer || dauer <= 0)
        return i.reply({ content: "⚠️ Ungültige Dauer (z. B. 1d2h30m)", ephemeral: true });

      const endZeit = Date.now() + dauer;

      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle("🎉 Neues Giveaway 🎉")
        .setDescription(`**Preis:** ${preis}\n🎁 **Gewinner:** ${gewinner}\n👥 **Teilnehmer:** 0\n⏰ **Endet in:** ${dauerStr}\n\nKlicke unten, um teilzunehmen!`)
        .setImage(BANNER_URL)
        .setTimestamp(new Date(endZeit))
        .setFooter({ text: "Endet automatisch" });

      const btn = new ButtonBuilder()
        .setCustomId("giveaway_join")
        .setLabel("Teilnehmen 🎉")
        .setStyle(ButtonStyle.Primary);

      const msg = await i.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(btn)],
        fetchReply: true
      });

      const giveaways = ensureFileArray(PATHS.giveaways);
      giveaways.push({
        messageId: msg.id,
        channelId: msg.channel.id,
        guildId: msg.guild.id,
        preis,
        endZeit,
        gewinner,
        teilnehmer: [],
        beendet: false,
      });
      writeJSON(PATHS.giveaways, giveaways);
      setTimeout(() => endGiveaway(msg.id).catch(() => {}), dauer);
    }

    if (i.isButton() && i.customId === "giveaway_join") {
      const giveaways = ensureFileArray(PATHS.giveaways);
      const g = giveaways.find(x => x.messageId === i.message.id);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (g.beendet) return i.reply({ content: "🚫 Dieses Giveaway ist beendet!", ephemeral: true });
      if (g.teilnehmer.includes(i.user.id))
        return i.reply({ content: "⚠️ Du bist bereits dabei!", ephemeral: true });

      g.teilnehmer.push(i.user.id);
      writeJSON(PATHS.giveaways, giveaways);

      // Teilnehmerzahl im Embed updaten
      const base = EmbedBuilder.from(i.message.embeds[0]);
      const newDesc = base.data.description.replace(/👥 \*\*Teilnehmer:\*\* \d+/, `👥 **Teilnehmer:** ${g.teilnehmer.length}`);
      base.setDescription(newDesc);
      await i.message.edit({ embeds: [base] });

      return i.reply({ content: "✅ Teilnahme gespeichert!", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "reroll") {
      const msgid = i.options.getString("msgid");
      const g = ensureFileArray(PATHS.giveaways).find(x => x.messageId === msgid);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (!g.teilnehmer.length) return i.reply({ content: "😢 Keine Teilnehmer!", ephemeral: true });

      const winners = pickWinners(g.teilnehmer, g.gewinner);
      return i.reply(`🔁 Neue Gewinner für **${g.preis}**: ${winners.map(id => `<@${id}>`).join(", ")}`);
    }

    if (i.isChatInputCommand() && i.commandName === "end") {
      await endGiveaway(i.options.getString("msgid"), i);
    }

    /* ---- FINISH (Team only) ---- */
    if (i.isChatInputCommand() && i.commandName === "finish") {
      if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team.", ephemeral: true });
      const kunde = i.options.getUser("kunde");
      await triggerFinishFlow(i.guild, i.channel, kunde.id, i.user.id);
      return i.reply({ content: "✅ Finish ausgeführt & Feedback-Knopf gesendet.", ephemeral: true });
    }

    /* ---- STREAMER AUTO-ANNOUNCE ---- */
    if (i.isChatInputCommand() && i.commandName === "streamer") {
      const sub = i.options.getSubcommand();
      const list = ensureFileArray(PATHS.streamers);
      if (sub === "add") {
        const name = i.options.getString("name").trim().toLowerCase();
        if (list.some(s => s.name === name)) return i.reply({ content: "⚠️ Streamer ist bereits eingetragen.", ephemeral: true });
        list.push({ name, channelId: i.channel.id, live: false, lastStreamId: null });
        writeJSON(PATHS.streamers, list);
        return i.reply(`✅ **${name}** wird überwacht. Announce hier im Channel.`);
      }
      if (sub === "remove") {
        const name = i.options.getString("name").trim().toLowerCase();
        const idx = list.findIndex(s => s.name === name);
        if (idx === -1) return i.reply({ content: "❌ Streamer nicht gefunden.", ephemeral: true });
        list.splice(idx, 1);
        writeJSON(PATHS.streamers, list);
        return i.reply(`🗑️ **${name}** entfernt.`);
      }
      if (sub === "list") {
        if (!list.length) return i.reply("ℹ️ Keine Streamer eingetragen.");
        const text = list.map(s => `• **${s.name}** → <#${s.channelId}>`).join("\n");
        return i.reply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle("📺 Überwachte Streamer").setDescription(text).setFooter({ text: "Kandar Streaming" })] });
      }
    }

  } catch (err) {
    console.error("❌ Interaktionsfehler:", err);
  }
});

/* =========================================
   $rename (Team only)
========================================= */
client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.content.startsWith("$rename ")) return;
  if (!isTeam(msg.member)) return msg.reply("🚫 Nur Team.");

  const newName = msg.content.slice(8).trim();
  if (!newName) return msg.reply("⚠️ Bitte einen Namen angeben.");
  try {
    await msg.channel.setName(newName);
    await msg.reply(`✅ Channel umbenannt in **${newName}**`);
  } catch {
    await msg.reply("❌ Konnte Channel nicht umbenennen.");
  }
});

/* =========================================
   Giveaway Helpers
========================================= */
function pickWinners(arr, count) {
  const pool = [...arr];
  const winners = [];
  while (winners.length < count && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  return winners;
}

async function endGiveaway(msgid, interaction = null) {
  const giveaways = ensureFileArray(PATHS.giveaways);
  const g = giveaways.find(x => x.messageId === msgid);
  if (!g || g.beendet) return;
  g.beendet = true;
  writeJSON(PATHS.giveaways, giveaways);

  try {
    const guild = await client.guilds.fetch(g.guildId);
    const ch = await guild.channels.fetch(g.channelId);
    const msg = await ch.messages.fetch(g.messageId);

    if (!g.teilnehmer.length) {
      const embed = EmbedBuilder.from(msg.embeds[0])
        .setColor("#808080")
        .setDescription(`**Preis:** ${g.preis}\n👥 **Teilnehmer:** 0\n❌ Keine Teilnehmer 😢`)
        .setFooter({ text: "Giveaway beendet" });
      await msg.edit({ embeds: [embed], components: [] });
      if (interaction) await interaction.reply({ content: "❌ Keine Teilnehmer. Giveaway beendet.", ephemeral: true });
      return;
    }

    const winners = pickWinners(g.teilnehmer, g.gewinner);
    const embed = EmbedBuilder.from(msg.embeds[0])
      .setColor(BRAND_COLOR)
      .setDescription(`**Preis:** ${g.preis}\n👥 **Teilnehmer:** ${g.teilnehmer.length}\n🏆 Gewinner: ${winners.map(id => `<@${id}>`).join(", ")}`)
      .setFooter({ text: "Giveaway beendet" });

    await msg.edit({ embeds: [embed], components: [] });
    await ch.send(`🎉 Glückwunsch ${winners.map(id => `<@${id}>`).join(", ")}! Ihr habt **${g.preis}** gewonnen!`);
    if (interaction) await interaction.reply({ content: "✅ Giveaway beendet!", ephemeral: true });
  } catch (err) {
    console.error("❌ Fehler beim Beenden des Giveaways:", err);
  }
}

/* =========================================
   Order Helpers
========================================= */
function buildOrderDescription(items, total) {
  if (!items.length) return `🛍️ **Artikel:** *(noch keine)*\n💶 **Gesamt:** ${fmtCurrency(total)}€`;
  const lines = items.map(it => `• ${it.name} — **${fmtCurrency(it.price)}€**`).join("\n");
  return `🛍️ **Artikel:**\n${lines}\n\n💶 **Gesamt:** ${fmtCurrency(total)}€`;
}

function buildOrderComponents(items, total, finalized) {
  const fixed = fmtCurrency(total);
  const btnAdd = new ButtonBuilder().setCustomId(`order:add:MESSAGE_ID`).setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success).setDisabled(!!finalized);
  const btnRemove = new ButtonBuilder().setCustomId(`order:remove:MESSAGE_ID`).setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary).setDisabled(!!finalized || items.length === 0);
  const btnProcessing = new ButtonBuilder().setCustomId(`order:processing:MESSAGE_ID`).setLabel("🛠️ Bestellung bearbeiten").setStyle(ButtonStyle.Secondary).setDisabled(!!finalized);
  const btnComplete = new ButtonBuilder().setCustomId(`order:complete:MESSAGE_ID`).setLabel("✅ Bestellung abschließen").setStyle(ButtonStyle.Primary).setDisabled(!!finalized || items.length === 0);

  const payBtn = new ButtonBuilder()
    .setLabel(`Jetzt ${fixed}€ zahlen`)
    .setStyle(ButtonStyle.Link)
    .setURL(`https://www.paypal.com/paypalme/${process.env.BRAND_PAYPAL_USERNAME}/${fixed}`);

  // Hinweis: MESSAGE_ID wird später ersetzt
  return [new ActionRowBuilder().addComponents(btnAdd, btnRemove, btnProcessing, btnComplete),
          new ActionRowBuilder().addComponents(payBtn)];
}

async function updateOrderPanel(message, state, total) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  embed.setDescription(buildOrderDescription(state.items, total));

  // Components mit echter MessageId bestücken
  let comps = buildOrderComponents(state.items, total, false);
  comps = comps.map(row => {
    const newRow = new ActionRowBuilder();
    for (const c of row.components) {
      if (c.data && typeof c.data.custom_id === "string") {
        const copy = ButtonBuilder.from(c);
        copy.setCustomId(c.data.custom_id.replace("MESSAGE_ID", message.id));
        newRow.addComponents(copy);
      } else {
        newRow.addComponents(c);
      }
    }
    return newRow;
  });

  await message.edit({ embeds: [embed], components: comps });
}

/* auto Finish -> Feedback */
async function triggerFinishFlow(guild, channel, customerId, sellerId) {
  try {
    const customer = await guild.members.fetch(customerId);
    // Customer-Rolle vergeben (aus ENV, optional)
    const customerRoleId = process.env.CUSTOMER_ROLE_ID;
    if (customerRoleId) {
      const role = guild.roles.cache.get(customerRoleId);
      if (role) await customer.roles.add(role).catch(() => {});
    }
  } catch {}

  const feedbackBtn = new ButtonBuilder().setCustomId(`feedback_open:${customerId}:${sellerId}`).setLabel("⭐ Feedback abgeben").setStyle(ButtonStyle.Primary);
  const embed = new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle("✅ Bestellung abgeschlossen")
    .setDescription(`Danke für deinen Einkauf! 💖\nKlicke auf **Feedback abgeben**, um uns ⭐ zu geben und etwas zu schreiben.\n\n🛍️✨`)
    .setFooter({ text: BRAND_FOOTER })
    .setImage(BANNER_URL);

  await channel.send({ content: `<@${customerId}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(feedbackBtn)] });
}

// Feedback Button & Modal
client.on("interactionCreate", async (i) => {
  if (i.isButton() && i.customId.startsWith("feedback_open:")) {
    const [_, customerId, sellerId] = i.customId.split(":");
    if (i.user.id !== customerId) return i.reply({ content: "🚫 Nur der Kunde kann Feedback abgeben.", ephemeral: true });

    const modal = new ModalBuilder().setCustomId(`feedback_modal:${sellerId}`).setTitle("⭐ Feedback abgeben");
    const stars = new TextInputBuilder().setCustomId("stars").setLabel("Sterne (1-5)").setStyle(TextInputStyle.Short).setRequired(true);
    const text = new TextInputBuilder().setCustomId("text").setLabel("Dein Feedback (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false);
    modal.addComponents(
      new ActionRowBuilder().addComponents(stars),
      new ActionRowBuilder().addComponents(text),
    );
    return i.showModal(modal);
  }
  if (i.isModalSubmit() && i.customId.startsWith("feedback_modal:")) {
    const sellerId = i.customId.split(":")[1];
    const starsV = (i.fields.getTextInputValue("stars") || "").trim();
    const stars = Math.max(1, Math.min(5, parseInt(starsV)));
    const text = i.fields.getTextInputValue("text") || "—";
    const feedbackCh = i.guild.channels.cache.get(process.env.FEEDBACK_CHANNEL_ID);
    const starEmojis = "⭐".repeat(stars) + "☆".repeat(5 - stars);

    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("📝 Neues Feedback eingegangen")
      .setDescription(`**Bewertung:** ${starEmojis}\n\n**Text:** ${text}\n\n👤 **Kunde:** <@${i.user.id}>\n🧑‍💼 **Verkäufer:** <@${sellerId}>`)
      .setFooter({ text: BRAND_FOOTER })
      .setImage(BANNER_URL);

    if (feedbackCh) await feedbackCh.send({ embeds: [embed] });
    return i.reply({ content: "Danke für dein Feedback! ❤️", ephemeral: true });
  }
});

/* =========================================
   Logging
========================================= */
// Member
client.on("guildMemberAdd", m => {
  const log = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("👋 Neues Mitglied").setDescription(`${m} ist beigetreten.`)] });
});
client.on("guildMemberRemove", m => {
  const log = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🚪 Mitglied hat verlassen").setDescription(`${m.user.tag} hat den Server verlassen.`)] });
});

// Message (gelöscht)
client.on("messageDelete", msg => {
  if (!msg.guild || msg.author?.bot) return;
  const log = msg.guild.channels.cache.get(process.env.MESSAGE_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑 Nachricht gelöscht").setDescription(`Von ${msg.author}\nIn ${msg.channel}\n\n${msg.content || "[Embed/Datei]"}`)] });
});

// Channel
client.on("channelCreate", ch => {
  const log = ch.guild.channels.cache.get(process.env.CHANNEL_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("📢 Channel erstellt").setDescription(`${ch.name}`)] });
});
client.on("channelDelete", ch => {
  const log = ch.guild.channels.cache.get(process.env.CHANNEL_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑 Channel gelöscht").setDescription(`${ch.name}`)] });
});

// Role
client.on("roleCreate", r => {
  const log = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("🎭 Rolle erstellt").setDescription(`${r.name}`)] });
});
client.on("roleDelete", r => {
  const log = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🎭 Rolle gelöscht").setDescription(`${r.name}`)] });
});

// Voice
client.on("voiceStateUpdate", (o, n) => {
  const log = n.guild.channels.cache.get(process.env.VOICE_LOGS_CHANNEL_ID);
  if (!log) return;
  let desc = "";
  const user = n.member.user;
  if (!o.channel && n.channel) desc = `🎙️ ${user} ist **${n.channel.name}** beigetreten.`;
  else if (o.channel && !n.channel) desc = `🔇 ${user} hat **${o.channel.name}** verlassen.`;
  else if (o.channelId !== n.channelId) desc = `🔁 ${user} wechselte von **${o.channel.name}** zu **${n.channel.name}**.`;
  if (desc) log.send({ embeds: [new EmbedBuilder().setColor("#00A8FF").setTitle("🔊 Voice Log").setDescription(desc)] });
});

/* =========================================
   Twitch Auto Announce
========================================= */
let twitchToken = null;
let twitchTokenExp = 0;

async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchTokenExp - 60_000) return twitchToken;
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: "POST" });
  const js = await res.json();
  twitchToken = js.access_token;
  twitchTokenExp = Date.now() + js.expires_in * 1000;
  return twitchToken;
}

async function fetchStreamsLogins(logins) {
  if (!logins.length) return [];
  const token = await getTwitchToken();
  const url = `https://api.twitch.tv/helix/streams?${logins.map(l => `user_login=${encodeURIComponent(l)}`).join("&")}`;
  const res = await fetch(url, { headers: { "Client-ID": process.env.TWITCH_CLIENT_ID, "Authorization": `Bearer ${token}` } });
  const js = await res.json();
  return js.data || [];
}

async function initTwitchPolling() {
  setInterval(async () => {
    const list = ensureFileArray(PATHS.streamers);
    if (!list.length) return;
    // split in chunks of <=100 if needed (we likely have few)
    const names = list.map(s => s.name);
    const streams = await fetchStreamsLogins(names); // online streams
    const onlineNames = new Set(streams.map(s => s.user_login.toLowerCase()));

    for (const s of list) {
      const wasLive = s.live;
      const isLive = onlineNames.has(s.name);
      if (!wasLive && isLive) {
        // announce
        try {
          const ch = await client.channels.fetch(s.channelId);
          const stream = streams.find(x => x.user_login.toLowerCase() === s.name);
          const title = stream?.title || "Live!";
          const preview = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(s.name)}-640x360.jpg`;

          const e = new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle(`🔴 ${s.name} ist jetzt live!`)
            .setDescription(`**${title}**\n\n👉 https://twitch.tv/${s.name}`)
            .setImage(preview)
            .setFooter({ text: "Kandar Streaming" });

          await ch.send({ content: "@everyone", embeds: [e] });
          s.live = true;
          s.lastStreamId = stream?.id || null;
        } catch (e) { /* ignore */ }
      } else if (wasLive && !isLive) {
        s.live = false;
      }
    }
    writeJSON(PATHS.streamers, list);
  }, 60_000);
}

/* =========================================
   Login
========================================= */
client.login(process.env.DISCORD_TOKEN);
