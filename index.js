// ===============================
// Kandar Bot - ALL-IN-ONE (Teil 1/2)
// ES Module (package.json -> "type":"module")
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
  Partials,
} from "discord.js";
import fs from "fs";
import path from "path";
import "dotenv/config";

// ===============================
// ENV & Konstanten
// ===============================
const {
  DISCORD_TOKEN,
  BOT_ID,
  GUILD_ID,

  // Rollen/Kanäle
  VERIFY_ROLE_ID,
  TEAM_ROLE_IDS,              // Kommagetrennt: z.B. "123,456"
  MEMBER_LOGS_CHANNEL_ID,
  MESSAGE_LOGS_CHANNEL_ID,
  CHANNEL_LOGS_CHANNEL_ID,
  ROLE_LOGS_CHANNEL_ID,
  VOICE_LOGS_CHANNEL_ID,
  SERVER_LOGS_CHANNEL_ID,     // optional
  WELCOME_CHANNEL_ID,
  BOOSTER_CHANNEL_ID,
  TICKET_LOG_CHANNEL_ID,
  FEEDBACK_CHANNEL_ID,

  // Branding
  BRAND_NAME,                 // z.B. "Kandar"
  TWITCH_STREAMER,            // z.B. "cxlxrized_"
} = process.env;

const TEAM_ROLES = (TEAM_ROLE_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const BANNER_URL = "https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif";
const BRAND = BRAND_NAME || "Kandar";

// ===============================
// Files / Storage
// ===============================
const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Dateien, die in Teil 2 weiter benutzt werden:
const GIVEAWAY_FILE = path.join(DATA_DIR, "giveaways.json");
const CREATORS_FILE = path.join(DATA_DIR, "creators.json");
const SHOP_FILE = path.join(DATA_DIR, "shop.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

// Init falls nicht vorhanden
for (const f of [GIVEAWAY_FILE, CREATORS_FILE, SHOP_FILE, ORDERS_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");
}

// ===============================
// Client
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

// ===============================
// Utils
// ===============================
const hasAnyTeamRole = (member) => {
  if (!TEAM_ROLES.length) return false;
  return member.roles.cache.some(r => TEAM_ROLES.includes(r.id));
};

const ensureJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const saveJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ===============================
// Slash Commands (alle registrieren; Logik teils in Teil 2)
// ===============================
const commands = [
  // PayPal (Logik in Teil 2)
  new SlashCommandBuilder()
    .setName("paypal")
    .setDescription("Erstellt einen PayPal-Zahlungslink (auch Cent möglich)")
    .addNumberOption(o =>
      o.setName("betrag")
        .setDescription("Betrag in Euro (z. B. 12.99)")
        .setRequired(true)
    ),

  // Ticket Panel
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Sendet das Ticket-Panel (Dropdown)"),

  // Verify
  new SlashCommandBuilder()
    .setName("verifymsg")
    .setDescription("Sendet die Verify-Nachricht"),

  // Nuke (Logik in Teil 2)
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Löscht viele Nachrichten im aktuellen Channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // Creator (Logik in Teil 2)
  new SlashCommandBuilder()
    .setName("creator")
    .setDescription("Creator-System verwalten")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Erstellt ein Creator-Panel mit Social-Links")
    ),

  // Giveaways (Logik in Teil 2)
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

  // Shop (Logik in Teil 2)
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Artikel-Verwaltung")
    .addSubcommand(s => s.setName("add")
      .setDescription("Artikel ins Sortiment einfügen")
      .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
      .addNumberOption(o => o.setName("preis").setDescription("Preis in EUR (z. B. 9.99)").setRequired(true)))
    .addSubcommand(s => s.setName("remove")
      .setDescription("Artikel aus Sortiment entfernen")
      .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true)))
    .addSubcommand(s => s.setName("list")
      .setDescription("Alle Artikel auflisten")),

  // Order (Logik in Teil 2)
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Neue Bestellung erstellen")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde auswählen").setRequired(true))
    .addStringOption(o => o.setName("artikel").setDescription("Artikel aus dem Shop auswählen").setRequired(true)),

  // Embed (Logik in Teil 2)
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Erstellt ein Embed über ein Modal"),
].map(c => c.toJSON());

// Commands registrieren (Guild-Scoped)
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await (async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(BOT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash Commands registriert!");
  } catch (err) {
    console.error("❌ Fehler beim Registrieren:", err);
  }
})();

// ===============================
// Ready (Stats in Teil 2 ergänzt)
// ===============================
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);
});

