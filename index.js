// ===============================
// KANDAR ALL-IN-ONE DISCORD BOT
// ===============================

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
  UserSelectMenuBuilder,
  ComponentType,
} from "discord.js";
import fs from "fs";
import path from "path";
import "dotenv/config";

// ---------- CONSTANTS & FILES ----------
const BANNER_URL = "https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif";
const BRAND = process.env.BRAND_NAME || "Kandar Shop";
const PAYPAL_USER = process.env.BRAND_PAYPAL_USERNAME || "jonahborospreitzer";
const TEAM_ROLE_IDS = (process.env.TEAM_ROLE_IDS || "").split(",").map(s => s.trim()).filter(Boolean);

const DATA_DIR = "./data";
const FILES = {
  giveaways: path.join(DATA_DIR, "giveaways.json"),
  creators: path.join(DATA_DIR, "creators.json"),
  shop: path.join(DATA_DIR, "shop.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  streamers: path.join(DATA_DIR, "streamers.json"),
};
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
for (const f of Object.values(FILES)) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");

// Small helpers to read/write JSON
const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8") || "[]");
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ---------- CLIENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences
  ],
});

// ---------- SLASH COMMANDS ----------
const commands = [
  // PayPal
  new SlashCommandBuilder()
    .setName("paypal")
    .setDescription("Erstellt einen PayPal-Zahlungslink")
    .addNumberOption(o =>
      o.setName("betrag").setDescription("Betrag in Euro (z. B. 12.99)").setRequired(true)
    ),

  // Custom Embed
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Erstellt ein benutzerdefiniertes Embed via Modal"),

  // Verify Panel
  new SlashCommandBuilder()
    .setName("verifymsg")
    .setDescription("Sendet die Verify-Nachricht (mit Regelwerk)"),

  // Ticket Panel
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Sendet das Ticket-Panel (Dropdown)"),

  // Nuke
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Löscht viele Nachrichten im aktuellen Channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // Creator
  new SlashCommandBuilder()
    .setName("creator")
    .setDescription("Creator-System verwalten")
    .addSubcommand(sub => sub.setName("add").setDescription("Erstellt ein Creator-Panel mit Social-Links")),

  // Giveaway
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Starte ein neues Giveaway")
    .addStringOption(o => o.setName("preis").setDescription("Preis").setRequired(true))
    .addStringOption(o => o.setName("dauer").setDescription("Dauer (z. B. 1d, 2h, 30m)").setRequired(true))
    .addIntegerOption(o => o.setName("gewinner").setDescription("Anzahl der Gewinner").setRequired(true)),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Ziehe neue Gewinner für ein Giveaway")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID des Giveaways").setRequired(true)),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Beende ein Giveaway vorzeitig")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID des Giveaways").setRequired(true)),

  // Shop: Artikelverwaltung
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Shop-Artikel verwalten")
    .addSubcommand(s => s
      .setName("add").setDescription("Artikel zum Sortiment hinzufügen")
      .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
      .addNumberOption(o => o.setName("preis").setDescription("Preis in Euro, z. B. 9.99").setRequired(true))
    )
    .addSubcommand(s => s
      .setName("remove").setDescription("Artikel aus Sortiment entfernen")
      .addStringOption(o => o.setName("name").setDescription("Exakter Artikelname").setRequired(true))
    )
    .addSubcommand(s => s
      .setName("list").setDescription("Alle Shop-Artikel anzeigen")
    ),

  // Order: Bestellung mit Dropdown-Artikeln
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Erstellt ein Bestell-Panel")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),

  // Finish (nur Team)
  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Kauf abschließen & Feedback anstoßen (nur Team)")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),

  // Twitch Streamer Auto-Announce
  new SlashCommandBuilder()
    .setName("streamer")
    .setDescription("Streamer Auto-Announce verwalten")
    .addSubcommand(s => s
      .setName("add").setDescription("Streamer hinzufügen")
      .addStringOption(o => o.setName("name").setDescription("Twitch-Name (z. B. cxlxrized_)").setRequired(true))
    )
    .addSubcommand(s => s
      .setName("remove").setDescription("Streamer entfernen")
      .addStringOption(o => o.setName("name").setDescription("Exakter Twitch-Name").setRequired(true))
    )
    .addSubcommand(s => s
      .setName("list").setDescription("Streamer-Liste anzeigen")
    ),
].map(c => c.toJSON());

// ---------- REGISTER COMMANDS ----------
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("✅ Slash Commands registriert!");
}

// ---------- HELPERS ----------
const isTeam = (member) => TEAM_ROLE_IDS.some(rid => member.roles.cache.has(rid));
const euro = (n) => Number(n).toFixed(2);
const parseDuration = (str) => {
  if (!str) return 0;
  const m = String(str).toLowerCase().match(/^(\d+d)?(\d+h)?(\d+m)?$/);
  if (!m) return 0;
  let ms = 0;
  if (m[1]) ms += parseInt(m[1]) * 86400000;
  if (m[2]) ms += parseInt(m[2]) * 3600000;
  if (m[3]) ms += parseInt(m[3]) * 60000;
  return ms;
};

// runtime maps
const activeOrders = new Map(); // messageId -> { items: [{name, price}], customerId }

// ---------- READY ----------
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);
  try { await registerCommands(); } catch (e) { console.error("❌ Slash-Registrierung:", e); }

  // Server Stats Setup
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    const categoryName = "📊 Server Stats";
    let category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
    if (!category) category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });

    const stats = { members: "🧍‍♂️ Mitglieder", online: "💻 Online", bots: "🤖 Bots", boosts: "💎 Boosts" };
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

  // Re-arm giveaways
  const giveaways = readJSON(FILES.giveaways);
  for (const g of giveaways.filter(x => !x.beendet)) {
    const rest = g.endZeit - Date.now();
    if (rest <= 0) endGiveaway(g.messageId).catch(() => {});
    else setTimeout(() => endGiveaway(g.messageId).catch(() => {}), rest);
  }
  console.log(`🎉 Reaktivierte Giveaways: ${giveaways.filter(x => !x.beendet).length}`);

  // Start Twitch poller
  startTwitchPoller().catch(console.error);
});

