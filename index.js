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
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  UserSelectMenuBuilder,
} from "discord.js";
import fs from "fs";
import fetch from "node-fetch";
import "dotenv/config";

/* ===========================
   Setup & Helpers
=========================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences
  ],
});

const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const FILES = {
  giveaways: `${DATA_DIR}/giveaways.json`,
  creators: `${DATA_DIR}/creators.json`,
  shop: `${DATA_DIR}/shop.json`,
  orders: `${DATA_DIR}/orders.json`,
  streamers: `${DATA_DIR}/streamers.json`,
};
for (const f of Object.values(FILES)) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");

const BANNER_URL = "https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif";
const BRAND = process.env.BRAND_NAME || "Kandar Shop";
const TEAM_ROLE_IDS = (process.env.TEAM_ROLE_IDS || "").split(",").map(s => s.trim()).filter(Boolean);

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

const hasTeamRole = (member) => TEAM_ROLE_IDS.some(id => member.roles?.cache?.has(id));

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

const fmtAmount = (n) => Number(n).toFixed(2);

/* Order runtime buffer for ephemeral steps (feedback, etc.) */
const feedbackTemp = new Map(); // key: userId:messageId -> {stars,text}

/* ===========================
   Slash Commands
=========================== */

const commands = [
  // Verify
  new SlashCommandBuilder().setName("verifymsg").setDescription("Sendet die Verify-Nachricht mit Regeln"),

  // PayPal
  new SlashCommandBuilder()
    .setName("paypal").setDescription("Erstellt einen PayPal-Zahlungslink")
    .addNumberOption(o => o.setName("betrag").setDescription("Betrag in EUR (z.B. 12.99)").setRequired(true)),

  // Ticket Panel
  new SlashCommandBuilder().setName("panel").setDescription("Sendet das Ticket-Panel (Dropdown + Close-Button)"),

  // Nuke
  new SlashCommandBuilder()
    .setName("nuke").setDescription("Löscht viele Nachrichten im aktuellen Channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // Creator
  new SlashCommandBuilder()
    .setName("creator").setDescription("Creator-System")
    .addSubcommand(sub => sub.setName("add").setDescription("Erstellt ein Creator-Panel mit Social-Links")),

  // Giveaways
  new SlashCommandBuilder()
    .setName("giveaway").setDescription("Starte ein neues Giveaway")
    .addStringOption(o => o.setName("preis").setDescription("Preis").setRequired(true))
    .addStringOption(o => o.setName("dauer").setDescription("z.B. 1d, 2h, 30m").setRequired(true))
    .addIntegerOption(o => o.setName("gewinner").setDescription("Anzahl der Gewinner").setRequired(true)),

  new SlashCommandBuilder()
    .setName("reroll").setDescription("Ziehe neue Gewinner")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("end").setDescription("Beende ein Giveaway")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),

  // Shop
  new SlashCommandBuilder()
    .setName("shop").setDescription("Shop-Verwaltung")
    .addSubcommand(s =>
      s.setName("add").setDescription("Artikel hinzufügen")
        .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
        .addNumberOption(o => o.setName("preis").setDescription("Preis in EUR").setRequired(true))
    )
    .addSubcommand(s =>
      s.setName("remove").setDescription("Artikel entfernen")
        .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
    )
    .addSubcommand(s => s.setName("list").setDescription("Alle Artikel anzeigen")),

  // Order
  new SlashCommandBuilder()
    .setName("order").setDescription("Neue Bestellung starten")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),

  // Finish (Kaufabschluss)
  new SlashCommandBuilder()
    .setName("finish").setDescription("Kauf abschließen & Feedback starten (nur Team)")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),

  // Embed Builder
  new SlashCommandBuilder().setName("embed").setDescription("Erstellt ein benutzerdefiniertes Embed über ein Modal"),

  // Streamer
  new SlashCommandBuilder()
    .setName("streamer").setDescription("Streamer-Announce verwalten")
    .addSubcommand(s =>
      s.setName("add").setDescription("Streamer zur Überwachung hinzufügen")
        .addStringOption(o => o.setName("name").setDescription("Twitch Benutzername").setRequired(true))
    ),

  // Rename Ticket
  new SlashCommandBuilder()
    .setName("rename").setDescription("Ticket umbenennen (nur Team)")
    .addStringOption(o => o.setName("name").setDescription("Neuer Channel-Name").setRequired(true)),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID), { body: commands });
  console.log("✅ Slash Commands registriert.");
})();

/* ===========================
   Ready + Re-Arming Giveaways + Stats
=========================== */
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);

  // Re-Arm Giveaways
  const giveaways = load(FILES.giveaways);
  for (const g of giveaways.filter(x => !x.beendet)) {
    const rest = g.endZeit - Date.now();
    if (rest <= 0) endGiveaway(g.messageId).catch(() => {});
    else setTimeout(() => endGiveaway(g.messageId).catch(() => {}), rest);
  }
  console.log(`🎉 Reaktivierte Giveaways: ${giveaways.filter(x => !x.beendet).length}`);

  // Optional: einfache Server-Stats (nicht aggressiv)
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
    const updateStats = async () => {
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
    };
    updateStats();
    setInterval(updateStats, 5 * 60 * 1000);
  }

  // Start Twitch watcher
  startTwitchWatcher();
});