// ===============================
// VERIFY: Panel + Button (immer Rolle geben)
// ===============================
client.on("interactionCreate", async (i) => {
  try {
    // /verifymsg
    if (i.isChatInputCommand() && i.commandName === "verifymsg") {
      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("✅ Verifizierung")
        .setDescription("Drücke unten auf **Verifizieren**, um Zugriff auf den Server zu erhalten!")
        .setImage(BANNER_URL)
        .setFooter({ text: `${BRAND} Community` });

      const button = new ButtonBuilder()
        .setCustomId("verify_button")
        .setLabel("Verifizieren")
        .setStyle(ButtonStyle.Success);

      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    // Button: verify_button
    if (i.isButton() && i.customId === "verify_button") {
      try {
        const role = i.guild.roles.cache.get(VERIFY_ROLE_ID);
        if (!role) return i.reply({ content: "❌ Verify-Rolle nicht gefunden!", ephemeral: true });

        // immer hinzufügen, auch wenn Member bereits andere Rollen hat
        const member = await i.guild.members.fetch(i.user.id);
        if (member.roles.cache.has(role.id)) {
          // trotzdem einmal “bestätigen”
          return i.reply({ content: "✅ Du bist bereits verifiziert!", ephemeral: true });
        }

        await member.roles.add(role);
        return i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
      } catch (err) {
        console.error("Verify-Error:", err);
        return i.reply({ content: "❌ Konnte die Verify-Rolle nicht vergeben. Bot-Rechte & Rollen-Hierarchie prüfen.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("❌ Verify-Handler Fehler:", err);
  }
});

// ===============================
// TICKETS: /panel + Dropdown + Modals + Close + Rename
// ===============================
const TICKET_CLOSE_BTN_ID = "ticket_close_btn";
const TICKET_CLOSE_MODAL_ID = "ticket_close_modal";
const TICKET_CLOSE_REASON_ID = "ticket_close_reason";

// /panel schickt das Auswahl-Panel
client.on("interactionCreate", async (i) => {
  try {
    if (i.isChatInputCommand() && i.commandName === "panel") {
      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("🎟 Support & Bewerbungen")
        .setDescription(
          [
            "Bitte wähle unten die Art deines Tickets aus:",
            "",
            "💰 **Shop Ticket** – Käufe & Bestellungen",
            "🎥 **Streamer Bewerbung** – Bewirb dich als Creator",
            "✍️ **Kandar Bewerbung** – Allgemeine Bewerbung",
            "🎨 **Designer Bewerbung** – Bewerbung als Designer",
            "✂️ **Cutter Bewerbung** – Bewerbung als Cutter",
            "🛠️ **Highteam Anliegen** – Interne Anliegen",
            "👥 **Support Anliegen** – Hilfe & Fragen",
          ].join("\n")
        )
        .setImage(BANNER_URL)
        .setFooter({ text: `${BRAND} Support` });

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

      return i.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }
  } catch (err) {
    console.error("❌ /panel Fehler:", err);
  }
});

// Dropdown-Auswahl
client.on("interactionCreate", async (i) => {
  try {
    if (!i.isStringSelectMenu() || i.customId !== "ticket_select") return;
    const choice = i.values[0];

    // SHOP → Modal
    if (choice === "shop") {
      const modal = new ModalBuilder()
        .setCustomId("shopTicketModal")
        .setTitle("💰 Shop Ticket erstellen");

      const payment = new TextInputBuilder()
        .setCustomId("payment")
        .setLabel("Zahlungsmethode (PayPal, Überweisung, …)")
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

    // STREAMER → Modal
    if (choice === "streamer") {
      const modal = new ModalBuilder()
        .setCustomId("streamerTicketModal")
        .setTitle("🎥 Streamer Bewerbung");

      const follower = new TextInputBuilder()
        .setCustomId("follower")
        .setLabel("Follower (z. B. 1200)")
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

    // Andere Kategorien → Direkt Channel
    const map = {
      kandar:  { title: "✍️ Kandar Bewerbung", cat: "✍️ Kandar Bewerbungen", desc: "Bitte schreibe deine Bewerbung hier." },
      designer:{ title: "🎨 Designer Bewerbung", cat: "🎨 Designer Bewerbungen", desc: "Bitte sende dein Portfolio." },
      cutter:  { title: "✂️ Cutter Bewerbung",   cat: "✂️ Cutter Bewerbungen",   desc: "Bitte nenne Software & Erfahrung." },
      highteam:{ title: "🛠️ Highteam Ticket",    cat: "🛠️ Highteam Anliegen",    desc: "Beschreibe bitte dein Anliegen." },
      support: { title: "👥 Support Ticket",      cat: "👥 Support Anliegen",      desc: "Beschreibe bitte dein Anliegen." },
    };

    const data = map[choice];
    if (!data) return i.reply({ content: "❌ Ungültige Auswahl.", ephemeral: true });

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

    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setTitle(data.title)
      .setDescription(`${data.desc}\n\n🔒 *Dieses Ticket ist nur für dich und das Team sichtbar.*`)
      .setImage(BANNER_URL)
      .setFooter({ text: `${BRAND} Support` });

    // Close Button unter das Ticket
    const closeBtn = new ButtonBuilder()
      .setCustomId(TICKET_CLOSE_BTN_ID)
      .setLabel("Ticket schließen")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger);

    await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });

    // Log
    if (TICKET_LOG_CHANNEL_ID) {
      const logCh = guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
      if (logCh) {
        const logEmbed = new EmbedBuilder()
          .setColor("#00AA00")
          .setTitle("🧾 Ticket erstellt")
          .setDescription(`**Typ:** ${data.title}\n**User:** ${i.user.tag}\n**Channel:** ${ch}`)
          .setTimestamp();
        logCh.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }

    return i.reply({ content: `✅ Ticket erstellt: ${ch}`, ephemeral: true });
  } catch (err) {
    console.error("❌ Ticket-Auswahl Fehler:", err);
  }
});

// SHOP Modal Submit
client.on("interactionCreate", async (i) => {
  try {
    if (!i.isModalSubmit() || i.customId !== "shopTicketModal") return;

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
      .setColor("#00FF00")
      .setTitle("💰 Shop Ticket")
      .setDescription(`🧾 **Zahlungsmethode:** ${payment}\n📦 **Artikel:** ${item}`)
      .setImage(BANNER_URL)
      .setFooter({ text: `${BRAND} Shop` });

    const closeBtn = new ButtonBuilder()
      .setCustomId(TICKET_CLOSE_BTN_ID)
      .setLabel("Ticket schließen")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger);

    await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
    return i.reply({ content: `✅ Shop Ticket erstellt: ${ch}`, ephemeral: true });
  } catch (err) {
    console.error("❌ Shop-Modal Fehler:", err);
  }
});

// STREAMER Modal Submit
client.on("interactionCreate", async (i) => {
  try {
    if (!i.isModalSubmit() || i.customId !== "streamerTicketModal") return;

    const follower = i.fields.getTextInputValue("follower");
    const avgViewer = i.fields.getTextInputValue("avg_viewer");
    const twitch = i.fields.getTextInputValue("twitch_link");
    const guild = i.guild;

    const catName = "🎥 Streamer Bewerbungen";
    let cat = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
    if (!cat) cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

    const ch = await guild.channels.create({
      name: `🎥-${i.user.username}`,
      type: ChannelType.GuildText,
      parent: cat.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
        { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ],
    });

    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("🎥 Streamer Bewerbung")
      .setDescription(`👤 **Follower:** ${follower}\n📈 **Average Viewer:** ${avgViewer}\n🔗 **Twitch:** ${twitch}`)
      .setImage(BANNER_URL)
      .setFooter({ text: `${BRAND} Creator` });

    const closeBtn = new ButtonBuilder()
      .setCustomId(TICKET_CLOSE_BTN_ID)
      .setLabel("Ticket schließen")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger);

    await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
    return i.reply({ content: `✅ Streamer Bewerbung erstellt: ${ch}`, ephemeral: true });
  } catch (err) {
    console.error("❌ Streamer-Modal Fehler:", err);
  }
});

// Close-Button -> Close-Modal öffnen (nur Team darf schließen)
client.on("interactionCreate", async (i) => {
  try {
    if (!i.isButton() || i.customId !== TICKET_CLOSE_BTN_ID) return;

    if (!hasAnyTeamRole(i.member)) {
      return i.reply({ content: "🚫 Nur Team-Mitglieder dürfen Tickets schließen.", ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(TICKET_CLOSE_MODAL_ID)
      .setTitle("Ticket schließen – Grund");

    const reason = new TextInputBuilder()
      .setCustomId(TICKET_CLOSE_REASON_ID)
      .setLabel("Schließgrund")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reason));
    return i.showModal(modal);
  } catch (err) {
    console.error("❌ Ticket-Close-Button Fehler:", err);
  }
});

// Close-Modal Submit → Channel schließen/locken, umbenennen, loggen
client.on("interactionCreate", async (i) => {
  try {
    if (!i.isModalSubmit() || i.customId !== TICKET_CLOSE_MODAL_ID) return;

    if (!hasAnyTeamRole(i.member)) {
      return i.reply({ content: "🚫 Nur Team-Mitglieder dürfen Tickets schließen.", ephemeral: true });
    }

    const reason = i.fields.getTextInputValue(TICKET_CLOSE_REASON_ID) || "Kein Grund angegeben";
    const ch = i.channel;

    // Channel locken + umbenennen
    await ch.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false, SendMessages: false }).catch(() => {});
    try {
      if (!ch.name.startsWith("closed-")) {
        await ch.setName(`closed-${ch.name}`.slice(0, 100)); // Name-Limit
      }
    } catch (_) {}

    // Hinweis im Ticket + Log
    const closedEmbed = new EmbedBuilder()
      .setColor("#AA0000")
      .setTitle("🔒 Ticket geschlossen")
      .setDescription(`**Geschlossen von:** ${i.user}\n**Grund:** ${reason}`)
      .setImage(BANNER_URL)
      .setTimestamp()
      .setFooter({ text: `${BRAND} Support` });

    await ch.send({ embeds: [closedEmbed] });

    if (TICKET_LOG_CHANNEL_ID) {
      const logCh = i.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
      if (logCh) {
        const logEmbed = new EmbedBuilder()
          .setColor("#AA0000")
          .setTitle("🧾 Ticket geschlossen")
          .setDescription(`**Channel:** ${ch}\n**Von:** ${i.user}\n**Grund:** ${reason}`)
          .setTimestamp();
        logCh.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }

    return i.reply({ content: "✅ Ticket wurde geschlossen.", ephemeral: true });
  } catch (err) {
    console.error("❌ Ticket-Close-Modal Fehler:", err);
  }
});

// $rename (nur Team) – Nachricht im Ticket
client.on("messageCreate", async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    if (!msg.content.toLowerCase().startsWith("$rename ")) return;

    const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
    if (!member || !hasAnyTeamRole(member)) {
      return msg.reply("🚫 Nur Team-Mitglieder dürfen Tickets umbenennen.");
    }
    const newName = msg.content.slice("$rename ".length).trim();
    if (!newName) return msg.reply("⚠️ Bitte einen neuen Namen angeben: `$rename neuer-name`");
    if (newName.length > 90) return msg.reply("⚠️ Name ist zu lang (max. 90 Zeichen).");

    await msg.channel.setName(newName).catch(() => {});
    return msg.reply(`✅ Ticket umbenannt zu **${newName}**.`);
  } catch (err) {
    console.error("❌ $rename Fehler:", err);
  }
});

// ===============================
// Teil 1 Ende — der Rest (Order, PayPal, Finish, Feedback, Giveaways (persist), Creator, Logs, Twitch, Stats, Nuke, Embed-Modal) folgt in Teil 2.
// ===============================
/* =========================================================
   TEIL 2/2 – ADDONS (Order-Buttons, Tickets, Finish/Feedback,
   Giveaways, Creator, Embed, Panel, Nuke, Logging, Re-Register)
========================================================= */

// ---------- Hilfsfunktionen ----------
const getOrderByMsg = (msgId) => {
  const orders = loadJSON(FILES.orders);
  return { orders, idx: orders.findIndex(o => o.messageId === msgId) };
};
const computeTotal = (order) => {
  const shop = loadJSON(FILES.shop);
  let total = 0;
  for (const it of order.items) {
    const ref = shop.find(s => s.name === it.name);
    if (ref) total += ref.price * it.qty;
  }
  return Math.round(total * 100) / 100;
};
const buildOrderButtons = (total) => {
  const pay = new ButtonBuilder()
    .setLabel(`Jetzt ${total.toFixed(2)}€ zahlen`)
    .setStyle(ButtonStyle.Link)
    .setURL(paypalLink(total));
  const add = new ButtonBuilder().setCustomId("order_add").setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Primary);
  const remove = new ButtonBuilder().setCustomId("order_remove").setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary);
  const clear = new ButtonBuilder().setCustomId("order_clear").setLabel("🧹 Zurücksetzen").setStyle(ButtonStyle.Secondary);
  const process = new ButtonBuilder().setCustomId("order_processing").setLabel("🛠️ Bestellung bearbeiten").setStyle(ButtonStyle.Secondary);
  const finish = new ButtonBuilder().setCustomId("order_finish").setLabel("✅ Bestellung abschließen").setStyle(ButtonStyle.Success);
  const cancel = new ButtonBuilder().setCustomId("order_cancel").setLabel("🛑 Abbrechen").setStyle(ButtonStyle.Danger);
  return [
    new ActionRowBuilder().addComponents(pay),
    new ActionRowBuilder().addComponents(add, remove, clear),
    new ActionRowBuilder().addComponents(process, finish, cancel),
  ];
};
const updateOrderMessage = async (i, order) => {
  const total = computeTotal(order);
  const desc = order.items.length
    ? order.items.map(x => `• ${x.name} × **${x.qty}**`).join("\n") + `\n\n**Gesamt:** ${total.toFixed(2)}€`
    : "Noch keine Artikel. Nutze **➕ Artikel hinzufügen**.";
  const embed = EmbedBuilder.from(i.message.embeds[0])
    .setDescription(desc)
    .setFooter({ text: BRAND_FOOTER });
  await i.message.edit({ embeds: [embed], components: buildOrderButtons(total) });
};