// ---------- WELCOME & BOOST ----------
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

// ---------- MESSAGE COMMANDS: $rename (nur Team) ----------
client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.content.startsWith("$rename ")) return;
  if (!isTeam(msg.member)) return;
  const newName = msg.content.slice(8).trim();
  if (!newName) return msg.reply("⚠️ Bitte neuen Channel-Namen angeben.");
  try {
    await msg.channel.setName(newName);
    msg.reply(`✅ Channel umbenannt in **${newName}**`);
  } catch {
    msg.reply("❌ Konnte Channel nicht umbenennen.");
  }
});

// ---------- INTERACTIONS ----------
client.on("interactionCreate", async (i) => {
  try {
    // ---------------- VERIFY ----------------
    if (i.isChatInputCommand() && i.commandName === "verifymsg") {
      const rules = [
        "1️⃣ Respektvoller Umgang — kein Hate, keine Beleidigungen",
        "2️⃣ Keine Werbung/Spam ohne vorherige Erlaubnis",
        "3️⃣ Content in die passenden Channels posten",
        "4️⃣ Befolge die Anweisungen des Teams",
        "5️⃣ Keine illegalen/NSFW Inhalte",
      ].join("\n");

      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("✅ Verifizierung")
        .setDescription(
          `Drücke unten auf **Verifizieren**, um Zugriff auf den Server zu erhalten!\n\n` +
          `**Regelwerk:**\n${rules}`
        )
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
        await i.member.roles.add(role, "Verify-Button gedrückt");
        return i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
      } catch {
        return i.reply({ content: "❌ Konnte die Verify-Rolle nicht vergeben. Bot-Rechte & Rollen-Hierarchie prüfen.", ephemeral: true });
      }
    }

    // ---------------- PAYPAL ----------------
    if (i.isChatInputCommand() && i.commandName === "paypal") {
      const amount = i.options.getNumber("betrag");
      if (!amount || amount <= 0)
        return i.reply({ content: "⚠️ Ungültiger Betrag!", ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor("#9b5de5")
        .setTitle("💰 PayPal Zahlung")
        .setDescription(
          `Klicke auf den Button, um **${euro(amount)}€** zu zahlen.\n\n` +
          `📝 Mit dem Kauf stimmst du unseren **AGB** zu.`
        )
        .setFooter({ text: BRAND })
        .setImage(BANNER_URL);

      const btn = new ButtonBuilder()
        .setLabel(`Jetzt ${euro(amount)}€ zahlen`)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.paypal.com/paypalme/${PAYPAL_USER}/${euro(amount)}`);

      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
    }

    // ---------------- CUSTOM EMBED ----------------
    if (i.isChatInputCommand() && i.commandName === "embed") {
      const modal = new ModalBuilder().setCustomId("custom_embed_modal").setTitle("Embed erstellen");
      const color = new TextInputBuilder().setCustomId("color").setLabel("Farbe (Hex, z.B. #9b5de5)").setStyle(TextInputStyle.Short).setRequired(false);
      const title = new TextInputBuilder().setCustomId("title").setLabel("Titel").setStyle(TextInputStyle.Short).setRequired(true);
      const footer = new TextInputBuilder().setCustomId("footer").setLabel("Footer (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      const thumb = new TextInputBuilder().setCustomId("thumb").setLabel("Thumbnail-URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      const image = new TextInputBuilder().setCustomId("image").setLabel("Bild-URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(color),
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(footer),
        new ActionRowBuilder().addComponents(thumb),
        new ActionRowBuilder().addComponents(image),
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "custom_embed_modal") {
      const color = i.fields.getTextInputValue("color") || "#9b5de5";
      const title = i.fields.getTextInputValue("title");
      const footer = i.fields.getTextInputValue("footer");
      const thumb = i.fields.getTextInputValue("thumb");
      const image = i.fields.getTextInputValue("image");
      const embed = new EmbedBuilder().setColor(color).setTitle(title).setImage(image || null).setThumbnail(thumb || null);
      if (footer) embed.setFooter({ text: footer });
      return i.reply({ embeds: [embed] });
    }

    // ---------------- TICKET PANEL (/panel) ----------------
    if (i.isChatInputCommand() && i.commandName === "panel") {
      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("🎟 Support & Bewerbungen")
        .setDescription(
          `Bitte wähle unten die Art deines Tickets aus:\n\n` +
          `💰 **Shop Ticket** – Käufe & Bestellungen\n` +
          `🎥 **Streamer Bewerbung** – Bewirb dich als Creator\n` +
          `✍️ **Kandar Bewerbung** – Allgemeine Bewerbung\n` +
          `🎨 **Designer Bewerbung** – Deine Bewerbung als Designer\n` +
          `✂️ **Cutter Bewerbung** – Deine Bewerbung als Cutter\n` +
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

    // Ticket Auswahl
    if (i.isStringSelectMenu() && i.customId === "ticket_select") {
      const choice = i.values[0];
      // SHOP → Modal
      if (choice === "shop") {
        const modal = new ModalBuilder().setCustomId("shop_ticket_modal").setTitle("💰 Shop Ticket erstellen");
        const payment = new TextInputBuilder().setCustomId("payment").setLabel("Zahlungsmethode (PayPal/Überweisung)").setStyle(TextInputStyle.Short).setRequired(true);
        const item = new TextInputBuilder().setCustomId("item").setLabel("Artikel / Produktname").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(payment), new ActionRowBuilder().addComponents(item));
        return i.showModal(modal);
      }
      // STREAMER → Modal
      if (choice === "streamer") {
        const modal = new ModalBuilder().setCustomId("streamer_ticket_modal").setTitle("🎥 Streamer Bewerbung");
        const follower = new TextInputBuilder().setCustomId("follower").setLabel("Follower (z.B. 1200)").setStyle(TextInputStyle.Short).setRequired(true);
        const avgViewer = new TextInputBuilder().setCustomId("avg_viewer").setLabel("Durchschnittliche Viewer").setStyle(TextInputStyle.Short).setRequired(true);
        const twitch = new TextInputBuilder().setCustomId("twitch_link").setLabel("Twitch-Link").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(follower),
          new ActionRowBuilder().addComponents(avgViewer),
          new ActionRowBuilder().addComponents(twitch)
        );
        return i.showModal(modal);
      }

      // andere direkt Channel
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

      const embed = new EmbedBuilder().setColor("#00FF00").setTitle(data.title).setDescription(data.desc).setImage(BANNER_URL);
      const closeBtn = new ButtonBuilder().setCustomId("ticket_close").setLabel("Ticket schließen").setStyle(ButtonStyle.Danger);
      await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
      return i.reply({ content: `✅ Ticket erstellt: ${ch}`, ephemeral: true });
    }

    // Shop Modal Submit
    if (i.isModalSubmit() && i.customId === "shop_ticket_modal") {
      const payment = i.fields.getTextInputValue("payment");
      const item = i.fields.getTextInputValue("item");
      const guild = i.guild;
      const catName = "💰 Shop Tickets";
      let cat = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
      if (!cat) cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

      const ch = await guild.channels.create({
        name: `💰-${i.user.username}`,
        type: ChannelType.GuildText,
        parent: cat.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
          { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        ],
      });

      const embed = new EmbedBuilder()
        .setColor("#00FF00").setTitle("💰 Shop Ticket")
        .setDescription(`🧾 **Zahlungsmethode:** ${payment}\n📦 **Artikel:** ${item}`)
        .setFooter({ text: "Bitte beschreibe dein Anliegen genauer." })
        .setImage(BANNER_URL);

      const closeBtn = new ButtonBuilder().setCustomId("ticket_close").setLabel("Ticket schließen").setStyle(ButtonStyle.Danger);
      await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
      return i.reply({ content: `✅ Shop Ticket erstellt: ${ch}`, ephemeral: true });
    }

    // Streamer Modal Submit
    if (i.isModalSubmit() && i.customId === "streamer_ticket_modal") {
      const follower = i.fields.getTextInputValue("follower");
      const avgViewer = i.fields.getTextInputValue("avg_viewer");
      const twitch = i.fields.getTextInputValue("twitch_link");
      const guild = i.guild;

      const catName = "🎥 Streamer Bewerbungen";
      let cat = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
      if (!cat) cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

      const ch = await guild.channels.create({
        name: `🎥-${i.user.username}`, type: ChannelType.GuildText, parent: cat.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
          { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        ],
      });

      const embed = new EmbedBuilder()
        .setColor("#00FF88")
        .setTitle("🎥 Streamer Bewerbung")
        .setDescription(`👤 **Follower:** ${follower}\n📈 **Average Viewer:** ${avgViewer}\n🔗 **Twitch:** ${twitch}`)
        .setFooter({ text: "Bitte warte auf eine Rückmeldung vom Team." })
        .setImage(BANNER_URL);

      const closeBtn = new ButtonBuilder().setCustomId("ticket_close").setLabel("Ticket schließen").setStyle(ButtonStyle.Danger);
      await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
      return i.reply({ content: `✅ Streamer Bewerbung erstellt: ${ch}`, ephemeral: true });
    }

    // Ticket schließen Button -> Modal Grund
    if (i.isButton() && i.customId === "ticket_close") {
      const modal = new ModalBuilder().setCustomId("ticket_close_reason").setTitle("Ticket schließen");
      const reason = new TextInputBuilder().setCustomId("reason").setLabel("Grund des Schließens").setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(reason));
      return i.showModal(modal);
    }
    if (i.isModalSubmit() && i.customId === "ticket_close_reason") {
      const reason = i.fields.getTextInputValue("reason");
      try {
        await i.reply({ content: `🔒 Ticket wird geschlossen. Grund: ${reason}`, ephemeral: true });
        // Lock channel for author if we can detect them from last message mention; otherwise just rename/lock
        await i.channel.edit({ name: `closed-${i.channel.name}` });
        // Deny everyone view (keine Leaks)
        await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false }).catch(() => {});
      } catch {}
    }

    // ---------------- CREATOR ADD ----------------
    if (i.isChatInputCommand() && i.commandName === "creator" && i.options.getSubcommand() === "add") {
      const modal = new ModalBuilder().setCustomId("creator_add_modal").setTitle("Creator hinzufügen");
      const fields = [
        { id: "title", label: "Titel des Embeds", style: TextInputStyle.Short, req: true },
        { id: "creatorId", label: "Discord-ID des Creators", style: TextInputStyle.Short, req: true },
        { id: "twitch", label: "Twitch Link", style: TextInputStyle.Short, req: true },
        { id: "youtube", label: "YouTube Link (Optional)", style: TextInputStyle.Short, req: false },
        { id: "tiktok", label: "TikTok Link (Optional)", style: TextInputStyle.Short, req: false },
        { id: "instagram", label: "Instagram Link (Optional)", style: TextInputStyle.Short, req: false },
        { id: "code", label: "Creator Code (Optional)", style: TextInputStyle.Short, req: false },
      ];
      modal.addComponents(
        ...fields.map(f => new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style).setRequired(f.req)
        ))
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "creator_add_modal") {
      const guild = i.guild;
      const title = i.fields.getTextInputValue("title");
      const creatorId = i.fields.getTextInputValue("creatorId");
      const twitch = i.fields.getTextInputValue("twitch");
      const youtube = i.fields.getTextInputValue("youtube") || "";
      const tiktok = i.fields.getTextInputValue("tiktok") || "";
      const instagram = i.fields.getTextInputValue("instagram") || "";
      const code = i.fields.getTextInputValue("code") || "";

      const member = guild.members.cache.get(creatorId);
      if (member) {
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === "creator");
        if (role) await member.roles.add(role).catch(() => null);
      }

      const embed = new EmbedBuilder()
        .setColor("#9b5de5")
        .setTitle(title)
        .addFields({ name: "Twitch", value: twitch });
      if (youtube) embed.addFields({ name: "YouTube", value: youtube });
      if (tiktok) embed.addFields({ name: "TikTok", value: tiktok });
      if (instagram) embed.addFields({ name: "Instagram", value: instagram });
      if (code) embed.addFields({ name: "Creator Code", value: code });

      const msg = await i.reply({ embeds: [embed], fetchReply: true });
      const arr = readJSON(FILES.creators);
      arr.push({ title, creatorId, twitch, youtube, tiktok, instagram, code, messageId: msg.id, channelId: msg.channel.id });
      writeJSON(FILES.creators, arr);
      return i.followUp({ content: "✅ Creator erstellt!", ephemeral: true });
    }

    // ---------------- GIVEAWAY ----------------
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
        .setColor("#9B5DE5")
        .setTitle("🎉 Neues Giveaway 🎉")
        .setDescription(`**Preis:** ${preis}\n🎁 **Gewinner:** ${gewinner}\n👥 **Teilnehmer:** 0\n⏰ **Endet in:** ${dauerStr}\n\nKlicke unten, um teilzunehmen!`)
        .setImage(BANNER_URL)
        .setTimestamp(new Date(endZeit))
        .setFooter({ text: "Endet automatisch" });

      const btn = new ButtonBuilder().setCustomId("giveaway_join").setLabel("Teilnehmen 🎉").setStyle(ButtonStyle.Primary);
      const msg = await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)], fetchReply: true });

      const giveaways = readJSON(FILES.giveaways);
      giveaways.push({
        messageId: msg.id, channelId: msg.channel.id, guildId: msg.guild.id,
        preis, endZeit, gewinner, teilnehmer: [], beendet: false,
      });
      writeJSON(FILES.giveaways, giveaways);
      setTimeout(() => endGiveaway(msg.id).catch(()=>{}), dauer);
    }

    if (i.isButton() && i.customId === "giveaway_join") {
      const giveaways = readJSON(FILES.giveaways);
      const g = giveaways.find(x => x.messageId === i.message.id);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (g.beendet) return i.reply({ content: "🚫 Dieses Giveaway ist beendet!", ephemeral: true });
      if (g.teilnehmer.includes(i.user.id)) return i.reply({ content: "⚠️ Du bist bereits dabei!", ephemeral: true });

      g.teilnehmer.push(i.user.id);
      writeJSON(FILES.giveaways, giveaways);

      // Update Teilnehmer im Embed
      const old = i.message.embeds[0];
      const newEmbed = EmbedBuilder.from(old);
      const lines = (old.description || "").split("\n").map(l => {
        if (l.startsWith("👥 ")) return `👥 **Teilnehmer:** ${g.teilnehmer.length}`;
        return l;
      });
      newEmbed.setDescription(lines.join("\n"));
      await i.message.edit({ embeds: [newEmbed] });

      return i.reply({ content: "✅ Teilnahme gespeichert!", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "reroll") {
      const msgid = i.options.getString("msgid");
      const g = readJSON(FILES.giveaways).find(x => x.messageId === msgid);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (!g.teilnehmer.length) return i.reply({ content: "😢 Keine Teilnehmer!", ephemeral: true });
      const winners = Array.from({ length: g.gewinner }, () => `<@${g.teilnehmer[Math.floor(Math.random() * g.teilnehmer.length)]}>`);
      return i.reply(`🔁 Neue Gewinner für **${g.preis}**: ${winners.join(", ")}`);
    }

    if (i.isChatInputCommand() && i.commandName === "end") {
      await endGiveaway(i.options.getString("msgid"), i);
    }

    // ---------------- NUKE ----------------
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

    // ---------------- SHOP ----------------
    if (i.isChatInputCommand() && i.commandName === "shop") {
      const sub = i.options.getSubcommand();
      const shop = readJSON(FILES.shop); // [{name, price}]
      if (sub === "add") {
        const name = i.options.getString("name");
        const preis = i.options.getNumber("preis");
        if (shop.find(s => s.name.toLowerCase() === name.toLowerCase()))
          return i.reply({ content: "⚠️ Artikel existiert bereits.", ephemeral: true });
        shop.push({ name, price: Number(preis) });
        writeJSON(FILES.shop, shop);
        const e = new EmbedBuilder().setColor("#00cc66").setTitle("🛒 Artikel hinzugefügt").setDescription(`**${name}** — **${euro(preis)}€**`).setImage(BANNER_URL);
        return i.reply({ embeds: [e] });
      }
      if (sub === "remove") {
        const name = i.options.getString("name");
        const idx = shop.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
        if (idx === -1) return i.reply({ content: "❌ Artikel nicht gefunden.", ephemeral: true });
        shop.splice(idx, 1);
        writeJSON(FILES.shop, shop);
        const e = new EmbedBuilder().setColor("#cc0000").setTitle("🗑️ Artikel entfernt").setDescription(`**${name}**`).setImage(BANNER_URL);
        return i.reply({ embeds: [e] });
      }
      if (sub === "list") {
        if (!shop.length) return i.reply("🛍️ Keine Artikel im Sortiment.");
        const lines = shop.map(s => `• ${s.name} — **${euro(s.price)}€**`).join("\n");
        const e = new EmbedBuilder().setColor("#9b5de5").setTitle("🛍️ Sortiment").setDescription(lines).setImage(BANNER_URL);
        return i.reply({ embeds: [e] });
      }
    }

    // ---------------- ORDER ----------------
    if (i.isChatInputCommand() && i.commandName === "order") {
      const customer = i.options.getUser("kunde");
      const shop = readJSON(FILES.shop);
      if (!shop.length) return i.reply({ content: "❌ Keine Shop-Artikel vorhanden. Füge welche mit `/shop add` hinzu.", ephemeral: true });

      const select = new StringSelectMenuBuilder()
        .setCustomId("order_select_item")
        .setPlaceholder("Artikel auswählen…")
        .addOptions(shop.slice(0, 25).map(s => ({ label: `${s.name} (${euro(s.price)}€)`, value: s.name })));

      const embed = new EmbedBuilder()
        .setColor("#9b5de5")
        .setTitle(`🧾 Bestellung von ${customer.tag}`)
        .setDescription(`🛒 **Artikel:** *(noch leer)*\n💶 **Gesamt:** **0.00€**\n\n${BRAND}`)
        .setFooter({ text: `${BRAND} • Bestellung offen` })
        .setImage(BANNER_URL);

      const addBtn = new ButtonBuilder().setCustomId("order_add_item").setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success);
      const remBtn = new ButtonBuilder().setCustomId("order_remove_item").setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary);
      const workBtn = new ButtonBuilder().setCustomId("order_work").setLabel("🛠️ Bestellung bearbeiten").setStyle(ButtonStyle.Primary);
      const finishBtn = new ButtonBuilder().setCustomId("order_finish").setLabel("✅ Bestellung abschließen").setStyle(ButtonStyle.Success);
      const cancelBtn = new ButtonBuilder().setCustomId("order_cancel").setLabel("🗑️ Abbrechen").setStyle(ButtonStyle.Danger);
      // PayPal button will be generated dynamically (Link style) with total=0.00 initially:
      const payBtn = new ButtonBuilder().setLabel(`Jetzt 0.00€ zahlen`).setStyle(ButtonStyle.Link).setURL(`https://www.paypal.com/paypalme/${PAYPAL_USER}/0.00`);

      const row1 = new ActionRowBuilder().addComponents(select);
      const row2 = new ActionRowBuilder().addComponents(addBtn, remBtn, workBtn);
      const row3 = new ActionRowBuilder().addComponents(finishBtn, cancelBtn, payBtn);

      const msg = await i.reply({ embeds: [embed], components: [row1, row2, row3], fetchReply: true });

      activeOrders.set(msg.id, { items: [], customerId: customer.id });
      // persist basic order shell
      const orders = readJSON(FILES.orders);
      orders.push({ messageId: msg.id, channelId: msg.channel.id, guildId: msg.guild.id, customerId: customer.id, items: [], closed: false });
      writeJSON(FILES.orders, orders);
    }

    // ORDER: dropdown choose -> just acknowledge (items actually added via "Artikel hinzufügen")
    if (i.isStringSelectMenu() && i.customId === "order_select_item") {
      // No-op hint
      return i.reply({ content: "ℹ️ Nutze **'➕ Artikel hinzufügen'**, um den ausgewählten Artikel der Bestellung hinzuzufügen.", ephemeral: true });
    }

    // ORDER: buttons
    if (i.isButton() && i.customId.startsWith("order_")) {
      const state = activeOrders.get(i.message.id);
      const orders = readJSON(FILES.orders);
      const order = orders.find(o => o.messageId === i.message.id);
      if (!state || !order || order.closed) return i.reply({ content: "❌ Diese Bestellung ist nicht mehr aktiv.", ephemeral: true });

      const shop = readJSON(FILES.shop);

      // helper to recalc & update embed + paypal button
      const updateOrderView = async () => {
        const total = state.items.reduce((a, b) => a + b.price, 0);
        const list = state.items.length ? state.items.map((it, idx)=>`${idx+1}. ${it.name} — **${euro(it.price)}€**`).join("\n") : "*(noch leer)*";
        const newEmbed = EmbedBuilder.from(i.message.embeds[0])
          .setDescription(`🛒 **Artikel:**\n${list}\n\n💶 **Gesamt:** **${euro(total)}€**\n\n${BRAND}`);
        // rebuild rows to update PayPal link label/url
        const components = i.message.components.map(r => ActionRowBuilder.from(r));
        // last row has the link button at index 2
        const lastRow = components[2];
        const newPay = ButtonBuilder.from(lastRow.components[2])
          .setLabel(`Jetzt ${euro(total)}€ zahlen`)
          .setURL(`https://www.paypal.com/paypalme/${PAYPAL_USER}/${euro(total)}`);
        lastRow.setComponents(
          ButtonBuilder.from(lastRow.components[0]),
          ButtonBuilder.from(lastRow.components[1]),
          newPay
        );
        await i.message.edit({ embeds: [newEmbed], components });
        // persist
        order.items = [...state.items];
        writeJSON(FILES.orders, orders);
      };

      if (i.customId === "order_add_item") {
        // Add selected item via modal (name)
        const modal = new ModalBuilder().setCustomId(`order_add_modal:${i.message.id}`).setTitle("Artikel hinzufügen");
        const name = new TextInputBuilder().setCustomId("name").setLabel("Artikelname (wie im Shop)").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(name));
        return i.showModal(modal);
      }

      if (i.customId === "order_remove_item") {
        if (!state.items.length) return i.reply({ content: "⚠️ Keine Artikel zum Entfernen.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`order_remove_modal:${i.message.id}`).setTitle("Artikel entfernen");
        const index = new TextInputBuilder().setCustomId("index").setLabel("Positionsnummer (1,2,3,...)").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(index));
        return i.showModal(modal);
      }

      if (i.customId === "order_work") {
        if (!isTeam(i.member)) return i.reply({ content: "❌ Nur Team-Mitglieder!", ephemeral: true });
        const customer = await client.users.fetch(order.customerId).catch(()=>null);
        // DM the customer
        if (customer) {
          const dmEmbed = new EmbedBuilder()
            .setColor("#9b5de5")
            .setTitle("🛠️ Deine Bestellung wird bearbeitet!")
            .setDescription("⏳ Bitte hab einen Moment Geduld – unser Team kümmert sich gerade um deine Bestellung.\n\nVielen Dank! 💜")
            .setImage(BANNER_URL)
            .setFooter({ text: BRAND });
          customer.send({ embeds: [dmEmbed] }).catch(()=>{});
        }
        // Update title
        const newEmbed = EmbedBuilder.from(i.message.embeds[0]).setTitle(i.message.embeds[0].title.replace("Bestellung von", "⏳ Bestellung in Bearbeitung – von"));
        await i.message.edit({ embeds: [newEmbed] });
        return i.reply({ content: "🛠️ Bestellung auf 'in Bearbeitung' gesetzt.", ephemeral: true });
      }

      if (i.customId === "order_finish") {
        // close order, trigger finish handling
        order.closed = true;
        writeJSON(FILES.orders, orders);
        activeOrders.delete(i.message.id);
        await i.reply({ content: "✅ Bestellung abgeschlossen. Feedback wird vorbereitet…", ephemeral: true });
        await triggerFinish(i.guild, i.channel, order.customerId, i.user);
        // disable components
        const comps = i.message.components.map(r => {
          const row = ActionRowBuilder.from(r);
          row.components = row.components.map(c => ButtonBuilder.from(c).setDisabled(true));
          return row;
        });
        await i.message.edit({ components: comps });
      }

      if (i.customId === "order_cancel") {
        order.closed = true;
        writeJSON(FILES.orders, orders);
        activeOrders.delete(i.message.id);
        await i.reply({ content: "❌ Bestellung abgebrochen.", ephemeral: true });
        const comps = i.message.components.map(r => {
          const row = ActionRowBuilder.from(r);
          row.components = row.components.map(c => ButtonBuilder.from(c).setDisabled(true));
          return row;
        });
        await i.message.edit({ components: comps });
      }
    }

    // ORDER: add/remove modals
    if (i.isModalSubmit() && i.customId.startsWith("order_add_modal:")) {
      const msgId = i.customId.split(":")[1];
      const state = activeOrders.get(msgId);
      const orders = readJSON(FILES.orders);
      const order = orders.find(o => o.messageId === msgId);
      if (!state || !order || order.closed) return i.reply({ content: "❌ Diese Bestellung ist nicht mehr aktiv.", ephemeral: true });

      const name = i.fields.getTextInputValue("name");
      const shop = readJSON(FILES.shop);
      const item = shop.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (!item) return i.reply({ content: "❌ Artikel nicht im Shop gefunden.", ephemeral: true });

      state.items.push({ name: item.name, price: Number(item.price) });
      order.items = [...state.items];
      writeJSON(FILES.orders, orders);

      // update view
      const msg = await i.channel.messages.fetch(msgId);
      const fakeInteraction = { message: msg, ...i };
      await (async () => {
        const total = state.items.reduce((a, b) => a + b.price, 0);
        const list = state.items.length ? state.items.map((it, idx)=>`${idx+1}. ${it.name} — **${euro(it.price)}€**`).join("\n") : "*(noch leer)*";
        const newEmbed = EmbedBuilder.from(msg.embeds[0])
          .setDescription(`🛒 **Artikel:**\n${list}\n\n💶 **Gesamt:** **${euro(total)}€**\n\n${BRAND}`);
        const components = msg.components.map(r => ActionRowBuilder.from(r));
        const lastRow = components[2];
        const newPay = ButtonBuilder.from(lastRow.components[2])
          .setLabel(`Jetzt ${euro(total)}€ zahlen`)
          .setURL(`https://www.paypal.com/paypalme/${PAYPAL_USER}/${euro(total)}`);
        lastRow.setComponents(
          ButtonBuilder.from(lastRow.components[0]),
          ButtonBuilder.from(lastRow.components[1]),
          newPay
        );
        await msg.edit({ embeds: [newEmbed], components });
      })();

      return i.reply({ content: "✅ Artikel hinzugefügt.", ephemeral: true });
    }

    if (i.isModalSubmit() && i.customId.startsWith("order_remove_modal:")) {
      const msgId = i.customId.split(":")[1];
      const state = activeOrders.get(msgId);
      const orders = readJSON(FILES.orders);
      const order = orders.find(o => o.messageId === msgId);
      if (!state || !order || order.closed) return i.reply({ content: "❌ Diese Bestellung ist nicht mehr aktiv.", ephemeral: true });

      const indexStr = i.fields.getTextInputValue("index");
      const idx = Number(indexStr) - 1;
      if (isNaN(idx) || idx < 0 || idx >= state.items.length) return i.reply({ content: "❌ Ungültige Positionsnummer.", ephemeral: true });

      state.items.splice(idx, 1);
      order.items = [...state.items];
      writeJSON(FILES.orders, orders);

      const msg = await i.channel.messages.fetch(msgId);
      await (async () => {
        const total = state.items.reduce((a, b) => a + b.price, 0);
        const list = state.items.length ? state.items.map((it, idx)=>`${idx+1}. ${it.name} — **${euro(it.price)}€**`).join("\n") : "*(noch leer)*";
        const newEmbed = EmbedBuilder.from(msg.embeds[0])
          .setDescription(`🛒 **Artikel:**\n${list}\n\n💶 **Gesamt:** **${euro(total)}€**\n\n${BRAND}`);
        const components = msg.components.map(r => ActionRowBuilder.from(r));
        const lastRow = components[2];
        const newPay = ButtonBuilder.from(lastRow.components[2])
          .setLabel(`Jetzt ${euro(total)}€ zahlen`)
          .setURL(`https://www.paypal.com/paypalme/${PAYPAL_USER}/${euro(total)}`);
        lastRow.setComponents(
          ButtonBuilder.from(lastRow.components[0]),
          ButtonBuilder.from(lastRow.components[1]),
          newPay
        );
        await msg.edit({ embeds: [newEmbed], components });
      })();

      return i.reply({ content: "🗑️ Artikel entfernt.", ephemeral: true });
    }

    // ---------------- FINISH (Team only) ----------------
    if (i.isChatInputCommand() && i.commandName === "finish") {
      if (!isTeam(i.member)) return i.reply({ content: "❌ Nur Team-Mitglieder!", ephemeral: true });
      const customer = i.options.getUser("kunde");
      await triggerFinish(i.guild, i.channel, customer.id, i.user);
      return i.reply({ content: "✅ Kunde markiert & Feedback vorbereitet.", ephemeral: true });
    }

    // FEEDBACK BUTTON -> Modal
    if (i.isButton() && i.customId.startsWith("feedback_start:")) {
      const customerId = i.customId.split(":")[1];
      if (i.user.id !== customerId && !isTeam(i.member))
        return i.reply({ content: "❌ Nur der Kunde kann Feedback abgeben.", ephemeral: true });

      const modal = new ModalBuilder().setCustomId(`feedback_modal:${customerId}`).setTitle("Feedback abgeben");
      const stars = new TextInputBuilder().setCustomId("stars").setLabel("Sterne (1-5)").setStyle(TextInputStyle.Short).setRequired(true);
      const text = new TextInputBuilder().setCustomId("text").setLabel("Dein Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(stars), new ActionRowBuilder().addComponents(text));
      return i.showModal(modal);
    }

    // FEEDBACK MODAL -> Seller select
    if (i.isModalSubmit() && i.customId.startsWith("feedback_modal:")) {
      const customerId = i.customId.split(":")[1];
      const stars = i.fields.getTextInputValue("stars");
      const text = i.fields.getTextInputValue("text");

      // store temporary in message token
      const tmpPayload = JSON.stringify({ customerId, stars, text });
      const select = new UserSelectMenuBuilder().setCustomId(`feedback_pick_seller:${encodeURIComponent(tmpPayload)}`).setPlaceholder("Verkäufer auswählen");
      return i.reply({ content: "Bitte wähle den Verkäufer aus:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    // FEEDBACK SELLER PICK
    if (i.isUserSelectMenu() && i.customId.startsWith("feedback_pick_seller:")) {
      const payload = JSON.parse(decodeURIComponent(i.customId.split(":")[1]));
      const seller = i.values[0];
      const customer = await client.users.fetch(payload.customerId).catch(()=>null);
      const sellerUser = await client.users.fetch(seller).catch(()=>null);
      const ch = i.guild.channels.cache.get(process.env.FEEDBACK_CHANNEL_ID);
      if (!ch) return i.reply({ content: "❌ Feedback-Channel nicht gefunden.", ephemeral: true });

      const s = Math.max(1, Math.min(5, parseInt(payload.stars) || 5));
      const starsTxt = "⭐".repeat(s) + "☆".repeat(5 - s);

      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("📝 Neues Feedback eingegangen!")
        .setDescription(
          `👤 **Kunde:** ${customer ? customer.tag : payload.customerId}\n` +
          `🛍️ **Verkäufer:** ${sellerUser ? sellerUser.tag : seller}\n` +
          `⭐ **Bewertung:** ${starsTxt}\n\n` +
          `💬 **Feedback:**\n${payload.text}`
        )
        .setFooter({ text: "Kandar Streaming" })
        .setImage(BANNER_URL);

      await ch.send({ embeds: [embed] });
      return i.update({ content: "✅ Danke für dein Feedback!", components: [] });
    }

    // ---------------- STREAMER AUTO-ANNOUNCE ----------------
    if (i.isChatInputCommand() && i.commandName === "streamer") {
      const sub = i.options.getSubcommand();
      const arr = readJSON(FILES.streamers); // [{name, channelId, live:false}]
      if (sub === "add") {
        const name = i.options.getString("name").toLowerCase();
        if (arr.find(s => s.name === name)) return i.reply({ content: "⚠️ Streamer existiert bereits.", ephemeral: true });
        arr.push({ name, channelId: i.channel.id, live: false });
        writeJSON(FILES.streamers, arr);
        return i.reply(`✅ Streamer **${name}** wird nun automatisch announced in ${i.channel}.`);
      }
      if (sub === "remove") {
        const name = i.options.getString("name").toLowerCase();
        const idx = arr.findIndex(s => s.name === name);
        if (idx === -1) return i.reply({ content: "❌ Streamer nicht gefunden.", ephemeral: true });
        arr.splice(idx, 1);
        writeJSON(FILES.streamers, arr);
        return i.reply(`🗑️ Streamer **${name}** entfernt.`);
      }
      if (sub === "list") {
        if (!arr.length) return i.reply("📭 Keine Streamer eingetragen.");
        const lines = arr.map(s => `• **${s.name}** → <#${s.channelId}>`).join("\n");
        const e = new EmbedBuilder().setColor("#9146FF").setTitle("📺 Auto-Announce Streamer").setDescription(lines).setImage(BANNER_URL);
        return i.reply({ embeds: [e] });
      }
    }

  } catch (err) {
    console.error("❌ Interaktionsfehler:", err);
  }
});

// ---------- GIVEAWAY END ----------
async function endGiveaway(msgid, interaction = null) {
  const giveaways = readJSON(FILES.giveaways);
  const g = giveaways.find(x => x.messageId === msgid);
  if (!g || g.beendet) return;
  g.beendet = true;
  writeJSON(FILES.giveaways, giveaways);

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
      return interaction?.reply?.({ content: "❌ Keine Teilnehmer. Giveaway beendet.", ephemeral: true });
    }

    const winners = Array.from({ length: g.gewinner }, () => `<@${g.teilnehmer[Math.floor(Math.random() * g.teilnehmer.length)]}>`);
    const embed = EmbedBuilder.from(msg.embeds[0])
      .setColor("#9B5DE5")
      .setDescription(`**Preis:** ${g.preis}\n👥 **Teilnehmer:** ${g.teilnehmer.length}\n🏆 **Gewinner:** ${winners.join(", ")}`)
      .setFooter({ text: "Giveaway beendet" });

    await msg.edit({ embeds: [embed], components: [] });
    await ch.send(`🎉 Glückwunsch ${winners.join(", ")}! Ihr habt **${g.preis}** gewonnen!`);
    if (interaction) await interaction.reply({ content: "✅ Giveaway beendet!", ephemeral: true });
  } catch (err) {
    console.error("❌ Fehler beim Beenden des Giveaways:", err);
  }
}

// ---------- FINISH HANDLER ----------
async function triggerFinish(guild, channel, customerId, staffUser) {
  // Rolle geben
  const roleId = process.env.CUSTOMER_ROLE_ID;
  if (roleId) {
    try {
      const member = await guild.members.fetch(customerId).catch(()=>null);
      if (member) await member.roles.add(roleId, "Order finished / finish command");
    } catch {}
  }
  // Feedback Button
  const feedbackEmbed = new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle("🧾 Bestellung abgeschlossen!")
    .setDescription("💬 Bitte gib uns dein Feedback — das hilft uns, noch besser zu werden! ✨")
    .setImage(BANNER_URL)
    .setFooter({ text: BRAND });

  const btn = new ButtonBuilder().setCustomId(`feedback_start:${customerId}`).setLabel("⭐ Feedback abgeben").setStyle(ButtonStyle.Primary);
  await channel.send({ content: `<@${customerId}>`, embeds: [feedbackEmbed], components: [new ActionRowBuilder().addComponents(btn)] });
}

// ---------- LOGGING ----------
client.on("guildMemberAdd", m => {
  const log = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("👋 Neues Mitglied").setDescription(`${m} ist beigetreten.`)] });
});
client.on("guildMemberRemove", m => {
  const log = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🚪 Mitglied hat verlassen").setDescription(`${m.user.tag} hat den Server verlassen.`)] });
});
client.on("messageDelete", msg => {
  if (!msg.guild || msg.author?.bot) return;
  const log = msg.guild.channels.cache.get(process.env.MESSAGE_LOGS_CHANNEL_ID);
  if (!log) return;
  const embed = new EmbedBuilder().setColor("#FF0000").setTitle("🗑 Nachricht gelöscht").setDescription(`Von ${msg.author}\nIn ${msg.channel}\n\n${msg.content || "[Embed/Datei]"}`);
  log.send({ embeds: [embed] });
});
client.on("channelCreate", ch => {
  const log = ch.guild.channels.cache.get(process.env.CHANNEL_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("📢 Channel erstellt").setDescription(`${ch.name}`)] });
});
client.on("channelDelete", ch => {
  const log = ch.guild.channels.cache.get(process.env.CHANNEL_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑 Channel gelöscht").setDescription(`${ch.name}`)] });
});
client.on("roleCreate", r => {
  const log = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("🎭 Rolle erstellt").setDescription(`${r.name}`)] });
});
client.on("roleDelete", r => {
  const log = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🎭 Rolle gelöscht").setDescription(`${r.name}`)] });
});
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

