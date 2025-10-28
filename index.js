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
import "dotenv/config";
import fetch from "node-fetch";

/* === CLIENT SETUP === */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
});

/* === DATA FOLDER === */
if (!fs.existsSync("./data")) fs.mkdirSync("./data");
const GIVEAWAY_FILE = "./data/giveaways.json";
const SHOP_FILE = "./data/shop.json";
const STREAMER_FILE = "./data/streamers.json";
if (!fs.existsSync(GIVEAWAY_FILE)) fs.writeFileSync(GIVEAWAY_FILE, "[]");
if (!fs.existsSync(SHOP_FILE)) fs.writeFileSync(SHOP_FILE, "[]");
if (!fs.existsSync(STREAMER_FILE)) fs.writeFileSync(STREAMER_FILE, "[]");

/* === SLASH COMMANDS === */
const commands = [
  new SlashCommandBuilder()
    .setName("verifymsg")
    .setDescription("Sendet die Verify-Nachricht"),
  new SlashCommandBuilder()
    .setName("paypal")
    .setDescription("Erstellt einen PayPal-Link")
    .addNumberOption(o =>
      o.setName("betrag").setDescription("Betrag in Euro (z. B. 5.50)").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Sendet das Ticket-Panel"),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Fügt einen Artikel ins Sortiment ein")
    .addStringOption(o => o.setName("artikel").setDescription("Name des Artikels").setRequired(true))
    .addNumberOption(o => o.setName("preis").setDescription("Preis in €").setRequired(true)),
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Erstellt eine neue Bestellung für einen Kunden")
    .addUserOption(o => o.setName("kunde").setDescription("Der Kunde").setRequired(true))
    .addStringOption(o => o.setName("artikel").setDescription("Artikel auswählen").setRequired(true)
      .setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Löscht alle Nachrichten im aktuellen Channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Startet ein Giveaway")
    .addStringOption(o => o.setName("preis").setDescription("Preis").setRequired(true))
    .addStringOption(o => o.setName("dauer").setDescription("z. B. 1d, 2h, 30m").setRequired(true))
    .addIntegerOption(o => o.setName("gewinner").setDescription("Anzahl der Gewinner").setRequired(true)),
  new SlashCommandBuilder()
    .setName("streamer")
    .setDescription("Streamer verwalten")
    .addSubcommand(s => s.setName("add").setDescription("Streamer hinzufügen")
      .addUserOption(o => o.setName("nutzer").setDescription("Streamer User").setRequired(true))
      .addStringOption(o => o.setName("twitch").setDescription("Twitch Kanalname").setRequired(true))),
].map(c => c.toJSON());

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

/* === HILFSFUNKTIONEN === */
function parseDuration(str) {
  const regex = /(\d+d)?(\d+h)?(\d+m)?/;
  const match = str.match(regex);
  let ms = 0;
  if (match[1]) ms += parseInt(match[1]) * 86400000;
  if (match[2]) ms += parseInt(match[2]) * 3600000;
  if (match[3]) ms += parseInt(match[3]) * 60000;
  return ms;
}
const loadData = file => JSON.parse(fs.readFileSync(file, "utf8"));
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

/* === READY === */
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);
});

/* === VERIFY SYSTEM === */
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "verifymsg") {
    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setTitle("✅ Verifizierung & Regeln")
      .setDescription(
        "Willkommen bei **Kandar**! 🎉\n\n" +
        "Bitte lies die folgenden Regeln sorgfältig:\n" +
        "1️⃣ Respektiere alle Mitglieder.\n" +
        "2️⃣ Kein Spam oder Werbung.\n" +
        "3️⃣ Halte dich an Discords Richtlinien.\n\n" +
        "Drücke unten auf **Verifizieren**, um Zugriff zu erhalten."
      )
      .setImage("https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif");

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
      await i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
    } catch (err) {
      i.reply({ content: "❌ Fehler beim Zuweisen der Rolle. Prüfe Bot-Rechte.", ephemeral: true });
    }
  }
});