// ---------- /embed (Modal) ----------
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "embed") {
    const modal = new ModalBuilder().setCustomId("custom_embed_modal").setTitle("Embed erstellen");
    const color = new TextInputBuilder().setCustomId("color").setLabel("Farbe (HEX, optional)").setStyle(TextInputStyle.Short);
    const title = new TextInputBuilder().setCustomId("title").setLabel("Titel").setStyle(TextInputStyle.Short).setRequired(true);
    const desc = new TextInputBuilder().setCustomId("desc").setLabel("Beschreibung (optional)").setStyle(TextInputStyle.Paragraph);
    const thumb = new TextInputBuilder().setCustomId("thumb").setLabel("Thumbnail URL (optional)").setStyle(TextInputStyle.Short);
    const image = new TextInputBuilder().setCustomId("image").setLabel("Bild URL (optional)").setStyle(TextInputStyle.Short);
    const footer = new TextInputBuilder().setCustomId("footer").setLabel("Footer (optional)").setStyle(TextInputStyle.Short);
    modal.addComponents(
      new ActionRowBuilder().addComponents(color),
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(desc),
      new ActionRowBuilder().addComponents(thumb),
      new ActionRowBuilder().addComponents(image),
      new ActionRowBuilder().addComponents(footer),
    );
    return i.showModal(modal);
  }
  if (i.isModalSubmit() && i.customId === "custom_embed_modal") {
    const c = i.fields.getTextInputValue("color") || BRAND_COLOR;
    const t = i.fields.getTextInputValue("title");
    const d = i.fields.getTextInputValue("desc");
    const th = i.fields.getTextInputValue("thumb");
    const im = i.fields.getTextInputValue("image") || BANNER_URL;
    const f = i.fields.getTextInputValue("footer") || BRAND_FOOTER;
    const embed = new EmbedBuilder().setColor(c).setTitle(t).setImage(im).setFooter({ text: f });
    if (d) embed.setDescription(d);
    if (th) embed.setThumbnail(th);
    return i.reply({ embeds: [embed] });
  }
});