/* ===========================
   Welcome & Booster
=========================== */
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

/* ===========================
   Interaction Handler
=========================== */
client.on("interactionCreate", async (i) => {
  try {
    /* ---------- VERIFY ---------- */
    if (i.isChatInputCommand() && i.commandName === "verifymsg") {
      const rules = [
        "1️⃣ Respektiere alle Mitglieder.",
        "2️⃣ Kein Spam, keine Beleidigungen.",
        "3️⃣ Keine Werbung ohne Erlaubnis.",
        "4️⃣ Nutze die richtigen Channels.",
        "5️⃣ Folge den Anweisungen des Teams."
      ].join("\n");

      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("✅ Verifizierung")
        .setDescription(`Drücke auf **Verifizieren**, um Zugriff zu erhalten.\n\n**Regelwerk:**\n${rules}`)
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND });

      const button = new ButtonBuilder().setCustomId("verify_button").setLabel("Verifizieren").setStyle(ButtonStyle.Success);
      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    if (i.isButton() && i.customId === "verify_button") {
      try {
        const role = i.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
        if (!role) return i.reply({ content: "❌ Verify-Rolle nicht gefunden!", ephemeral: true });
        const member = await i.guild.members.fetch(i.user.id);
        await member.roles.add(role.id);
        return i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
      } catch (err) {
        console.error("Verify error:", err);
        return i.reply({ content: "❌ Konnte die Verify-Rolle nicht vergeben. Bitte Team informieren.", ephemeral: true });
      }
    }

    /* ---------- PAYPAL ---------- */
    if (i.isChatInputCommand() && i.commandName === "paypal") {
      const amount = i.options.getNumber("betrag");
      if (amount == null || isNaN(amount) || amount <= 0) {
        return i.reply({ content: "⚠️ Ungültiger Betrag!", ephemeral: true });
      }
      const link = `https://www.paypal.com/paypalme/${process.env.BRAND_PAYPAL_USERNAME}/${fmtAmount(amount)}`;
      const embed = new EmbedBuilder()
        .setColor("#1f6feb")
        .setTitle("💰 PayPal Zahlung")
        .setDescription(`Klicke auf den Button, um **${fmtAmount(amount)}€** zu zahlen.\n\nMit dem Kauf stimmst du unseren **AGB** zu.`)
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND });
      const btn = new ButtonBuilder().setLabel(`Jetzt ${fmtAmount(amount)}€ zahlen`).setStyle(ButtonStyle.Link).setURL(link);
      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
    }

    /* ---------- TICKET PANEL ---------- */
    if (i.isChatInputCommand() && i.commandName === "panel") {
      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("🎟 Support & Bewerbungen")
        .setDescription(
          `Bitte wähle unten die Art deines Tickets aus:\n\n` +
          `💰 **Shop Ticket** – Käufe & Bestellungen\n` +
          `🎥 **Streamer Bewerbung** – Bewirb dich als Creator\n` +
          `✍️ **Kandar Bewerbung** – Allgemeine Bewerbung\n` +
          `🎨 **Designer Bewerbung** – Für Grafiker\n` +
          `✂️ **Cutter Bewerbung** – Für Videoeditoren\n` +
          `🛠️ **Highteam Anliegen** – Interne Anliegen\n` +
          `👥 **Support Anliegen** – Allgemeiner Support`
        )
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND });

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

    // Ticket Auswahl -> Modals/Channel
    if (i.isStringSelectMenu() && i.customId === "ticket_select") {
      const choice = i.values[0];

      const makeCloseRow = () => {
        const closeBtn = new ButtonBuilder().setCustomId("ticket_close").setLabel("Ticket schließen").setStyle(ButtonStyle.Danger).setEmoji("🔒");
        return new ActionRowBuilder().addComponents(closeBtn);
      };

      if (choice === "shop") {
        const modal = new ModalBuilder().setCustomId("shopTicketModal").setTitle("💰 Shop Ticket erstellen");
        const payment = new TextInputBuilder().setCustomId("payment").setLabel("Zahlungsmethode (PayPal, Überweisung…)").setStyle(TextInputStyle.Short).setRequired(true);
        const item = new TextInputBuilder().setCustomId("item").setLabel("Artikel / Produktname").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(payment), new ActionRowBuilder().addComponents(item));
        return i.showModal(modal);
      }

      if (choice === "streamer") {
        const modal = new ModalBuilder().setCustomId("streamerTicketModal").setTitle("🎥 Streamer Bewerbung");
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

      const embed = new EmbedBuilder().setColor("#00FF00").setTitle(data.title).setDescription(data.desc).setFooter({ text: BRAND });
      await ch.send({ content: `${i.user}`, embeds: [embed], components: [makeCloseRow()] });
      return i.reply({ content: `✅ Ticket erstellt: ${ch}`, ephemeral: true });
    }

    // Ticket Modals submit
    if (i.isModalSubmit() && (i.customId === "shopTicketModal" || i.customId === "streamerTicketModal")) {
      const makeCloseRow = () => {
        const closeBtn = new ButtonBuilder().setCustomId("ticket_close").setLabel("Ticket schließen").setStyle(ButtonStyle.Danger).setEmoji("🔒");
        return new ActionRowBuilder().addComponents(closeBtn);
      };

      if (i.customId === "shopTicketModal") {
        const payment = i.fields.getTextInputValue("payment");
        const item = i.fields.getTextInputValue("item");
        const catName = "💰 Shop Tickets";
        let cat = i.guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
        if (!cat) cat = await i.guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

        const ch = await i.guild.channels.create({
          name: `💰-${i.user.username}`,
          type: ChannelType.GuildText,
          parent: cat.id,
          permissionOverwrites: [
            { id: i.guild.roles.everyone.id, deny: ["ViewChannel"] },
            { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
          ],
        });

        const embed = new EmbedBuilder()
          .setColor("#00FF00").setTitle("💰 Shop Ticket")
          .setDescription(`🧾 **Zahlungsmethode:** ${payment}\n📦 **Artikel:** ${item}`)
          .setFooter({ text: BRAND });
        await ch.send({ content: `${i.user}`, embeds: [embed], components: [makeCloseRow()] });
        return i.reply({ content: `✅ Shop Ticket erstellt: ${ch}`, ephemeral: true });
      }

      if (i.customId === "streamerTicketModal") {
        const follower = i.fields.getTextInputValue("follower");
        const avgViewer = i.fields.getTextInputValue("avg_viewer");
        const twitch = i.fields.getTextInputValue("twitch_link");
        const catName = "🎥 Streamer Bewerbungen";
        let cat = i.guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
        if (!cat) cat = await i.guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

        const ch = await i.guild.channels.create({
          name: `🎥-${i.user.username}`,
          type: ChannelType.GuildText,
          parent: cat.id,
          permissionOverwrites: [
            { id: i.guild.roles.everyone.id, deny: ["ViewChannel"] },
            { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
          ],
        });

        const embed = new EmbedBuilder()
          .setColor("#00FF88").setTitle("🎥 Streamer Bewerbung")
          .setDescription(`👤 **Follower:** ${follower}\n📈 **Average Viewer:** ${avgViewer}\n🔗 **Twitch:** ${twitch}`)
          .setFooter({ text: BRAND });
        await ch.send({ content: `${i.user}`, embeds: [embed], components: [makeCloseRow()] });
        return i.reply({ content: `✅ Streamer Bewerbung erstellt: ${ch}`, ephemeral: true });
      }
    }

    // Ticket Close Button -> Modal Reason
    if (i.isButton() && i.customId === "ticket_close") {
      if (!hasTeamRole(i.member)) {
        return i.reply({ content: "⛔ Nur Team kann Tickets schließen.", ephemeral: true });
      }
      const modal = new ModalBuilder().setCustomId("ticket_close_modal").setTitle("Ticket schließen");
      const reason = new TextInputBuilder().setCustomId("reason").setLabel("Grund").setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(reason));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "ticket_close_modal") {
      const reason = i.fields.getTextInputValue("reason");
      const embed = new EmbedBuilder()
        .setColor("#ff4d4f").setTitle("🔒 Ticket geschlossen")
        .setDescription(`Grund: ${reason}`)
        .setFooter({ text: BRAND })
        .setTimestamp();
      await i.reply({ embeds: [embed] });
      setTimeout(() => i.channel.delete().catch(() => {}), 8000);
    }

    /* ---------- RENAME (nur Team) ---------- */
    if (i.isChatInputCommand() && i.commandName === "rename") {
      if (!hasTeamRole(i.member)) return i.reply({ content: "⛔ Nur Team erlaubt.", ephemeral: true });
      const newName = i.options.getString("name");
      await i.channel.setName(newName);
      return i.reply({ content: `✅ Channel umbenannt zu **${newName}**`, ephemeral: true });
    }

    /* ---------- CREATOR ADD ---------- */
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
      modal.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style).setRequired(f.req)
      )));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "creatorAddModal") {
      const title = i.fields.getTextInputValue("title");
      const creatorId = i.fields.getTextInputValue("creatorId");
      const twitch = i.fields.getTextInputValue("twitch");
      const youtube = i.fields.getTextInputValue("youtube") || "";
      const tiktok = i.fields.getTextInputValue("tiktok") || "";
      const instagram = i.fields.getTextInputValue("instagram") || "";
      const code = i.fields.getTextInputValue("code") || "";

      const member = i.guild.members.cache.get(creatorId);
      if (member) {
        const role = i.guild.roles.cache.find(r => r.name.toLowerCase() === "creator");
        if (role) await member.roles.add(role).catch(() => {});
      }

      const embed = new EmbedBuilder()
        .setColor("#9b5de5").setTitle(title)
        .addFields({ name: "Twitch", value: twitch })
        .setFooter({ text: BRAND });
      if (youtube) embed.addFields({ name: "YouTube", value: youtube });
      if (tiktok) embed.addFields({ name: "TikTok", value: tiktok });
      if (instagram) embed.addFields({ name: "Instagram", value: instagram });
      if (code) embed.addFields({ name: "Creator Code", value: code });

      const msg = await i.reply({ embeds: [embed], fetchReply: true });
      const arr = load(FILES.creators);
      arr.push({ title, creatorId, twitch, youtube, tiktok, instagram, code, messageId: msg.id, channelId: msg.channel.id });
      save(FILES.creators, arr);
      return i.followUp({ content: "✅ Creator erstellt!", ephemeral: true });
    }

    /* ---------- NUKE ---------- */
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

    /* ---------- GIVEAWAYS ---------- */
    if (i.isChatInputCommand() && i.commandName === "giveaway") {
      const preis = i.options.getString("preis");
      const dauerStr = i.options.getString("dauer");
      const gewinner = i.options.getInteger("gewinner");
      if (!gewinner || gewinner < 1) return i.reply({ content: "⚠️ Gewinneranzahl ungültig!", ephemeral: true });
      const dauer = parseDuration(dauerStr);
      if (!dauer || dauer <= 0) return i.reply({ content: "⚠️ Ungültige Dauer (z. B. 1d2h30m).", ephemeral: true });

      const endZeit = Date.now() + dauer;
      const embed = new EmbedBuilder()
        .setColor("#9B5DE5").setTitle("🎉 Neues Giveaway 🎉")
        .setDescription(`**Preis:** ${preis}\n🎁 **Gewinner:** ${gewinner}\n👥 **Teilnehmer:** 0\n⏰ **Endet in:** ${dauerStr}\n\nKlicke unten, um teilzunehmen!`)
        .setImage(BANNER_URL).setTimestamp(new Date(endZeit)).setFooter({ text: "Endet automatisch" });

      const btn = new ButtonBuilder().setCustomId("giveaway_join").setLabel("Teilnehmen 🎉").setStyle(ButtonStyle.Primary);
      const msg = await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)], fetchReply: true });

      const giveaways = load(FILES.giveaways);
      giveaways.push({ messageId: msg.id, channelId: msg.channel.id, guildId: msg.guild.id, preis, endZeit, gewinner, teilnehmer: [], beendet: false });
      save(FILES.giveaways, giveaways);
      setTimeout(() => endGiveaway(msg.id).catch(() => {}), dauer);
    }

    if (i.isButton() && i.customId === "giveaway_join") {
      const giveaways = load(FILES.giveaways);
      const g = giveaways.find(x => x.messageId === i.message.id);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (g.beendet) return i.reply({ content: "🚫 Dieses Giveaway ist beendet!", ephemeral: true });
      if (g.teilnehmer.includes(i.user.id)) return i.reply({ content: "⚠️ Du bist bereits dabei!", ephemeral: true });
      g.teilnehmer.push(i.user.id);
      save(FILES.giveaways, giveaways);

      // Update Teilnehmerzahl im Embed
      const old = i.message.embeds?.[0];
      if (old) {
        const updated = EmbedBuilder.from(old);
        const desc = (old.description || "").replace(/👥 \*\*Teilnehmer:\*\* \d+/i, `👥 **Teilnehmer:** ${g.teilnehmer.length}`);
        updated.setDescription(desc);
        await i.message.edit({ embeds: [updated] });
      }
      return i.reply({ content: "✅ Teilnahme gespeichert!", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "reroll") {
      const msgid = i.options.getString("msgid");
      const g = load(FILES.giveaways).find(x => x.messageId === msgid);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (!g.teilnehmer.length) return i.reply({ content: "😢 Keine Teilnehmer!", ephemeral: true });
      const winners = Array.from({ length: g.gewinner }, () => `<@${g.teilnehmer[Math.floor(Math.random() * g.teilnehmer.length)]}>`);
      return i.reply(`🔁 Neue Gewinner für **${g.preis}**: ${winners.join(", ")}`);
    }

    if (i.isChatInputCommand() && i.commandName === "end") {
      await endGiveaway(i.options.getString("msgid"), i);
    }

    /* ---------- SHOP (Artikel verwalten) ---------- */
    if (i.isChatInputCommand() && i.commandName === "shop") {
      const sub = i.options.getSubcommand();
      const shop = load(FILES.shop);
      if (sub === "add") {
        const name = i.options.getString("name");
        const preis = i.options.getNumber("preis");
        if (shop.find(a => a.name.toLowerCase() === name.toLowerCase())) {
          return i.reply({ content: "⚠️ Artikel existiert bereits.", ephemeral: true });
        }
        shop.push({ name, preis: fmtAmount(preis) });
        save(FILES.shop, shop);
        const embed = new EmbedBuilder().setColor("#00AA88").setTitle("🛒 Artikel hinzugefügt")
          .setDescription(`**${name}** — **${fmtAmount(preis)}€**`).setFooter({ text: BRAND });
        return i.reply({ embeds: [embed] });
      }
      if (sub === "remove") {
        const name = i.options.getString("name");
        const idx = shop.findIndex(a => a.name.toLowerCase() === name.toLowerCase());
        if (idx === -1) return i.reply({ content: "❌ Artikel nicht gefunden.", ephemeral: true });
        shop.splice(idx, 1);
        save(FILES.shop, shop);
        return i.reply({ content: `🗑️ **${name}** wurde entfernt.` });
      }
      if (sub === "list") {
        if (!shop.length) return i.reply({ content: "📭 Keine Artikel im Sortiment." });
        const list = shop.map(a => `• ${a.name} — **${a.preis}€**`).join("\n");
        const embed = new EmbedBuilder().setColor("#00AA88").setTitle("🛍️ Sortiment").setDescription(list).setFooter({ text: BRAND });
        return i.reply({ embeds: [embed] });
      }
    }

    /* ---------- ORDER ---------- */
    if (i.isChatInputCommand() && i.commandName === "order") {
      const kunde = i.options.getUser("kunde");
      const shop = load(FILES.shop);
      if (!shop.length) return i.reply({ content: "📭 Es sind noch keine Shop-Artikel angelegt. Nutze `/shop add`.", ephemeral: true });

      const order = {
        messageId: null, channelId: i.channel.id, guildId: i.guild.id,
        kundeId: kunde.id, items: [], total: 0, active: true
      };

      const embed = new EmbedBuilder()
        .setColor("#f59e0b")
        .setTitle(`🧾 Bestellung von (${kunde.username})`)
        .setDescription("🛒 **Artikel:** *(noch keine)*\n💳 **Gesamt:** **0.00€**")
        .setImage(BANNER_URL).setFooter({ text: BRAND });

      const menu = new StringSelectMenuBuilder()
        .setCustomId("order_select_item")
        .setPlaceholder("Artikel hinzufügen …")
        .addOptions(shop.slice(0, 25).map(a => ({ label: `${a.name} — ${a.preis}€`, value: a.name })));

      const addBtn = new ButtonBuilder().setCustomId("order_add_item").setLabel("Artikel hinzufügen").setStyle(ButtonStyle.Success).setEmoji("➕");
      const removeBtn = new ButtonBuilder().setCustomId("order_remove_item").setLabel("Artikel entfernen").setStyle(ButtonStyle.Secondary).setEmoji("➖");
      const editBtn = new ButtonBuilder().setCustomId("order_edit").setLabel("Bestellung bearbeiten").setStyle(ButtonStyle.Primary).setEmoji("🛠️");
      const finishBtn = new ButtonBuilder().setCustomId("order_finish").setLabel("Bestellung abschließen").setStyle(ButtonStyle.Danger).setEmoji("✅");

      // PayPal Button (wird dynamisch ersetzt)
      const paypalBtn = new ButtonBuilder().setCustomId("order_paypal").setLabel("Jetzt 0.00€ zahlen").setStyle(ButtonStyle.Secondary);

      const row1 = new ActionRowBuilder().addComponents(menu);
      const row2 = new ActionRowBuilder().addComponents(addBtn, removeBtn, editBtn, finishBtn);
      const row3 = new ActionRowBuilder().addComponents(paypalBtn);

      const msg = await i.reply({ embeds: [embed], components: [row1, row2, row3], fetchReply: true });
      order.messageId = msg.id;

      const orders = load(FILES.orders);
      orders.push(order);
      save(FILES.orders, orders);
    }

    // Order select add from shop
    if (i.isStringSelectMenu() && i.customId === "order_select_item") {
      const orders = load(FILES.orders);
      const order = orders.find(o => o.messageId === i.message.id && o.active);
      if (!order) return i.reply({ content: "⛔ Bestellung ist nicht mehr aktiv.", ephemeral: true });

      const shop = load(FILES.shop);
      const picks = i.values;
      for (const v of picks) {
        const item = shop.find(a => a.name === v);
        if (item) order.items.push({ name: item.name, preis: Number(item.preis) });
      }
      order.total = order.items.reduce((s, it) => s + Number(it.preis), 0);
      save(FILES.orders, orders);

      await refreshOrderMessage(i, order);
      return i.reply({ content: "✅ Artikel hinzugefügt.", ephemeral: true });
    }

    // Order buttons
    if (i.isButton() && ["order_add_item", "order_remove_item", "order_edit", "order_finish", "order_paypal"].includes(i.customId)) {
      const orders = load(FILES.orders);
      const order = orders.find(o => o.messageId === i.message.id && o.active);
      if (!order) return i.reply({ content: "⛔ Bestellung ist nicht mehr aktiv.", ephemeral: true });

      const shop = load(FILES.shop);

      if (i.customId === "order_add_item") {
        // show select menu (ephemeral) with shop items
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`order_add_menu_${order.messageId}`)
          .setPlaceholder("Artikel wählen …")
          .addOptions(shop.slice(0, 25).map(a => ({ label: `${a.name} — ${a.preis}€`, value: a.name })));
        const row = new ActionRowBuilder().addComponents(menu);
        return i.reply({ content: "Wähle Artikel zum Hinzufügen:", components: [row], ephemeral: true });
      }

      if (i.customId === "order_remove_item") {
        if (!order.items.length) return i.reply({ content: "🗑️ Keine Artikel in der Bestellung.", ephemeral: true });
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`order_remove_menu_${order.messageId}`)
          .setPlaceholder("Artikel zum Entfernen wählen …")
          .addOptions(order.items.slice(0, 25).map((a, idx) => ({ label: `${a.name} — ${fmtAmount(a.preis)}€`, value: String(idx) })));
        const row = new ActionRowBuilder().addComponents(menu);
        return i.reply({ content: "Wähle Artikel zum Entfernen:", components: [row], ephemeral: true });
      }

      if (i.customId === "order_edit") {
        // only team
        if (!hasTeamRole(i.member)) return i.reply({ content: "⛔ Nur Team darf bearbeiten.", ephemeral: true });
        // DM to customer
        try {
          const user = await i.client.users.fetch(order.kundeId);
          const dmEmbed = new EmbedBuilder()
            .setColor("#f59e0b").setTitle("🛠️ Deine Bestellung wird bearbeitet ⏳")
            .setDescription("Bitte habe einen Moment Geduld — unser Team kümmert sich gerade um deine Bestellung. 🙏")
            .setImage(BANNER_URL).setFooter({ text: BRAND });
          await user.send({ embeds: [dmEmbed] }).catch(() => {});
        } catch {}
        // change title with "loading" look
        await updateOrderTitle(i.message, order, true);
        return i.reply({ content: "🔧 Bestellung in Bearbeitung markiert.", ephemeral: true });
      }

      if (i.customId === "order_finish") {
        // mark inactive & auto /finish
        order.active = false;
        save(FILES.orders, orders);
        await refreshOrderMessage(i, order);
        // trigger finish path (reuse function)
        await handleFinish(i, order.kundeId);
        return;
      }

      if (i.customId === "order_paypal") {
        const amount = fmtAmount(order.items.reduce((s, it) => s + Number(it.preis), 0));
        const link = `https://www.paypal.com/paypalme/${process.env.BRAND_PAYPAL_USERNAME}/${amount}`;
        return i.reply({ content: `💳 Bezahle sicher via PayPal: ${link}`, ephemeral: true });
      }
    }

    // ephemeral add/remove menus after button actions
    if (i.isStringSelectMenu() && i.customId.startsWith("order_add_menu_")) {
      const messageId = i.customId.split("order_add_menu_")[1];
      const orders = load(FILES.orders);
      const order = orders.find(o => o.messageId === messageId && o.active);
      if (!order) return i.reply({ content: "⛔ Bestellung nicht aktiv.", ephemeral: true });

      const shop = load(FILES.shop);
      for (const v of i.values) {
        const item = shop.find(a => a.name === v);
        if (item) order.items.push({ name: item.name, preis: Number(item.preis) });
      }
      order.total = order.items.reduce((s, it) => s + Number(it.preis), 0);
      save(FILES.orders, orders);

      await refreshOrderMessage({ message: await i.channel.messages.fetch(messageId) }, order, true);
      return i.update({ content: "✅ Hinzugefügt!", components: [] });
    }

    if (i.isStringSelectMenu() && i.customId.startsWith("order_remove_menu_")) {
      const messageId = i.customId.split("order_remove_menu_")[1];
      const orders = load(FILES.orders);
      const order = orders.find(o => o.messageId === messageId && o.active);
      if (!order) return i.reply({ content: "⛔ Bestellung nicht aktiv.", ephemeral: true });

      const idxs = i.values.map(v => Number(v)).sort((a,b)=>b-a);
      for (const idx of idxs) if (order.items[idx]) order.items.splice(idx, 1);
      order.total = order.items.reduce((s, it) => s + Number(it.preis), 0);
      save(FILES.orders, orders);

      await refreshOrderMessage({ message: await i.channel.messages.fetch(messageId) }, order, true);
      return i.update({ content: "🗑️ Entfernt!", components: [] });
    }

    /* ---------- FINISH ---------- */
    if (i.isChatInputCommand() && i.commandName === "finish") {
      if (!hasTeamRole(i.member)) return i.reply({ content: "⛔ Nur Team darf /finish nutzen.", ephemeral: true });
      const kunde = i.options.getUser("kunde");
      await handleFinish(i, kunde.id);
    }

    // Feedback: Button -> Modal -> UserSelect
    if (i.isButton() && i.customId.startsWith("feedback_start_")) {
      const targetUserId = i.customId.split("feedback_start_")[1];
      if (i.user.id !== targetUserId) {
        return i.reply({ content: "Nur der Kunde kann Feedback abgeben.", ephemeral: true });
      }
      const modal = new ModalBuilder().setCustomId(`feedback_modal_${i.message.id}`).setTitle("📝 Feedback abgeben");
      const stars = new TextInputBuilder().setCustomId("stars").setLabel("Sterne (1-5)").setStyle(TextInputStyle.Short).setRequired(true);
      const text = new TextInputBuilder().setCustomId("text").setLabel("Dein Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(stars), new ActionRowBuilder().addComponents(text));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith("feedback_modal_")) {
      const msgId = i.customId.split("feedback_modal_")[1];
      const stars = i.fields.getTextInputValue("stars");
      const text = i.fields.getTextInputValue("text");
      const key = `${i.user.id}:${msgId}`;
      feedbackTemp.set(key, { stars, text });
      // ask for seller via user select (ephemeral)
      const userSelect = new UserSelectMenuBuilder().setCustomId(`feedback_pick_${msgId}`).setPlaceholder("Wähle den Verkäufer");
      return i.reply({ content: "Bitte wähle den Verkäufer:", components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
    }

    if (i.isUserSelectMenu() && i.customId.startsWith("feedback_pick_")) {
      const msgId = i.customId.split("feedback_pick_")[1];
      const seller = i.values?.[0];
      const key = `${i.user.id}:${msgId}`;
      const data = feedbackTemp.get(key);
      if (!data) return i.reply({ content: "❌ Feedback abgelaufen.", ephemeral: true });
      feedbackTemp.delete(key);

      const starsNum = Math.max(1, Math.min(5, parseInt(data.stars) || 0));
      const starsEmoji = "⭐".repeat(starsNum) + "☆".repeat(5 - starsNum);
      const channelId = process.env.FEEDBACK_CHANNEL_ID;
      const ch = await i.guild.channels.fetch(channelId).catch(() => null);
      if (!ch) return i.reply({ content: "❌ Feedback-Channel nicht gefunden.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor("#ff3b3b")
        .setTitle("🧾 Neues Feedback • Vielen Dank! ❤️")
        .setDescription(
          `**Bewertung:** ${starsEmoji}\n\n` +
          `**Kommentar:** ${data.text}\n\n` +
          `**Verkäufer:** <@${seller}>\n` +
          `**Kunde:** <@${i.user.id}>`
        )
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND })
        .setTimestamp();

      await ch.send({ embeds: [embed] });
      return i.update({ content: "✅ Danke! Dein Feedback wurde gesendet.", components: [] });
    }

    /* ---------- EMBED (Modal) ---------- */
    if (i.isChatInputCommand() && i.commandName === "embed") {
      const modal = new ModalBuilder().setCustomId("embed_modal").setTitle("Embed erstellen");
      const color = new TextInputBuilder().setCustomId("color").setLabel("Farbe (hex, z.B. #ff0000)").setStyle(TextInputStyle.Short).setRequired(false);
      const title = new TextInputBuilder().setCustomId("title").setLabel("Titel").setStyle(TextInputStyle.Short).setRequired(true);
      const footer = new TextInputBuilder().setCustomId("footer").setLabel("Footer").setStyle(TextInputStyle.Short).setRequired(false);
      const thumb = new TextInputBuilder().setCustomId("thumb").setLabel("Thumbnail URL").setStyle(TextInputStyle.Short).setRequired(false);
      const image = new TextInputBuilder().setCustomId("image").setLabel("Embed Bild URL").setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(color),
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(footer),
        new ActionRowBuilder().addComponents(thumb),
        new ActionRowBuilder().addComponents(image)
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "embed_modal") {
      const color = i.fields.getTextInputValue("color") || "#5865F2";
      const title = i.fields.getTextInputValue("title");
      const footer = i.fields.getTextInputValue("footer");
      const thumb = i.fields.getTextInputValue("thumb");
      const image = i.fields.getTextInputValue("image");

      const embed = new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: footer || BRAND });
      if (thumb) embed.setThumbnail(thumb);
      if (image) embed.setImage(image);

      return i.reply({ embeds: [embed] });
    }

    /* ---------- STREAMER ADD ---------- */
    if (i.isChatInputCommand() && i.commandName === "streamer" && i.options.getSubcommand() === "add") {
      const name = i.options.getString("name").toLowerCase();
      const streamers = load(FILES.streamers);
      if (streamers.find(s => s.name === name)) {
        return i.reply({ content: "⚠️ Streamer ist bereits eingetragen.", ephemeral: true });
      }
      streamers.push({ name, channelId: i.channel.id, live: false });
      save(FILES.streamers, streamers);
      return i.reply({ content: `✅ **${name}** wird überwacht. Announce hier bei Live!` });
    }

  } catch (err) {
    console.error("❌ Interaktionsfehler:", err);
  }
});