/* === PAYPAL COMMAND === */
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "paypal") {
    const amount = i.options.getNumber("betrag");
    if (amount <= 0) return i.reply({ content: "❌ Ungültiger Betrag!", ephemeral: true });

    const link = `https://www.paypal.com/paypalme/jonahborospreitzer/${amount}`;
    const embed = new EmbedBuilder()
      .setColor("#00AAFF")
      .setTitle("💰 Kandar Shop Zahlung")
      .setDescription(
        `Klicke unten, um **${amount.toFixed(2)}€** zu zahlen.\n\n` +
        "Mit dem Kauf stimmst du unseren **AGB's** zu."
      )
      .setFooter({ text: "Kandar Shop" })
      .setImage("https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif");

    const btn = new ButtonBuilder().setLabel(`Jetzt ${amount.toFixed(2)}€ zahlen`).setStyle(ButtonStyle.Link).setURL(link);
    return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
  }
});

/* === SHOP SYSTEM === */
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "shop") {
    const artikel = i.options.getString("artikel");
    const preis = i.options.getNumber("preis");

    const shop = loadData(SHOP_FILE);
    shop.push({ artikel, preis });
    saveData(SHOP_FILE, shop);

    const embed = new EmbedBuilder()
      .setColor("#00FF88")
      .setTitle("🛒 Neuer Artikel im Kandar Shop")
      .setDescription(`**${artikel}** wurde hinzugefügt!\n💶 **Preis:** ${preis.toFixed(2)}€`)
      .setFooter({ text: "Kandar Shop" })
      .setTimestamp();

    await i.reply({ embeds: [embed] });
  }
});

/* === ORDER SYSTEM === */
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "order") {
    const kunde = i.options.getUser("kunde");
    const artikelName = i.options.getString("artikel");
    const shop = loadData(SHOP_FILE);
    const artikel = shop.find(a => a.artikel === artikelName);
    if (!artikel) return i.reply({ content: "❌ Artikel nicht gefunden!", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor("#9B5DE5")
      .setTitle(`🛍️ Bestellung von ${kunde.username}`)
      .setDescription(`📦 **Artikel:** ${artikel.artikel}\n💰 **Preis:** ${artikel.preis.toFixed(2)}€`)
      .setFooter({ text: "Kandar Shop" })
      .setImage("https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif");

    const pay = new ButtonBuilder()
      .setLabel(`Jetzt ${artikel.preis.toFixed(2)}€ zahlen`)
      .setStyle(ButtonStyle.Link)
      .setURL(`https://www.paypal.com/paypalme/jonahborospreitzer/${artikel.preis}`);

    const finish = new ButtonBuilder()
      .setCustomId("finish_order")
      .setLabel("✅ Bestellung abschließen")
      .setStyle(ButtonStyle.Success);

    const edit = new ButtonBuilder()
      .setCustomId("edit_order")
      .setLabel("🛠️ Bestellung bearbeiten")
      .setStyle(ButtonStyle.Secondary);

    await i.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(pay, edit, finish)]
    });
  }
});
/* === ORDER BUTTON HANDLER === */
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  // Bestellung abschließen
  if (i.customId === "finish_order") {
    await i.reply({ content: "✅ Bestellung wurde abgeschlossen!", ephemeral: true });
    const feedbackCh = i.guild.channels.cache.get(process.env.FEEDBACK_CHANNEL_ID);
    if (!feedbackCh) return;

    const embed = new EmbedBuilder()
      .setColor("#FF0000")
      .setTitle("📝 Feedback")
      .setDescription(`Bitte gib uns dein Feedback zur Bestellung ab!`)
      .setImage("https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif")
      .setFooter({ text: "Kandar Shop" });

    const btn = new ButtonBuilder()
      .setCustomId("give_feedback")
      .setLabel("Feedback abgeben 💬")
      .setStyle(ButtonStyle.Primary);

    await feedbackCh.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
  }

  // Bestellung bearbeiten (Team Only)
  if (i.customId === "edit_order") {
    if (!i.member.roles.cache.some(r => process.env.TEAM_ROLES.split(",").includes(r.id))) {
      return i.reply({ content: "❌ Nur Teammitglieder dürfen das.", ephemeral: true });
    }

    const user = i.message.embeds[0]?.title?.match(/von (.*)/i)?.[1];
    const member = i.guild.members.cache.find(m => m.user.username === user);
    if (member) {
      try {
        const dm = await member.createDM();
        const embed = new EmbedBuilder()
          .setColor("#00AAFF")
          .setTitle("🛠️ Deine Bestellung wird bearbeitet")
          .setDescription(
            "Hallo 👋\n\nDeine Bestellung wird gerade von einem Teammitglied bearbeitet.\n" +
            "Bitte habe etwas Geduld. Wir melden uns bald bei dir! 💙"
          )
          .setImage("https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif");
        await dm.send({ embeds: [embed] });
      } catch {
        console.log("❗ Kunde konnte keine DM empfangen.");
      }
    }

    const newEmbed = EmbedBuilder.from(i.message.embeds[0])
      .setTitle("🛠️ Bestellung in Bearbeitung ⏳");

    await i.message.edit({ embeds: [newEmbed] });
    await i.reply({ content: "ℹ️ Kunde wurde informiert, Bestellung markiert.", ephemeral: true });
  }

  // Feedback modal
  if (i.customId === "give_feedback") {
    const modal = new ModalBuilder().setCustomId("feedbackModal").setTitle("📝 Feedback abgeben");
    const stars = new TextInputBuilder().setCustomId("stars").setLabel("⭐ Bewertung (1-5)").setStyle(TextInputStyle.Short).setRequired(true);
    const text = new TextInputBuilder().setCustomId("text").setLabel("💬 Dein Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true);
    const seller = new TextInputBuilder().setCustomId("seller").setLabel("👤 Verkäufer").setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(
      new ActionRowBuilder().addComponents(stars),
      new ActionRowBuilder().addComponents(text),
      new ActionRowBuilder().addComponents(seller)
    );
    await i.showModal(modal);
  }
});

