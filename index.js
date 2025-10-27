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
  StringSelectMenuBuilder
} from "discord.js";
import fs from "fs";
import express from "express";
import "dotenv/config";

/* =====================================
   Grundkonfiguration & Datenstruktur
===================================== */
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

const BANNER_URL = "https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif";
const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const GIVEAWAY_FILE = `${DATA_DIR}/giveaways.json`;
const CREATORS_FILE = `${DATA_DIR}/creators.json`;
if (!fs.existsSync(GIVEAWAY_FILE)) fs.writeFileSync(GIVEAWAY_FILE, "[]");
if (!fs.existsSync(CREATORS_FILE)) fs.writeFileSync(CREATORS_FILE, "[]");

const orders = new Map(); // aktive Bestellungen

/* =====================================
   Slash Commands registrieren
===================================== */
const commands = [
  // Verify
  new SlashCommandBuilder()
    .setName("verifymsg")
    .setDescription("Sendet die Verify-Nachricht"),

  // Ticketpanel
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Sendet das Ticket-Panel (Dropdown)"),

  // Nuke
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Leert den aktuellen Kanal")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // Creator-System
  new SlashCommandBuilder()
    .setName("creator")
    .setDescription("Creator-System verwalten")
    .addSubcommand(sub => sub.setName("add").setDescription("Creator hinzufügen")),

  // Giveaways
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Starte ein neues Giveaway")
    .addStringOption(o => o.setName("preis").setDescription("Gewinn").setRequired(true))
    .addStringOption(o => o.setName("dauer").setDescription("z. B. 1d,2h,30m").setRequired(true))
    .addIntegerOption(o => o.setName("gewinner").setDescription("Anzahl Gewinner").setRequired(true)),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Ziehe neue Gewinner")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("Beende ein Giveaway")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),

  // Order-System
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Erstelle eine neue Bestellung")
    .addUserOption(o => o.setName("kunde").setDescription("Der Kunde").setRequired(true))
    .addStringOption(o => o.setName("artikel").setDescription("Artikelname").setRequired(true))
    .addNumberOption(o => o.setName("preis").setDescription("Preis in Euro").setRequired(true)),

  // Embed
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Erstelle ein Embed über ein Modal"),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash Commands registriert");
  } catch (err) {
    console.error("❌ Fehler beim Registrieren:", err);
  }
})();

/* =====================================
   Helper-Funktionen
===================================== */
const loadJSON = file => JSON.parse(fs.readFileSync(file, "utf8"));
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const parseDuration = str => {
  const r = /(\d+d)?(\d+h)?(\d+m)?/;
  const m = str.match(r);
  let ms = 0;
  if (m[1]) ms += parseInt(m[1]) * 86400000;
  if (m[2]) ms += parseInt(m[2]) * 3600000;
  if (m[3]) ms += parseInt(m[3]) * 60000;
  return ms;
};

/* =====================================
   Webserver für Railway
===================================== */
const app = express();
app.get("/", (_, res) => res.send("🌍 Kandar Bot läuft!"));
app.listen(3000, () => console.log("🌍 Webserver aktiv auf Port 3000"));

/* =====================================
   On Ready
===================================== */
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  // Server Stats erstellen/aktualisieren
  const catName = "📊 Server Stats";
  let cat = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
  if (!cat) cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

  const stats = {
    members: "🧍‍♂️ Mitglieder",
    online: "💻 Online",
    bots: "🤖 Bots",
    boosts: "💎 Boosts"
  };
  for (const n of Object.values(stats)) {
    if (!guild.channels.cache.find(c => c.parentId === cat.id && c.name.startsWith(n))) {
      await guild.channels.create({
        name: `${n}: 0`,
        type: ChannelType.GuildVoice,
        parent: cat.id,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] }],
      });
    }
  }

  const updateStats = async () => {
    const m = guild.members.cache;
    const online = m.filter(x => x.presence && x.presence.status !== "offline").size;
    const bots = m.filter(x => x.user.bot).size;
    const humans = m.size - bots;
    const boosts = guild.premiumSubscriptionCount || 0;
    const ch = {
      members: guild.channels.cache.find(c => c.name.startsWith(stats.members)),
      online: guild.channels.cache.find(c => c.name.startsWith(stats.online)),
      bots: guild.channels.cache.find(c => c.name.startsWith(stats.bots)),
      boosts: guild.channels.cache.find(c => c.name.startsWith(stats.boosts)),
    };
    if (ch.members) ch.members.setName(`${stats.members}: ${humans}`);
    if (ch.online) ch.online.setName(`${stats.online}: ${online}`);
    if (ch.bots) ch.bots.setName(`${stats.bots}: ${bots}`);
    if (ch.boosts) ch.boosts.setName(`${stats.boosts}: ${boosts}`);
  };
  updateStats();
  setInterval(updateStats, 5 * 60 * 1000);

  // Laufende Giveaways reaktivieren
  const giveaways = loadJSON(GIVEAWAY_FILE);
  for (const g of giveaways.filter(x => !x.beendet)) {
    const rest = g.endZeit - Date.now();
    if (rest <= 0) endGiveaway(g.messageId).catch(() => {});
    else setTimeout(() => endGiveaway(g.messageId).catch(() => {}), rest);
  }
});