// ---------- TWITCH POLLER ----------
let twitchToken = null;
let twitchTokenExp = 0;
async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchTokenExp) return twitchToken;
  const res = await fetch(`https://id.twitch.tv/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID || "",
      client_secret: process.env.TWITCH_CLIENT_SECRET || "",
      grant_type: "client_credentials"
    })
  });
  const data = await res.json();
  twitchToken = data.access_token;
  twitchTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return twitchToken;
}
async function isLive(login) {
  const token = await getTwitchToken();
  const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: {
      "Client-Id": process.env.TWITCH_CLIENT_ID || "",
      "Authorization": `Bearer ${token}`
    }
  });
  const data = await res.json();
  return (data.data && data.data.length) ? data.data[0] : null;
}
async function startTwitchPoller() {
  setInterval(async () => {
    try {
      const list = readJSON(FILES.streamers); // {name, channelId, live}
      if (!list.length) return;
      for (const entry of list) {
        const stream = await isLive(entry.name);
        if (stream && !entry.live) {
          // became live
          entry.live = true;
          writeJSON(FILES.streamers, list);
          const ch = await client.channels.fetch(entry.channelId).catch(()=>null);
          if (ch && ch.isTextBased()) {
            const thumb = (stream.thumbnail_url || "").replace("{width}", "1280").replace("{height}", "720");
            const e = new EmbedBuilder()
              .setColor("#9146FF")
              .setTitle(`🔴 ${stream.user_name} ist jetzt LIVE!`)
              .setDescription(`📺 **${stream.title}**\n🎮 **${stream.game_name || "Just Chatting"}**\n👥 **Viewers:** ${stream.viewer_count}\n\nSchau rein: https://twitch.tv/${entry.name}`)
              .setImage(thumb)
              .setFooter({ text: "Kandar Streaming" });
            ch.send({ embeds: [e] });
          }
        } else if (!stream && entry.live) {
          // went offline
          entry.live = false;
          writeJSON(FILES.streamers, list);
        }
      }
    } catch (e) { /* ignore poll errors */ }
  }, 60 * 1000);
}

// ---------- LOGIN ----------
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ Fehler: DISCORD_TOKEN nicht gesetzt.");
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN).then(() => {
  console.log("✅ Bot gestartet.");
}).catch(err => {
  console.error("❌ Login-Fehler:", err);
  process.exit(1);
});