// Feedback submit
client.on("interactionCreate", async i => {
  if (i.isModalSubmit() && i.customId === "feedbackModal") {
    const stars = i.fields.getTextInputValue("stars");
    const text = i.fields.getTextInputValue("text");
    const seller = i.fields.getTextInputValue("seller");
    const feedbackCh = i.guild.channels.cache.get(process.env.FEEDBACK_CHANNEL_ID);
    if (!feedbackCh) return;

    const embed = new EmbedBuilder()
      .setColor("#FF0000")
      .setTitle("💬 Neues Kundenfeedback")
      .setDescription(`⭐ **Bewertung:** ${stars}/5\n🧾 **Kommentar:** ${text}\n👤 **Verkäufer:** ${seller}`)
      .setImage("https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif")
      .setFooter({ text: "Kandar Shop Feedback" });

    await feedbackCh.send({ embeds: [embed] });
    await i.reply({ content: "✅ Dein Feedback wurde gesendet! Vielen Dank ❤️", ephemeral: true });
  }
});

/* === GIVEAWAYS === */
const GIVEAWAYS = () => JSON.parse(fs.readFileSync(GIVEAWAY_FILE, "utf8"));
const SAVE_GIVEAWAYS = data => fs.writeFileSync(GIVEAWAY_FILE, JSON.stringify(data, null, 2));