/* ===========================
   Giveaway End
=========================== */
async function endGiveaway(msgid, interaction = null) {
  const giveaways = load(FILES.giveaways);
  const g = giveaways.find(x => x.messageId === msgid);
  if (!g || g.beendet) return;
  g.beendet = true;
  save(FILES.giveaways, giveaways);

  try {
    const guild = await client.guilds.fetch(g.guildId);
    const ch = await guild.channels.fetch(g.channelId);
    const msg = await ch.messages.fetch(g.messageId);

    if (!g.teilnehmer.length) {
      const embed = EmbedBuilder.from(msg.embeds[0])
        .setColor("#808080")
        .setDescription(`**Preis:** ${g.preis}\n❌ Keine Teilnehmer 😢`)
        .setFooter({ text: "Giveaway beendet" });
      await msg.edit({ embeds: [embed], components: [] });
      if (interaction) await interaction.reply({ content: "❌ Keine Teilnehmer. Giveaway beendet.", ephemeral: true });
      return;
    }

    const winners = Array.from({ length: g.gewinner }, () => `<@${g.teilnehmer[Math.floor(Math.random() * g.teilnehmer.length)]}>`);
    const embed = EmbedBuilder.from(msg.embeds[0])
      .setColor("#9B5DE5")
      .setDescription(`**Preis:** ${g.preis}\n🏆 Gewinner: ${winners.join(", ")}`)
      .setFooter({ text: "Giveaway beendet" });

    await msg.edit({ embeds: [embed], components: [] });
    await ch.send(`🎉 Glückwunsch ${winners.join(", ")}! Ihr habt **${g.preis}** gewonnen!`);
    if (interaction) await interaction.reply({ content: "✅ Giveaway beendet!", ephemeral: true });
  } catch (err) {
    console.error("❌ Fehler beim Beenden des Giveaways:", err);
  }
}

