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
} from "discord.js";
import fs from "fs";
import express from "express";
import "dotenv/config";

/* =====================================
   Basis / Setup
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

const TEAM_ROLE_IDS = (process.env.TEAM_ROLE_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const orders = new Map(); // orderId => { kunde, artikel: [{name, preis}], abgeschlossen, messageId, channelId }

/* =====================================
   Slash Commands
===================================== */
const commands = [
  // Verify Panel
  new SlashCommandBuilder().setName("verifymsg").setDescription("Sendet die Verify-Nachricht"),

  // Ticket Panel
  new SlashCommandBuilder().setName("panel").setDescription("Sendet das Ticket-Panel (Dropdown)"),

  // Nuke
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Löscht viele Nachrichten im aktuellen Channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // Creator
  new SlashCommandBuilder()
    .setName("creator")
    .setDescription("Creator-System")
    .addSubcommand(sub => sub.setName("add").setDescription("Erstellt ein Creator-Panel mit Social-Links")),

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

  // PayPal
  new SlashCommandBuilder()
    .setName("paypal")
    .setDescription("Erstellt einen PayPal-Link")
    .addNumberOption(o => o.setName("betrag").setDescription("Betrag in Euro (z. B. 12.99)").setRequired(true)),

  // Order
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Erstelle eine neue Bestellung (ohne Ticket)")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde auswählen").setRequired(true))
    .addStringOption(o => o.setName("artikel").setDescription("Erster Artikel").setRequired(true))
    .addNumberOption(o => o.setName("preis").setDescription("Preis in €").setRequired(true)),

  // Finish (nur Team)
  new SlashCommandBuilder()
    .setName("finish")
    .setDescription("Ticket/Bestellung abschließen & Feedback anfragen (nur Team)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  // Twitch announce
  new SlashCommandBuilder().setName("stream").setDescription("Twitch-Stream ankündigen (aus ENV TWITCH_STREAMER)"),

  // Embed Builder
  new SlashCommandBuilder().setName("embed").setDescription("Öffnet ein Embed-Modal zum Posten"),
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

/* =====================================
   Express Keep-Alive (Railway)
===================================== */
const app = express();
app.get("/", (_, res) => res.send("Kandar Bot läuft ✅"));
app.listen(3000, () => console.log("🌐 Webserver gestartet (Port 3000)"));

/* =====================================
   Utils
===================================== */
const loadGiveaways = () => JSON.parse(fs.readFileSync(GIVEAWAY_FILE, "utf8"));
const saveGiveaways = (arr) => fs.writeFileSync(GIVEAWAY_FILE, JSON.stringify(arr, null, 2));

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
const isTeam = (member) => TEAM_ROLE_IDS.some(id => member.roles.cache.has(id));

/* =====================================
   READY: Server Stats + Re-Arm Giveaways
===================================== */
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    // Server-Stats Kategorie
    const categoryName = "📊 Server Stats";
    let category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
    if (!category) category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });

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

  // Offene Giveaways reaktivieren
  const giveaways = loadGiveaways();
  for (const g of giveaways.filter(x => !x.beendet)) {
    const rest = g.endZeit - Date.now();
    if (rest <= 0) endGiveaway(g.messageId).catch(() => {});
    else setTimeout(() => endGiveaway(g.messageId).catch(() => {}), rest);
  }
  console.log(`🎉 Reaktivierte Giveaways: ${giveaways.filter(x => !x.beendet).length}`);
});

/* =====================================
   Welcome + Booster
===================================== */
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