/* =====================================
   Welcome & Booster Embeds
===================================== */
client.on("guildMemberAdd", async m => {
  const ch = m.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
  if (!ch) return;
  const e = new EmbedBuilder()
    .setColor("#00FF00")
    .setTitle("👋 Willkommen auf dem Server!")
    .setDescription(`Willkommen ${m}, schön dass du da bist! 🎉`)
    .setImage(BANNER_URL)
    .setThumbnail(m.user.displayAvatarURL({ dynamic: true }));
  ch.send({ embeds: [e] });
});

client.on("guildMemberUpdate", async (o, n) => {
  if (o.premiumSince === n.premiumSince) return;
  if (!n.premiumSince) return;
  const ch = n.guild.channels.cache.get(process.env.BOOSTER_CHANNEL_ID);
  if (!ch) return;
  const e = new EmbedBuilder()
    .setColor("#FF00FF")
    .setTitle("💎 Neuer Server-Boost!")
    .setDescription(`Vielen Dank ${n} fürs Boosten des Servers! 🚀💖`)
    .setImage(BANNER_URL);
  ch.send({ embeds: [e] });
});
/* =====================================
   Interaction Handler
===================================== */
client.on("interactionCreate", async i => {
  try {
    /* ===== VERIFY ===== */
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
      await i.member.roles.add(role).catch(() => {});
      return i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
    }

    /* ===== NUKE ===== */
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
        await ch.send("❌ Fehler beim Löschen (ältere Nachrichten bleiben erhalten).");
      }
    }

    /* ===== EMBED COMMAND ===== */
    if (i.isChatInputCommand() && i.commandName === "embed") {
      const modal = new ModalBuilder().setCustomId("createEmbedModal").setTitle("🖼 Embed erstellen");
      const color = new TextInputBuilder().setCustomId("color").setLabel("Farbe (Hex)").setStyle(TextInputStyle.Short).setRequired(false);
      const title = new TextInputBuilder().setCustomId("title").setLabel("Titel").setStyle(TextInputStyle.Short).setRequired(true);
      const footer = new TextInputBuilder().setCustomId("footer").setLabel("Footer").setStyle(TextInputStyle.Short).setRequired(false);
      const thumb = new TextInputBuilder().setCustomId("thumb").setLabel("Thumbnail-URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      const image = new TextInputBuilder().setCustomId("image").setLabel("Bild-URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(color),
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(footer),
        new ActionRowBuilder().addComponents(thumb),
        new ActionRowBuilder().addComponents(image)
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "createEmbedModal") {
      const color = i.fields.getTextInputValue("color") || "#2B2D31";
      const title = i.fields.getTextInputValue("title");
      const footer = i.fields.getTextInputValue("footer");
      const thumb = i.fields.getTextInputValue("thumb");
      const image = i.fields.getTextInputValue("image");
      const e = new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: footer || "" }).setTimestamp();
      if (thumb) e.setThumbnail(thumb);
      if (image) e.setImage(image);
      await i.reply({ embeds: [e] });
    }

    /* ===== ORDER SYSTEM ===== */
    if (i.isChatInputCommand() && i.commandName === "order") {
      const kunde = i.options.getUser("kunde");
      const artikel = i.options.getString("artikel");
      const preis = i.options.getNumber("preis");
      const orderId = `${i.id}`;
      orders.set(orderId, { kunde: kunde.id, artikel: [{ name: artikel, preis }], abgeschlossen: false });

      const embed = new EmbedBuilder()
        .setColor("#9B5DE5")
        .setTitle(`🛒 Bestellung von ${kunde.username}`)
        .setDescription(`**Artikel:** ${artikel}\n**Preis:** ${preis.toFixed(2)} €`)
        .setFooter({ text: "Kandar Shop" })
        .setImage(BANNER_URL);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`order_add_${orderId}`).setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`order_remove_${orderId}`).setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`order_edit_${orderId}`).setLabel("🛠️ Bearbeiten").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`order_finish_${orderId}`).setLabel("✅ Abschließen").setStyle(ButtonStyle.Danger)
      );

      await i.reply({ embeds: [embed], components: [row] });
    }

    // --- Add Item ---
    if (i.isButton() && i.customId.startsWith("order_add_")) {
      const id = i.customId.split("_")[2];
      const order = orders.get(id);
      if (!order || order.abgeschlossen) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });

      const modal = new ModalBuilder().setCustomId(`addItem_${id}`).setTitle("➕ Artikel hinzufügen");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("item").setLabel("Artikelname").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("price").setLabel("Preis (€)").setStyle(TextInputStyle.Short).setRequired(true))
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith("addItem_")) {
      const id = i.customId.split("_")[1];
      const order = orders.get(id);
      if (!order) return i.reply({ content: "❌ Bestellung nicht aktiv.", ephemeral: true });
      const name = i.fields.getTextInputValue("item");
      const preis = parseFloat(i.fields.getTextInputValue("price")) || 0;
      order.artikel.push({ name, preis });

      const summe = order.artikel.reduce((a, b) => a + b.preis, 0);
      const embed = new EmbedBuilder()
        .setColor("#9B5DE5")
        .setTitle(`🛒 Bestellung von <@${order.kunde}>`)
        .setDescription(order.artikel.map(x => `• ${x.name} – ${x.preis.toFixed(2)} €`).join("\n") + `\n\n💰 **Gesamt:** ${summe.toFixed(2)} €`)
        .setFooter({ text: "Kandar Shop" })
        .setImage(BANNER_URL);

      const link = new ButtonBuilder()
        .setLabel(`💸 Jetzt ${summe.toFixed(2)} € bezahlen`)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.paypal.com/paypalme/${process.env.PAYPAL_NAME}/${summe.toFixed(2)}`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`order_add_${id}`).setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`order_remove_${id}`).setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`order_edit_${id}`).setLabel("🛠️ Bearbeiten").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`order_finish_${id}`).setLabel("✅ Abschließen").setStyle(ButtonStyle.Danger),
        link
      );

      await i.update({ embeds: [embed], components: [row] });
    }

    // --- Remove Item ---
    if (i.isButton() && i.customId.startsWith("order_remove_")) {
      const id = i.customId.split("_")[2];
      const order = orders.get(id);
      if (!order || order.artikel.length === 0) return i.reply({ content: "❌ Keine Artikel zum Entfernen.", ephemeral: true });
      order.artikel.pop();
      const summe = order.artikel.reduce((a, b) => a + b.preis, 0);
      const embed = new EmbedBuilder()
        .setColor("#9B5DE5")
        .setTitle(`🛒 Bestellung von <@${order.kunde}>`)
        .setDescription(order.artikel.length ? order.artikel.map(x => `• ${x.name} – ${x.preis.toFixed(2)} €`).join("\n") + `\n\n💰 **Gesamt:** ${summe.toFixed(2)} €` : "Keine Artikel mehr enthalten.")
        .setFooter({ text: "Kandar Shop" })
        .setImage(BANNER_URL);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`order_add_${id}`).setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`order_remove_${id}`).setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`order_edit_${id}`).setLabel("🛠️ Bearbeiten").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`order_finish_${id}`).setLabel("✅ Abschließen").setStyle(ButtonStyle.Danger)
      );
      await i.update({ embeds: [embed], components: [row] });
    }

    // --- Edit (Team only) ---
    if (i.isButton() && i.customId.startsWith("order_edit_")) {
      const id = i.customId.split("_")[2];
      const order = orders.get(id);
      const member = i.member;
      const allowed = process.env.TEAM_ROLE_IDS.split(",").some(r => member.roles.cache.has(r));
      if (!allowed) return i.reply({ content: "🚫 Keine Berechtigung.", ephemeral: true });

      const user = await i.guild.members.fetch(order.kunde);
      const dm = new EmbedBuilder()
        .setColor("#FFCC00")
        .setTitle("🛠️ Bestellung in Bearbeitung ⌛")
        .setDescription("Deine Bestellung wird nun vom Team bearbeitet.\nBitte habe etwas Geduld 💚")
        .setImage(BANNER_URL);
      user.send({ embeds: [dm] }).catch(() => {});
      const msg = i.message;
      const edited = EmbedBuilder.from(msg.embeds[0])
        .setTitle("🛠️ Bestellung in Bearbeitung ⌛")
        .setColor("#FFCC00");
      await msg.edit({ embeds: [edited] });
      await i.reply({ content: "✅ Kunde wurde informiert.", ephemeral: true });
    }

    // --- Finish ---
    if (i.isButton() && i.customId.startsWith("order_finish_")) {
      const id = i.customId.split("_")[2];
      const order = orders.get(id);
      if (!order) return i.reply({ content: "❌ Bestellung existiert nicht.", ephemeral: true });
      order.abgeschlossen = true;
      const msg = i.message;
      const embed = EmbedBuilder.from(msg.embeds[0]).setColor("#00FF00").setTitle("✅ Bestellung abgeschlossen!");
      await msg.edit({ embeds: [embed], components: [] });

      const feedbackBtn = new ButtonBuilder().setCustomId(`feedback_${order.kunde}`).setLabel("⭐ Feedback geben").setStyle(ButtonStyle.Success);
      await msg.channel.send({ content: `<@${order.kunde}>`, components: [new ActionRowBuilder().addComponents(feedbackBtn)] });
      await i.reply({ content: "✅ Bestellung abgeschlossen & Feedback gestartet.", ephemeral: true });
    }

    /* ===== FEEDBACK ===== */
    if (i.isButton() && i.customId.startsWith("feedback_")) {
      const modal = new ModalBuilder().setCustomId("feedbackModal").setTitle("⭐ Feedback abgeben");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("sterne").setLabel("Bewertung (1-5 ⭐)").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("text").setLabel("Dein Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("verkaeufer").setLabel("Verkäufer (Name)").setStyle(TextInputStyle.Short).setRequired(true))
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "feedbackModal") {
      const sterne = i.fields.getTextInputValue("sterne");
      const text = i.fields.getTextInputValue("text");
      const seller = i.fields.getTextInputValue("verkaeufer");
      const ch = i.guild.channels.cache.get(process.env.FEEDBACK_CHANNEL_ID);
      if (!ch) return i.reply({ content: "❌ Feedback-Channel nicht gefunden.", ephemeral: true });

      const e = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("⭐ Neues Feedback")
        .setDescription(`**Bewertung:** ${"⭐".repeat(Number(sterne))}\n**Verkäufer:** ${seller}\n\n💬 ${text}`)
        .setFooter({ text: "Kandar Shop Feedback" })
        .setImage(BANNER_URL);
      await ch.send({ embeds: [e] });
      await i.reply({ content: "✅ Feedback gesendet!", ephemeral: true });
    }

  } catch (err) {
    console.error("❌ Interaktionsfehler:", err);
  }
});

/* =====================================
   Logging-Events
===================================== */
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
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("📢 Channel erstellt").setDescription(ch.name)] });
});
client.on("channelDelete", ch => {
  const log = ch.guild.channels.cache.get(process.env.CHANNEL_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑 Channel gelöscht").setDescription(ch.name)] });
});
client.on("roleCreate", r => {
  const log = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("🎭 Rolle erstellt").setDescription(r.name)] });
});
client.on("roleDelete", r => {
  const log = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🎭 Rolle gelöscht").setDescription(r.name)] });
});
client.on("voiceStateUpdate", (o, n) => {
  const log = n.guild.channels.cache.get(process.env.VOICE_LOGS_CHANNEL_ID);
  if (!log) return;
  let desc = "";
  const u = n.member.user;
  if (!o.channel && n.channel) desc = `🎙️ ${u} ist **${n.channel.name}** beigetreten.`;
  else if (o.channel && !n.channel) desc = `🔇 ${u} hat **${o.channel.name}** verlassen.`;
  else if (o.channelId !== n.channelId) desc = `🔁 ${u} wechselte von **${o.channel.name}** zu **${n.channel.name}**.`;
  if (desc) log.send({ embeds: [new EmbedBuilder().setColor("#00A8FF").setTitle("🔊 Voice Log").setDescription(desc)] });
});

/* =====================================
   Login
===================================== */
client.login(process.env.DISCORD_TOKEN);