/* ===========================
   ORDER helpers
=========================== */
async function refreshOrderMessage(iOrCtx, order, silent = false) {
  const msg = iOrCtx.message || (await client.channels.fetch(order.channelId).then(c => c.messages.fetch(order.messageId)));
  const itemsText = order.items.length
    ? order.items.map(a => `• ${a.name} — **${fmtAmount(a.preis)}€**`).join("\n")
    : "*noch keine*";
  const total = fmtAmount(order.items.reduce((s, it) => s + Number(it.preis), 0));

  const old = msg.embeds?.[0];
  const title = old?.title || `🧾 Bestellung von (Kunde)`;
  const embed = new EmbedBuilder()
    .setColor("#f59e0b")
    .setTitle(title.replace(/🧾 Bestellung(.*?)$/i, `🧾 Bestellung von (${(await client.users.fetch(order.kundeId)).username})`))
    .setDescription(`🛒 **Artikel:**\n${itemsText}\n\n💳 **Gesamt:** **${total}€**`)
    .setImage(BANNER_URL)
    .setFooter({ text: BRAND });

  // Components: keep rows 1-2, update row3 paypal label
  const rows = msg.components ? [...msg.components] : [];
  // Update PayPal button in last row
  const lastRow = rows[2];
  if (lastRow) {
    const comps = lastRow.components.map(c => {
      if (c.customId === "order_paypal") {
        return new ButtonBuilder().setCustomId("order_paypal").setLabel(`Jetzt ${total}€ zahlen`).setStyle(ButtonStyle.Secondary);
      }
      return c;
    });
    rows[2] = new ActionRowBuilder().addComponents(...comps);
  }

  await msg.edit({ embeds: [embed], components: rows });
  if (!silent && iOrCtx.reply) await iOrCtx.reply({ content: "🔄 Bestellung aktualisiert.", ephemeral: true });
}