// ---------- /creator add ----------
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "creator" && i.options.getSubcommand() === "add") {
    if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team.", ephemeral: true });
    const titel = i.options.getString("titel");
    const user = i.options.getUser("creator");
    const twitch = i.options.getString("twitch");
    const youtube = i.options.getString("youtube");
    const tiktok = i.options.getString("tiktok");
    const instagram = i.options.getString("instagram");
    const code = i.options.getString("code");
    const embed = new EmbedBuilder()
      .setColor("#9b5de5")
      .setTitle(titel)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER })
      .addFields({ name: "👤 Creator", value: `<@${user.id}>`, inline: true },
                 { name: "🔴 Twitch", value: twitch, inline: true });
    if (youtube) embed.addFields({ name: "▶️ YouTube", value: youtube, inline: true });
    if (tiktok) embed.addFields({ name: "🎵 TikTok", value: tiktok, inline: true });
    if (instagram) embed.addFields({ name: "📸 Instagram", value: instagram, inline: true });
    if (code) embed.addFields({ name: "💥 Creator Code", value: code, inline: true });
    await i.reply({ embeds: [embed] });
  }
});

// ---------- /panel (Ticket-Panel) + Close ----------
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "panel") {
    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setTitle("🎟 Support & Bewerbungen")
      .setDescription("Bitte wähle unten die Art deines Tickets aus.")
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });
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

  // Ticket-Erstellung
  if (i.isStringSelectMenu() && i.customId === "ticket_select") {
    const choice = i.values[0];
    const guild = i.guild;
    const catName = `${choice}-tickets`;
    let cat = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
    if (!cat) cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });
    const ch = await guild.channels.create({
      name: `${choice}-${i.user.username}`,
      type: ChannelType.GuildText,
      parent: cat.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
        { id: i.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ],
    });
    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setTitle(`🎫 ${choice.charAt(0).toUpperCase() + choice.slice(1)} Ticket`)
      .setDescription("Bitte schildere dein Anliegen unten.")
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });
    const closeBtn = new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Ticket schließen").setStyle(ButtonStyle.Danger);
    await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });
    return i.reply({ content: `✅ Ticket erstellt: ${ch}`, ephemeral: true });
  }

  if (i.isButton() && i.customId === "ticket_close") {
    if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team darf Tickets schließen.", ephemeral: true });
    const modal = new ModalBuilder().setCustomId("ticket_close_modal").setTitle("Ticket schließen");
    const reason = new TextInputBuilder().setCustomId("close_reason").setLabel("Grund des Schließens").setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(reason));
    return i.showModal(modal);
  }

  if (i.isModalSubmit() && i.customId === "ticket_close_modal") {
    const reason = i.fields.getTextInputValue("close_reason");
    const embed = new EmbedBuilder()
      .setColor("#ff4d4d")
      .setTitle("🔒 Ticket geschlossen")
      .setDescription(`Grund: ${reason}`)
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });
    await i.reply({ embeds: [embed] });
    try { await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false }); } catch {}
  }
});