client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "giveaway") {
    const preis = i.options.getString("preis");
    const dauerStr = i.options.getString("dauer");
    const gewinner = i.options.getInteger("gewinner");
    const dauer = parseDuration(dauerStr);
    const endZeit = Date.now() + dauer;

    const embed = new EmbedBuilder()
      .setColor("#9B5DE5")
      .setTitle("🎉 Neues Giveaway 🎉")
      .setDescription(`🎁 **Preis:** ${preis}\n🏆 **Gewinner:** ${gewinner}\n⏰ **Endet in:** ${dauerStr}`)
      .setFooter({ text: "Kandar Giveaways" })
      .setTimestamp(new Date(endZeit))
      .setImage("https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif");

    const btn = new ButtonBuilder().setCustomId("join_giveaway").setLabel("Teilnehmen 🎉").setStyle(ButtonStyle.Primary);
    const msg = await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)], fetchReply: true });

    const data = GIVEAWAYS();
    data.push({ messageId: msg.id, channelId: msg.channel.id, guildId: msg.guild.id, preis, endZeit, gewinner, teilnehmer: [] });
    SAVE_GIVEAWAYS(data);
  }

  if (i.isButton() && i.customId === "join_giveaway") {
    const data = GIVEAWAYS();
    const g = data.find(x => x.messageId === i.message.id);
    if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden.", ephemeral: true });
    if (g.teilnehmer.includes(i.user.id)) return i.reply({ content: "🚫 Du bist bereits dabei.", ephemeral: true });
    g.teilnehmer.push(i.user.id);
    SAVE_GIVEAWAYS(data);

    const count = g.teilnehmer.length;
    const updated = EmbedBuilder.from(i.message.embeds[0])
      .setDescription(`🎁 **Preis:** ${g.preis}\n👥 **Teilnehmer:** ${count}\n🏆 **Gewinner:** ${g.gewinner}`);
    await i.message.edit({ embeds: [updated] });
    await i.reply({ content: "✅ Teilnahme registriert!", ephemeral: true });
  }
});

/* === STREAMER ANNOUNCE === */
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "streamer" && i.options.getSubcommand() === "add") {
    const nutzer = i.options.getUser("nutzer");
    const twitch = i.options.getString("twitch");
    const list = loadData(STREAMER_FILE);
    list.push({ id: nutzer.id, twitch });
    saveData(STREAMER_FILE, list);
    await i.reply({ content: `✅ Streamer **${nutzer.username}** (${twitch}) hinzugefügt!`, ephemeral: true });
  }
});

// Twitch Checker
setInterval(async () => {
  const streamers = loadData(STREAMER_FILE);
  for (const s of streamers) {
    try {
      const res = await fetch(`https://decapi.me/twitch/status/${s.twitch}`);
      const text = await res.text();
      if (!text.includes("offline")) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const channel = guild.channels.cache.get(process.env.STREAM_ANNOUNCE_CHANNEL_ID);
        if (channel && !text.includes("⏹")) {
          const embed = new EmbedBuilder()
            .setColor("#9146FF")
            .setTitle(`🔴 ${s.twitch} ist jetzt live!`)
            .setDescription(`[Jetzt ansehen!](https://twitch.tv/${s.twitch})`)
            .setImage(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.twitch}-640x360.jpg`)
            .setFooter({ text: "Kandar Streaming" })
            .setTimestamp();
          await channel.send({ embeds: [embed] });
        }
      }
    } catch {}
  }
}, 300000); // alle 5 Min prüfen

/* === LOGGING SYSTEM === */
client.on("guildMemberAdd", m => {
  const log = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("👋 Neues Mitglied").setDescription(`${m}`)] });
});
client.on("guildMemberRemove", m => {
  const log = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🚪 Mitglied hat verlassen").setDescription(`${m.user.tag}`)] });
});
client.on("messageDelete", msg => {
  if (!msg.guild || msg.author?.bot) return;
  const log = msg.guild.channels.cache.get(process.env.MESSAGE_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑️ Nachricht gelöscht").setDescription(`Von ${msg.author}\n${msg.content || "Embed/Datei"}`)] });
});
client.on("voiceStateUpdate", (o, n) => {
  const log = n.guild.channels.cache.get(process.env.VOICE_LOGS_CHANNEL_ID);
  if (!log) return;
  let desc = "";
  const user = n.member.user;
  if (!o.channel && n.channel) desc = `🎙️ ${user} ist **${n.channel.name}** beigetreten.`;
  else if (o.channel && !n.channel) desc = `🔇 ${user} hat **${o.channel.name}** verlassen.`;
  if (desc) log.send({ embeds: [new EmbedBuilder().setColor("#00AAFF").setTitle("🔊 Voice Log").setDescription(desc)] });
});

/* === LOGIN === */
client.login(process.env.DISCORD_TOKEN);