async function updateOrderTitle(message, order, loading) {
  const old = message.embeds?.[0];
  if (!old) return;
  const title = old.title || `🧾 Bestellung von (User)`;
  const newTitle = loading ? title + "  ⏳▮▯▯▯" : title.replace(/\s+⏳.*/, "");
  const newEmbed = EmbedBuilder.from(old).setTitle(newTitle);
  await message.edit({ embeds: [newEmbed] });
}

/* ===========================
   FINISH helpers
=========================== */
async function handleFinish(interaction, kundeId) {
  // Rolle vergeben
  try {
    const roleId = process.env.CUSTOMER_ROLE_ID;
    if (roleId) {
      const member = await interaction.guild.members.fetch(kundeId);
      await member.roles.add(roleId).catch(() => {});
    }
  } catch {}

  // Feedback Button
  const feedbackBtn = new ButtonBuilder()
    .setCustomId(`feedback_start_${kundeId}`)
    .setLabel("Feedback geben 📝")
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor("#ff3b3b")
    .setTitle("✅ Bestellung abgeschlossen")
    .setDescription("Vielen Dank für deinen Einkauf! 💖\nDu kannst uns jetzt Feedback geben.")
    .setImage(BANNER_URL)
    .setFooter({ text: BRAND });

  await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(feedbackBtn)] });
  return interaction.reply({ content: "✅ Abschluss durchgeführt & Feedback angeheftet.", ephemeral: true });
}