// ---------- /finish + Feedback ----------
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "finish") {
    if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team.", ephemeral: true });
    const fb = new ButtonBuilder().setCustomId("feedback_open").setLabel("⭐ Feedback abgeben").setStyle(ButtonStyle.Primary);
    const embed = new EmbedBuilder()
      .setColor("#2ecc71")
      .setTitle("✅ Vorgang abgeschlossen")
      .setDescription("Danke! Du kannst jetzt Feedback abgeben. 🙌")
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });
    return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(fb)] });
  }

  if (i.isButton() && i.customId === "feedback_open") {
    const modal = new ModalBuilder().setCustomId("feedback_modal").setTitle("⭐ Feedback abgeben");
    const stars = new TextInputBuilder().setCustomId("stars").setLabel("Sterne (1-5)").setStyle(TextInputStyle.Short).setRequired(true);
    const text = new TextInputBuilder().setCustomId("text").setLabel("Dein Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(stars), new ActionRowBuilder().addComponents(text));
    return i.showModal(modal);
  }

  if (i.isModalSubmit() && i.customId === "feedback_modal") {
    const stars = Math.max(1, Math.min(5, parseInt(i.fields.getTextInputValue("stars")) || 5));
    const text = i.fields.getTextInputValue("text");
    const sellerSelect = new UserSelectMenuBuilder()
      .setCustomId(`feedback_seller_${stars}_${Buffer.from(text).toString("base64").slice(0, 900)}`)
      .setPlaceholder("Verkäufer auswählen")
      .setMinValues(1)
      .setMaxValues(1);
    return i.reply({
      content: "👤 Bitte wähle den Verkäufer aus:",
      components: [new ActionRowBuilder().addComponents(sellerSelect)],
      ephemeral: true,
    });
  }

  if (i.isUserSelectMenu() && i.customId.startsWith("feedback_seller_")) {
    const parts = i.customId.split("_");
    const stars = parseInt(parts[2], 10);
    const text = Buffer.from(parts.slice(3).join("_"), "base64").toString();
    const seller = i.users.first();
    const channelId = process.env.FEEDBACK_CHANNEL_ID;
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    const starsEmoji = "⭐".repeat(stars) + "☆".repeat(5 - stars);
    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("📝 Neues Feedback eingegangen")
      .setDescription(`${starsEmoji}\n\n${text}\n\n👤 **Verkäufer:** <@${seller.id}>`)
      .setImage(BANNER_URL)
      .setFooter({ text: "Kandar Streaming" });
    if (channel) await channel.send({ embeds: [embed] });
    await i.update({ content: "✅ Danke! Dein Feedback wurde gespeichert.", components: [] });
  }
});

// ---------- Logging ----------
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

// ---------- Login ----------
client.login(process.env.DISCORD_TOKEN);