/* =====================================
   Interaction Handler (alles zentral)
===================================== */
client.on("interactionCreate", async (i) => {
  try {
    /* ---- VERIFY ---- */
    if (i.isChatInputCommand() && i.commandName === "verifymsg") {
      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("✅ Verifizierung")
        .setDescription("Drücke unten auf **Verifizieren**, um Zugriff auf den Server zu erhalten!")
        .setImage(BANNER_URL);

      const button = new ButtonBuilder().setCustomId("verify_button").setLabel("Verifizieren").setStyle(ButtonStyle.Success);
      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    if (i.isButton() && i.customId === "verify_button") {
      const role = i.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
      if (!role) return i.reply({ content: "❌ Verify-Rolle nicht gefunden!", ephemeral: true });
      try {
        await i.member.roles.add(role);
        return i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
      } catch (err) {
        return i.reply({ content: "❌ Konnte die Verify-Rolle nicht vergeben. Bitte prüfe Bot-Rechte & Rollen-Hierarchie.", ephemeral: true });
      }
    }

    /* ---- PAYPAL ---- */
    if (i.isChatInputCommand() && i.commandName === "paypal") {
      const betrag = i.options.getNumber("betrag");
      const rounded = Number(betrag).toFixed(2);
      const embed = new EmbedBuilder()
        .setColor("#003087")
        .setTitle("💸 PayPal Zahlung")
        .setDescription(`Klicke unten, um **${rounded}€** zu bezahlen.`)
        .setFooter({ text: "Kandar Payments" })
        .setImage(BANNER_URL);
      const button = new ButtonBuilder()
        .setLabel(`Jetzt ${rounded}€ bezahlen`)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.paypal.me/jonahborospreitzer/${rounded}`);
      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    /* ---- TICKET PANEL ---- */
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
          `👥 **Support Anliegen** – Support`
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

    if (i.isStringSelectMenu() && i.customId === "ticket_select") {
      const choice = i.values[0];

      const openWithCloseControls = async (guild, title, catName, desc, user, extraFields = null) => {
        let cat = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
        if (!cat) cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

        const ch = await guild.channels.create({
          name: `${title.split(" ")[0]}-${user.username}`,
          type: ChannelType.GuildText,
          parent: cat.id,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
            { id: user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
          ],
        });

        const embed = new EmbedBuilder().setColor("#00FF00").setTitle(title).setDescription(desc).setImage(BANNER_URL);
        if (extraFields) embed.addFields(...extraFields);

        const closeBtn = new ButtonBuilder().setCustomId("ticket_close_btn").setLabel("🔒 Schließen").setStyle(ButtonStyle.Danger);
        await ch.send({ content: `${user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });

        const log = guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID);
        if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FFD700").setTitle(`🧾 Ticket erstellt`).setDescription(`${title} von ${user}`).setTimestamp()] });

        return ch;
      };

      if (choice === "shop") {
        const modal = new ModalBuilder().setCustomId("shopTicketModal").setTitle("💰 Shop Ticket erstellen");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("payment").setLabel("Zahlungsmethode").setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("item").setLabel("Artikel / Produktname").setStyle(TextInputStyle.Short).setRequired(true))
        );
        return i.showModal(modal);
      }

      if (choice === "streamer") {
        const modal = new ModalBuilder().setCustomId("streamerTicketModal").setTitle("🎥 Streamer Bewerbung");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("follower").setLabel("Follower").setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("avg_viewer").setLabel("Average Viewer").setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("twitch_link").setLabel("Twitch-Link").setStyle(TextInputStyle.Short).setRequired(true))
        );
        return i.showModal(modal);
      }

      const map = {
        kandar: { title: "✍️ Kandar Bewerbung", cat: "✍️ Kandar Bewerbungen", desc: "Bitte schreibe deine Bewerbung hier." },
        designer: { title: "🎨 Designer Bewerbung", cat: "🎨 Designer Bewerbungen", desc: "Bitte sende dein Portfolio." },
        cutter: { title: "✂️ Cutter Bewerbung", cat: "✂️ Cutter Bewerbungen", desc: "Bitte nenne deine Software & Erfahrung." },
        highteam: { title: "🛠️ Highteam Ticket", cat: "🛠️ Highteam Anliegen", desc: "Beschreibe bitte dein Anliegen." },
        support: { title: "👥 Support Ticket", cat: "👥 Support Anliegen", desc: "Beschreibe bitte dein Anliegen." },
      };
      const data = map[choice];
      if (!data) return;

      const ch = await openWithCloseControls(i.guild, data.title, data.cat, data.desc, i.user);
      return i.reply({ content: `✅ Ticket erstellt: ${ch}`, ephemeral: true });
    }

    // Shop/Streamer Ticket Modals
    if (i.isModalSubmit() && i.customId === "shopTicketModal") {
      const payment = i.fields.getTextInputValue("payment");
      const item = i.fields.getTextInputValue("item");
      const desc = `🧾 **Zahlungsmethode:** ${payment}\n📦 **Artikel:** ${item}`;
      const ch = await i.guild.channels.create({
        name: `shop-${i.user.username}`,
        type: ChannelType.GuildText,
        parent: (i.guild.channels.cache.find(c => c.name === "💰 Shop Tickets" && c.type === ChannelType.GuildCategory)?.id) || null,
        permissionOverwrites: [
          { id: i.guild.roles.everyone.id, deny: ["ViewChannel"] },
          { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        ],
      });
      const embed = new EmbedBuilder().setColor("#00FF00").setTitle("💰 Shop Ticket").setDescription(desc).setImage(BANNER_URL);
      const closeBtn = new ButtonBuilder().setCustomId("ticket_close_btn").setLabel("🔒 Schließen").setStyle(ButtonStyle.Danger);
      await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
      return i.reply({ content: `✅ Shop Ticket erstellt: ${ch}`, ephemeral: true });
    }

    if (i.isModalSubmit() && i.customId === "streamerTicketModal") {
      const follower = i.fields.getTextInputValue("follower");
      const avgViewer = i.fields.getTextInputValue("avg_viewer");
      const twitch = i.fields.getTextInputValue("twitch_link");
      const desc = `👤 **Follower:** ${follower}\n📈 **Average Viewer:** ${avgViewer}\n🔗 **Twitch:** ${twitch}`;
      const ch = await i.guild.channels.create({
        name: `streamer-${i.user.username}`,
        type: ChannelType.GuildText,
        parent: (i.guild.channels.cache.find(c => c.name === "🎥 Streamer Bewerbungen" && c.type === ChannelType.GuildCategory)?.id) || null,
        permissionOverwrites: [
          { id: i.guild.roles.everyone.id, deny: ["ViewChannel"] },
          { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        ],
      });
      const embed = new EmbedBuilder().setColor("#5865F2").setTitle("🎥 Streamer Bewerbung").setDescription(desc).setImage(BANNER_URL);
      const closeBtn = new ButtonBuilder().setCustomId("ticket_close_btn").setLabel("🔒 Schließen").setStyle(ButtonStyle.Danger);
      await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
      return i.reply({ content: `✅ Streamer Bewerbung erstellt: ${ch}`, ephemeral: true });
    }

    // Ticket Close Button -> Grund Modal
    if (i.isButton() && i.customId === "ticket_close_btn") {
      if (!isTeam(i.member)) return i.reply({ content: "❌ Nur Team darf Tickets schließen.", ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`ticket_close_reason_${i.channelId}`).setTitle("Ticket schließen: Grund");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("Grund").setStyle(TextInputStyle.Paragraph).setRequired(true)
      ));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith("ticket_close_reason_")) {
      const reason = i.fields.getTextInputValue("reason");
      const ch = i.channel;
      // Lock & Info
      await ch.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false }).catch(() => {});
      const embed = new EmbedBuilder().setColor("#ff5555").setTitle("🔒 Ticket geschlossen")
        .setDescription(`Grund: ${reason}`).setImage(BANNER_URL).setTimestamp();
      await ch.send({ embeds: [embed] });

      const log = i.guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID);
      if (log) log.send({ embeds: [new EmbedBuilder().setColor("#ff5555").setTitle("🧾 Ticket geschlossen").setDescription(`Channel: ${ch}\nVon: ${i.user}\nGrund: ${reason}`).setTimestamp()] });

      return i.reply({ content: "✅ Ticket geschlossen.", ephemeral: true });
    }

    /* ---- $rename (nur Team) ---- */
    // handled in messageCreate

    /* ---- NUKE ---- */
    if (i.isChatInputCommand() && i.commandName === "nuke") {
      await i.reply({ content: "⚠️ Channel wird geleert...", ephemeral: true });
      const ch = i.channel;
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

    /* ---- CREATOR ADD ---- */
    if (i.isChatInputCommand() && i.commandName === "creator" && i.options.getSubcommand() === "add") {
      const modal = new ModalBuilder().setCustomId("creatorAddModal").setTitle("Creator hinzufügen");
      const fields = [
        { id: "title", label: "Titel des Embeds", req: true },
        { id: "creatorId", label: "Discord-ID des Creators", req: true },
        { id: "twitch", label: "Twitch Link", req: true },
        { id: "youtube", label: "YouTube Link (Optional)", req: false },
        { id: "tiktok", label: "TikTok Link (Optional)", req: false },
        { id: "instagram", label: "Instagram Link (Optional)", req: false },
        { id: "code", label: "Creator Code (Optional)", req: false },
      ];
      modal.addComponents(...fields.map(f =>
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(TextInputStyle.Short).setRequired(!!f.req))
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

      const member = guild.members.cache.get(creatorId);
      if (member) {
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === "creator");
        if (role) await member.roles.add(role).catch(() => null);
      }

      const embed = new EmbedBuilder().setColor("#9b5de5").setTitle(title).addFields({ name: "Twitch", value: twitch });
      if (youtube) embed.addFields({ name: "YouTube", value: youtube });
      if (tiktok) embed.addFields({ name: "TikTok", value: tiktok });
      if (instagram) embed.addFields({ name: "Instagram", value: instagram });
      if (code) embed.addFields({ name: "Creator Code", value: code });

      const msg = await i.reply({ embeds: [embed], fetchReply: true });
      const arr = JSON.parse(fs.readFileSync(CREATORS_FILE, "utf8"));
      arr.push({ title, creatorId, twitch, youtube, tiktok, instagram, code, messageId: msg.id, channelId: msg.channel.id });
      fs.writeFileSync(CREATORS_FILE, JSON.stringify(arr, null, 2));
      return i.followUp({ content: "✅ Creator erstellt!", ephemeral: true });
    }

    /* ---- GIVEAWAYS ---- */
    if (i.isChatInputCommand() && i.commandName === "giveaway") {
      const preis = i.options.getString("preis");
      const dauerStr = i.options.getString("dauer");
      const gewinner = i.options.getInteger("gewinner");
      if (!gewinner || gewinner < 1) return i.reply({ content: "⚠️ Gewinneranzahl muss ≥ 1 sein.", ephemeral: true });

      const dauer = parseDuration(dauerStr);
      if (!dauer || dauer <= 0) return i.reply({ content: "⚠️ Ungültige Dauer (z.B. 1d2h30m).", ephemeral: true });

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

      const giveaways = loadGiveaways();
      giveaways.push({ messageId: msg.id, channelId: msg.channel.id, guildId: msg.guild.id, preis, endZeit, gewinner, teilnehmer: [], beendet: false });
      saveGiveaways(giveaways);
      setTimeout(() => endGiveaway(msg.id).catch(() => {}), dauer);
    }

    if (i.isButton() && i.customId === "giveaway_join") {
      const giveaways = loadGiveaways();
      const g = giveaways.find(x => x.messageId === i.message.id);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (g.beendet) return i.reply({ content: "🚫 Dieses Giveaway ist beendet!", ephemeral: true });
      if (g.teilnehmer.includes(i.user.id)) return i.reply({ content: "⚠️ Du bist bereits dabei!", ephemeral: true });
      g.teilnehmer.push(i.user.id);
      saveGiveaways(giveaways);

      // Embed Teilnehmerzahl updaten
      const newEmbed = EmbedBuilder.from(i.message.embeds[0]);
      const desc = newEmbed.data.description || "";
      const updated = desc.replace(/👥 \*\*Teilnehmer:\*\* \d+/, `👥 **Teilnehmer:** ${g.teilnehmer.length}`);
      newEmbed.setDescription(updated);
      await i.message.edit({ embeds: [newEmbed] });

      return i.reply({ content: "✅ Teilnahme gespeichert!", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "reroll") {
      const msgid = i.options.getString("msgid");
      const g = loadGiveaways().find(x => x.messageId === msgid);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (!g.teilnehmer.length) return i.reply({ content: "😢 Keine Teilnehmer!", ephemeral: true });
      const winners = Array.from({ length: g.gewinner }, () => `<@${g.teilnehmer[Math.floor(Math.random() * g.teilnehmer.length)]}>`);
      return i.reply(`🔁 Neue Gewinner für **${g.preis}**: ${winners.join(", ")}`);
    }

    if (i.isChatInputCommand() && i.commandName === "end") {
      await endGiveaway(i.options.getString("msgid"), i);
    }

    /* ---- ORDER ---- */
    if (i.isChatInputCommand() && i.commandName === "order") {
      const kunde = i.options.getUser("kunde");
      const artikel = i.options.getString("artikel");
      const preis = i.options.getNumber("preis");
      const orderId = i.id;

      orders.set(orderId, { kunde: kunde.id, artikel: [{ name: artikel, preis }], abgeschlossen: false });

      const summe = preis.toFixed(2);
      const embed = new EmbedBuilder()
        .setColor("#9B5DE5")
        .setTitle(`🛒 Bestellung von ${kunde.username}`)
        .setDescription(`**Kunde:** ${kunde}\n\n📦 **Artikel:**\n• ${artikel} — ${summe} €\n\n💰 **Gesamt:** ${summe} €`)
        .setFooter({ text: "Kandar Shop" })
        .setImage(BANNER_URL);

      const paypalBtn = new ButtonBuilder()
        .setLabel(`💸 Jetzt ${summe}€ bezahlen`)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.paypal.me/jonahborospreitzer/${summe}`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`order_add_${orderId}`).setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`order_remove_${orderId}`).setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`order_edit_${orderId}`).setLabel("🛠️ Bearbeiten (Team)").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`order_finish_${orderId}`).setLabel("✅ Abschließen").setStyle(ButtonStyle.Danger),
        paypalBtn
      );

      const msg = await i.reply({ embeds: [embed], components: [row], fetchReply: true });
      orders.get(orderId).messageId = msg.id;
      orders.get(orderId).channelId = msg.channel.id;
    }

    // ORDER: add
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
      if (!order || order.abgeschlossen) return i.reply({ content: "❌ Bestellung nicht aktiv.", ephemeral: true });

      const name = i.fields.getTextInputValue("item");
      const preis = parseFloat(i.fields.getTextInputValue("price")) || 0;
      order.artikel.push({ name, preis });

      await updateOrderMessage(i, id, "➕ Artikel hinzugefügt!");
    }

    // ORDER: remove (entfernt den letzten Artikel)
    if (i.isButton() && i.customId.startsWith("order_remove_")) {
      const id = i.customId.split("_")[2];
      const order = orders.get(id);
      if (!order || order.abgeschlossen) return i.reply({ content: "❌ Bestellung nicht aktiv.", ephemeral: true });
      if (!order.artikel.length) return i.reply({ content: "❌ Keine Artikel zum Entfernen.", ephemeral: true });

      order.artikel.pop();
      await updateOrderMessage(i, id, "➖ Letzten Artikel entfernt.");
    }

    // ORDER: edit (Team-only)
    if (i.isButton() && i.customId.startsWith("order_edit_")) {
      if (!isTeam(i.member)) return i.reply({ content: "❌ Nur Team darf Bestellungen bearbeiten.", ephemeral: true });
      const id = i.customId.split("_")[2];
      const order = orders.get(id);
      if (!order) return i.reply({ content: "❌ Bestellung nicht gefunden.", ephemeral: true });

      // Titel ändern + Kunde DM
      const ch = i.channel;
      const msg = await ch.messages.fetch(order.messageId);
      const kundeUser = await i.client.users.fetch(order.kunde).catch(() => null);
      const summe = order.artikel.reduce((a, b) => a + b.preis, 0).toFixed(2);

      const edited = EmbedBuilder.from(msg.embeds[0])
        .setTitle(`🛠️ Bestellung in Bearbeitung ${"<a:loading:123456789012345678>"}`) // animierter Ladebalken-Emoji-ID ersetzen, falls vorhanden
        .setDescription(listOrderDesc(order, kundeUser, summe))
        .setImage(BANNER_URL);

      const row = buildOrderRow(id, summe);
      await msg.edit({ embeds: [edited], components: [row] });

      if (kundeUser) {
        const dmEmbed = new EmbedBuilder()
          .setColor("#9B5DE5")
          .setTitle("🛠️ Deine Bestellung wird bearbeitet")
          .setDescription(`Hey ${kundeUser},\n\n🕐 Deine Bestellung wird gerade vom Team bearbeitet.\nBitte hab einen Moment Geduld – wir melden uns gleich!\n\n✨ Danke für dein Vertrauen in **Kandar Shop**!`)
          .setImage(BANNER_URL)
          .setFooter({ text: "Kandar Shop" });
        await kundeUser.send({ embeds: [dmEmbed] }).catch(() => {});
      }

      return i.reply({ content: "✅ Markiert als 'in Bearbeitung' & Kunde benachrichtigt.", ephemeral: true });
    }

    // ORDER: finish => löst Finish-Flow aus
    if (i.isButton() && i.customId.startsWith("order_finish_")) {
      const id = i.customId.split("_")[2];
      const order = orders.get(id);
      if (!order || order.abgeschlossen) return i.reply({ content: "❌ Bestellung nicht aktiv.", ephemeral: true });

      order.abgeschlossen = true;
      await handleFinish(i, i.channel, order.kunde);
      return; // handleFinish antwortet selbst
    }

    /* ---- /finish (Team-only) ---- */
    if (i.isChatInputCommand() && i.commandName === "finish") {
      if (!isTeam(i.member)) return i.reply({ content: "❌ Nur Team darf /finish nutzen.", ephemeral: true });
      const channel = i.channel;
      // Versuche Ticket-Ersteller zu bestimmen (erstes Mention/Author)
      let targetUserId = null;
      const pinned = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      if (pinned) {
        const first = pinned.sort((a,b) => a.createdTimestamp - b.createdTimestamp).first();
        if (first) {
          if (first.mentions.users.size) targetUserId = first.mentions.users.first().id;
          else if (first.author) targetUserId = first.author.id;
        }
      }
      if (!targetUserId) targetUserId = i.user.id;

      await handleFinish(i, channel, targetUserId);
    }

    /* ---- Twitch Stream Announce ---- */
    if (i.isChatInputCommand() && i.commandName === "stream") {
      const streamer = process.env.TWITCH_STREAMER || "Streamer";
      const embed = new EmbedBuilder()
        .setColor("#9146FF")
        .setTitle(`🔴 ${streamer} ist jetzt LIVE!`)
        .setDescription(`Schau rein und unterstütze den Stream! 💜\nhttps://twitch.tv/${streamer}`)
        .setImage(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${streamer.toLowerCase()}-1280x720.jpg`)
        .setFooter({ text: "Kandar Streaming" })
        .setTimestamp();
      return i.reply({ embeds: [embed] });
    }

    /* ---- Embed Builder ---- */
    if (i.isChatInputCommand() && i.commandName === "embed") {
      const modal = new ModalBuilder().setCustomId("customEmbedModal").setTitle("Embed erstellen");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Farbe (HEX, z.B. #FF0000)").setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Titel").setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("footer").setLabel("Footer").setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("thumbnail").setLabel("Thumbnail URL").setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("image").setLabel("Bild URL").setStyle(TextInputStyle.Short).setRequired(false))
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "customEmbedModal") {
      const color = i.fields.getTextInputValue("color") || "#9B5DE5";
      const title = i.fields.getTextInputValue("title") || " ";
      const footer = i.fields.getTextInputValue("footer") || "";
      const thumbnail = i.fields.getTextInputValue("thumbnail") || "";
      const image = i.fields.getTextInputValue("image") || "";
      const embed = new EmbedBuilder().setColor(color).setTimestamp();
      if (title.trim()) embed.setTitle(title);
      if (footer.trim()) embed.setFooter({ text: footer });
      if (thumbnail.trim()) embed.setThumbnail(thumbnail);
      if (image.trim()) embed.setImage(image);
      return i.reply({ embeds: [embed] });
    }

    /* ---- Feedback Flow (UserSelect nach Modal) ---- */
    if (i.isModalSubmit() && i.customId === "feedbackModal") {
      const stars = i.fields.getTextInputValue("stars");
      const text = i.fields.getTextInputValue("text");
      // Verkäufer Auswahl (User Select)
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`feedback_pick_seller::${Buffer.from(JSON.stringify({ stars, text })).toString("base64")}`)
          .setPlaceholder("Verkäufer auswählen")
          .setMinValues(1)
          .setMaxValues(1)
      );
      return i.reply({ content: "Bitte Verkäufer auswählen:", components: [row], ephemeral: true });
    }

    if (i.isUserSelectMenu() && i.customId.startsWith("feedback_pick_seller::")) {
      const payloadB64 = i.customId.split("::")[1];
      const { stars, text } = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
      const sellerId = i.values[0];

      const ch = i.guild.channels.cache.get(process.env.FEEDBACK_CHANNEL_ID);
      const color = 0xff0000;
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("📝 Neues Feedback eingegangen!")
        .setDescription(`⭐ **Bewertung:** ${"⭐".repeat(Math.max(1, Math.min(5, parseInt(stars) || 0)))}\n\n💬 **Feedback:** ${text}\n\n🛍️ **Verkäufer:** <@${sellerId}>\n👤 **Kunde:** ${i.user}`)
        .setImage(BANNER_URL)
        .setFooter({ text: "Kandar Shop – Danke für dein Feedback!" })
        .setTimestamp();

      if (ch) await ch.send({ embeds: [embed] });
      await i.update({ content: "✅ Danke! Dein Feedback wurde gespeichert.", components: [] });
    }

  } catch (err) {
    console.error("❌ Interaktionsfehler:", err);
  }
});

/* =====================================
   Hilfsfunktionen
===================================== */
function listOrderDesc(order, kundeUser, summe) {
  const lines = order.artikel.map(x => `• ${x.name} — ${x.preis.toFixed(2)} €`).join("\n") || "—";
  return `**Kunde:** ${kundeUser ? kundeUser : `<@${order.kunde}>`}\n\n📦 **Artikel:**\n${lines}\n\n💰 **Gesamt:** ${summe} €`;
}
function buildOrderRow(id, summe) {
  const paypalBtn = new ButtonBuilder()
    .setLabel(`💸 Jetzt ${summe}€ bezahlen`)
    .setStyle(ButtonStyle.Link)
    .setURL(`https://www.paypal.me/jonahborospreitzer/${summe}`);

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order_add_${id}`).setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`order_remove_${id}`).setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`order_edit_${id}`).setLabel("🛠️ Bearbeiten (Team)").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`order_finish_${id}`).setLabel("✅ Abschließen").setStyle(ButtonStyle.Danger),
    paypalBtn
  );
}
async function updateOrderMessage(i, id, ackText) {
  const order = orders.get(id);
  const ch = i.channel;
  const msg = await ch.messages.fetch(order.messageId);
  const kundeUser = await i.client.users.fetch(order.kunde).catch(() => null);
  const summe = order.artikel.reduce((a, b) => a + b.preis, 0).toFixed(2);

  const updated = EmbedBuilder.from(msg.embeds[0])
    .setTitle(`🛒 Bestellung von ${kundeUser ? kundeUser.username : `User`}`)
    .setDescription(listOrderDesc(order, kundeUser, summe))
    .setFooter({ text: "Kandar Shop" })
    .setImage(BANNER_URL);

  const row = buildOrderRow(id, summe);
  await msg.edit({ embeds: [updated], components: [row] });
  if (i.isButton()) return i.reply({ content: `✅ ${ackText}`, ephemeral: true });
  if (i.isModalSubmit()) return i.reply({ content: `✅ ${ackText}`, ephemeral: true });
}

/** Finish-Flow: Rolle vergeben, Feedback-Button posten */
async function handleFinish(interaction, channel, userId) {
  // Customer Rolle
  const roleId = process.env.CUSTOMER_ROLE_ID;
  if (roleId) {
    const member = await channel.guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.roles.add(roleId).catch(() => {});
    }
  }

  // Feedback Button
  const fbBtn = new ButtonBuilder().setCustomId("feedback_open").setLabel("📝 Feedback geben").setStyle(ButtonStyle.Secondary);
  await channel.send({
    embeds: [new EmbedBuilder().setColor("#9B5DE5").setTitle("✅ Abgeschlossen").setDescription("Dein Auftrag wurde abgeschlossen. Wir freuen uns über dein Feedback!").setImage(BANNER_URL)],
    components: [new ActionRowBuilder().addComponents(fbBtn)]
  });

  await interaction.reply({ content: "✅ Abgeschlossen. Feedback-Button wurde gepostet.", ephemeral: true });
}

// Feedback Button → Modal (Sterne/Text)
client.on("interactionCreate", async (i) => {
  if (i.isButton() && i.customId === "feedback_open") {
    const modal = new ModalBuilder().setCustomId("feedbackModal").setTitle("Feedback abgeben");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("stars").setLabel("Sterne (1-5)").setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("text").setLabel("Dein Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true)),
    );
    return i.showModal(modal);
  }
});

/* === Giveaway Ende === */
async function endGiveaway(msgid, interaction = null) {
  const giveaways = loadGiveaways();
  const g = giveaways.find(x => x.messageId === msgid);
  if (!g || g.beendet) return;
  g.beendet = true;
  saveGiveaways(giveaways);

  try {
    const guild = await client.guilds.fetch(g.guildId);
    const ch = await guild.channels.fetch(g.channelId);
    const msg = await ch.messages.fetch(g.messageId);

    if (!g.teilnehmer.length) {
      const embed = EmbedBuilder.from(msg.embeds[0])
        .setColor("#808080")
        .setDescription(`**Preis:** ${g.preis}\n👥 **Teilnehmer:** 0\n\n❌ Keine Teilnehmer 😢`)
        .setFooter({ text: "Giveaway beendet" });
      await msg.edit({ embeds: [embed], components: [] });
      if (interaction) await interaction.reply({ content: "❌ Keine Teilnehmer. Giveaway beendet.", ephemeral: true });
      return;
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

/* =====================================
   $rename (nur Team) – Textbefehl
===================================== */
client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  if (!msg.content.toLowerCase().startsWith("$rename ")) return;
  const member = await msg.guild.members.fetch(msg.author.id);
  if (!isTeam(member)) return msg.reply("❌ Nur Team darf $rename nutzen.");

  const newName = msg.content.slice(8).trim();
  if (!newName) return msg.reply("⚠️ Bitte neuen Namen angeben.");
  try {
    await msg.channel.setName(newName);
    await msg.reply(`✅ Channel umbenannt zu **${newName}**.`);
  } catch {
    await msg.reply("❌ Konnte Channel nicht umbenennen.");
  }
});

/* =====================================
   Logging
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

/* =====================================
   Login
===================================== */
client.login(process.env.DISCORD_TOKEN);