/* ===========================
   Logging
=========================== */
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
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑 Nachricht gelöscht").setDescription(`Von ${msg.author}\nIn ${msg.channel}\n\n${msg.content || "[Embed/Datei]"}`)] });
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

/* ===========================
   Twitch Announce (Auto)
=========================== */
let twitchToken = null;
let twitchTokenExp = 0;

async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchTokenExp) return twitchToken;
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return null;
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: "POST" });
  const js = await res.json();
  twitchToken = js.access_token;
  twitchTokenExp = Date.now() + (js.expires_in - 60) * 1000;
  return twitchToken;
}

async function fetchTwitchUser(login) {
  const token = await getTwitchToken();
  if (!token) return null;
  const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
    headers: { "Client-Id": process.env.TWITCH_CLIENT_ID, "Authorization": `Bearer ${token}` }
  });
  const js = await res.json();
  return js.data?.[0] || null;
}

async function fetchTwitchStream(userId) {
  const token = await getTwitchToken();
  if (!token) return null;
  const res = await fetch(`https://api.twitch.tv/helix/streams?user_id=${userId}`, {
    headers: { "Client-Id": process.env.TWITCH_CLIENT_ID, "Authorization": `Bearer ${token}` }
  });
  const js = await res.json();
  return js.data?.[0] || null;
}

async function startTwitchWatcher() {
  setInterval(async () => {
    try {
      const streamers = load(FILES.streamers);
      if (!streamers.length) return;
      for (const s of streamers) {
        const user = await fetchTwitchUser(s.name);
        if (!user) continue;
        const live = await fetchTwitchStream(user.id);
        const isLive = !!live;
        if (isLive && !s.live) {
          // announce now
          const ch = await client.channels.fetch(s.channelId).catch(() => null);
          if (ch) {
            const preview = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(s.name)}-640x360.jpg`;
            const url = `https://twitch.tv/${s.name}`;
            const embed = new EmbedBuilder()
              .setColor("#9146FF")
              .setTitle(`🔴 ${s.name} ist jetzt LIVE!`)
              .setURL(url)
              .setDescription(`Kommt vorbei! ✨\n**Titel:** ${live.title || "Live!"}\n**Spiel:** ${live.game_name || "—"}`)
              .setImage(preview)
              .setFooter({ text: "Kandar Streaming" });
            ch.send({ content: `@everyone`, embeds: [embed] });
          }
        }
        s.live = isLive;
      }
      save(FILES.streamers, streamers);
    } catch (e) {
      console.error("Twitch watcher error:", e);
    }
  }, 120000); // alle 2 Minuten
}

/* ===========================
   Login
=========================== */
client.login(process.env.DISCORD_TOKEN);
