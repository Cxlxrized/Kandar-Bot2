// ================================
// KANDAR BOT - ALL IN ONE
// ================================
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
import "dotenv/config";

// ====== KONSTANTEN / DESIGN ======
const BANNER_URL = "https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif";
const BRAND_COLOR = "#42b883";
const BRAND_FOOTER = "Kandar Shop";

// ====== TEAM ROLLEN ======
const TEAM_ROLE_IDS = (process.env.TEAM_ROLE_IDS || "")
  .split(",")
  .map(r => r.trim())
  .filter(Boolean);

const isTeam = member =>
  TEAM_ROLE_IDS.some(id => member.roles.cache.has(id));

// ====== DATEIEN ======
if (!fs.existsSync("./data")) fs.mkdirSync("./data");
const FILES = {
  giveaways: "./data/giveaways.json",
  creators: "./data/creators.json",
  shop: "./data/shop.json",
  orders: "./data/orders.json",
};
for (const f of Object.values(FILES))
  if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");

const loadJSON = p => JSON.parse(fs.readFileSync(p, "utf8"));
const saveJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

const PAYPAL_ME = process.env.PAYPAL_ME || "jonahborospreitzer";
const paypalLink = amount =>
  `https://www.paypal.com/paypalme/${encodeURIComponent(PAYPAL_ME)}/${amount.toFixed(2)}`;

// ====== CLIENT ======
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

// ====== HILFSFUNKTIONEN ======
const fmtMoney = v => {
  let s = String(v).replace(",", ".").trim();
  let n = Number(s);
  if (isNaN(n)) n = 0;
  return Math.round(n * 100) / 100;
};
const parseDuration = str => {
  if (!str) return 0;
  const m = str.match(/(\d+d)?(\d+h)?(\d+m)?/);
  if (!m) return 0;
  let ms = 0;
  if (m[1]) ms += parseInt(m[1]) * 86400000;
  if (m[2]) ms += parseInt(m[2]) * 3600000;
  if (m[3]) ms += parseInt(m[3]) * 60000;
  return ms;
};

// ====== SLASH COMMANDS ======
const commands = [
  new SlashCommandBuilder()
    .setName("paypal")
    .setDescription("Erstellt einen PayPal-Link (unterstützt Centbeträge)")
    .addStringOption(o =>
      o
        .setName("betrag")
        .setDescription("Betrag (z. B. 9.99 oder 9,99)")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("verifymsg")
    .setDescription("Sendet die Verify-Nachricht"),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Sortiment verwalten")
    .addSubcommand(s =>
      s
        .setName("add")
        .setDescription("Artikel hinzufügen")
        .addStringOption(o =>
          o.setName("name").setDescription("Artikelname").setRequired(true)
        )
        .addStringOption(o =>
          o.setName("preis").setDescription("Preis").setRequired(true)
        )
    )
    .addSubcommand(s =>
      s
        .setName("remove")
        .setDescription("Artikel löschen")
        .addStringOption(o =>
          o.setName("name").setDescription("Artikelname").setRequired(true)
        )
    )
    .addSubcommand(s => s.setName("list").setDescription("Artikel anzeigen")),
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Erstellt eine Bestellung")
    .addUserOption(o =>
      o.setName("kunde").setDescription("Kunde").setRequired(true)
    ),
].map(c => c.toJSON());

// ====== REGISTRIERUNG ======
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

// ====== READY EVENT ======
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);
});

// ====== VERIFY SYSTEM ======
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "verifymsg") {
    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setTitle("✅ Verifizierung")
      .setDescription(
        "Drücke unten auf **Verifizieren**, um Zugriff auf den Server zu erhalten!"
      )
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });
    const btn = new ButtonBuilder()
      .setCustomId("verify_button")
      .setLabel("Verifizieren")
      .setStyle(ButtonStyle.Success);
    return i.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(btn)],
    });
  }

  if (i.isButton() && i.customId === "verify_button") {
    const role = i.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
    if (!role)
      return i.reply({
        content: "❌ Verify-Rolle nicht gefunden!",
        ephemeral: true,
      });
    try {
      await i.member.roles.add(role);
      return i.reply({
        content: "🎉 Du bist jetzt verifiziert!",
        ephemeral: true,
      });
    } catch {
      return i.reply({
        content:
          "❌ Konnte die Verify-Rolle nicht vergeben. Bitte prüfe die Botrechte.",
        ephemeral: true,
      });
    }
  }

  // ====== PAYPAL ======
  if (i.isChatInputCommand() && i.commandName === "paypal") {
    const raw = i.options.getString("betrag");
    const amount = fmtMoney(raw);
    if (amount <= 0)
      return i.reply({ content: "⚠️ Ungültiger Betrag.", ephemeral: true });
    const link = paypalLink(amount);
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("💰 PayPal Zahlung")
      .setDescription(
        `Klicke auf den Button, um **${amount.toFixed(2)}€** zu zahlen.`
      )
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });
    const btn = new ButtonBuilder()
      .setLabel(`Jetzt ${amount.toFixed(2)}€ zahlen`)
      .setStyle(ButtonStyle.Link)
      .setURL(link);
    return i.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(btn)],
    });
  }

  // ====== SHOP ADD/REMOVE/LIST ======
  if (i.isChatInputCommand() && i.commandName === "shop") {
    if (!isTeam(i.member))
      return i.reply({
        content: "🚫 Nur Teammitglieder dürfen das.",
        ephemeral: true,
      });
    const sub = i.options.getSubcommand();
    const shop = loadJSON(FILES.shop);

    if (sub === "add") {
      const name = i.options.getString("name").trim();
      const preis = fmtMoney(i.options.getString("preis"));
      if (shop.find(a => a.name.toLowerCase() === name.toLowerCase()))
        return i.reply({
          content: "⚠️ Artikel existiert bereits.",
          ephemeral: true,
        });
      shop.push({ name, price: preis });
      saveJSON(FILES.shop, shop);
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle("🛍️ Neuer Artikel")
        .setDescription(`**${name}** wurde für **${preis}€** hinzugefügt.`)
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND_FOOTER });
      return i.reply({ embeds: [embed] });
    }

    if (sub === "remove") {
      const name = i.options.getString("name").trim();
      const idx = shop.findIndex(a => a.name.toLowerCase() === name.toLowerCase());
      if (idx === -1)
        return i.reply({ content: "❌ Artikel nicht gefunden.", ephemeral: true });
      const removed = shop.splice(idx, 1)[0];
      saveJSON(FILES.shop, shop);
      const embed = new EmbedBuilder()
        .setColor("#ff4d4d")
        .setTitle("🗑️ Artikel gelöscht")
        .setDescription(`**${removed.name}** wurde entfernt.`)
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND_FOOTER });
      return i.reply({ embeds: [embed] });
    }

    if (sub === "list") {
      if (!shop.length)
        return i.reply({ content: "📭 Sortiment ist leer.", ephemeral: true });
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle("📦 Sortiment")
        .setDescription(
          shop
            .map(a => `• ${a.name} — **${a.price.toFixed(2)}€**`)
            .join("\n")
        )
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND_FOOTER });
      return i.reply({ embeds: [embed] });
    }
  }

  // ====== ORDER SYSTEM ======
  if (i.isChatInputCommand() && i.commandName === "order") {
    const kunde = i.options.getUser("kunde");
    const shop = loadJSON(FILES.shop);
    if (!shop.length)
      return i.reply({
        content: "❌ Kein Artikel im Sortiment. Nutze `/shop add`.",
        ephemeral: true,
      });

    const select = new StringSelectMenuBuilder()
      .setCustomId("order_select")
      .setPlaceholder("Wähle Artikel")
      .setMinValues(1)
      .setMaxValues(Math.min(shop.length, 25))
      .addOptions(
        shop.map(a => ({
          label: a.name,
          value: a.name,
          description: `${a.price.toFixed(2)}€`,
        }))
      );

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`🧾 Bestellung von ${kunde.username}`)
      .setDescription("Bitte wähle unten Artikel aus dem Sortiment.")
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });

    const msg = await i.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select)],
      fetchReply: true,
    });

    const orders = loadJSON(FILES.orders);
    orders.push({
      messageId: msg.id,
      channelId: msg.channel.id,
      guildId: msg.guild.id,
      customerId: kunde.id,
      items: [],
      status: "open",
    });
    saveJSON(FILES.orders, orders);
  }
});
/* =========================================================
   TEIL 2/2 – ADDONS (Order-Buttons, Tickets, Finish/Feedback,
   Giveaways, Creator, Embed, Panel, Nuke, Logging, Re-Register)
========================================================= */

// ---------- Nützliche Helfer vom ersten Teil nutzen ----------
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

// ---------- Komplette Befehlsliste erneut registrieren (alles in einem) ----------
(async () => {
  try {
    const allCommands = [
      // — bereits in Teil 1 enthaltene —
      new SlashCommandBuilder().setName("paypal").setDescription("Erstellt einen PayPal-Link (unterstützt Centbeträge)")
        .addStringOption(o => o.setName("betrag").setDescription("Betrag (z. B. 9.99 oder 9,99)").setRequired(true)),
      new SlashCommandBuilder().setName("verifymsg").setDescription("Sendet die Verify-Nachricht"),
      new SlashCommandBuilder().setName("shop").setDescription("Sortiment verwalten")
        .addSubcommand(s => s.setName("add").setDescription("Artikel hinzufügen")
          .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
          .addStringOption(o => o.setName("preis").setDescription("Preis").setRequired(true)))
        .addSubcommand(s => s.setName("remove").setDescription("Artikel löschen")
          .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true)))
        .addSubcommand(s => s.setName("list").setDescription("Artikel anzeigen")),
      new SlashCommandBuilder().setName("order").setDescription("Erstellt eine Bestellung")
        .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),

      // — neue / zusätzliche —
      new SlashCommandBuilder().setName("panel").setDescription("Sendet das Ticket-Panel (Dropdown)"),
      new SlashCommandBuilder().setName("nuke").setDescription("Löscht viele Nachrichten im aktuellen Channel")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
      new SlashCommandBuilder().setName("creator").setDescription("Creator-System")
        .addSubcommand(s => s.setName("add").setDescription("Erstellt ein Creator-Panel")
          .addStringOption(o => o.setName("titel").setDescription("Titel").setRequired(true))
          .addUserOption(o => o.setName("creator").setDescription("Creator User").setRequired(true))
          .addStringOption(o => o.setName("twitch").setDescription("Twitch Link").setRequired(true))
          .addStringOption(o => o.setName("youtube").setDescription("YouTube Link"))
          .addStringOption(o => o.setName("tiktok").setDescription("TikTok Link"))
          .addStringOption(o => o.setName("instagram").setDescription("Instagram Link"))
          .addStringOption(o => o.setName("code").setDescription("Creator Code"))),
      new SlashCommandBuilder().setName("embed").setDescription("Sende ein eigenes Embed (Modal)"),

      // Giveaways
      new SlashCommandBuilder().setName("giveaway").setDescription("Starte ein neues Giveaway")
        .addStringOption(o => o.setName("preis").setDescription("Preis").setRequired(true))
        .addStringOption(o => o.setName("dauer").setDescription("z. B. 1d, 2h, 30m").setRequired(true))
        .addIntegerOption(o => o.setName("gewinner").setDescription("Anzahl der Gewinner").setRequired(true)),
      new SlashCommandBuilder().setName("reroll").setDescription("Ziehe neue Gewinner")
        .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),
      new SlashCommandBuilder().setName("end").setDescription("Beende ein Giveaway")
        .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),

      // Finish (Tickets/Bestellungen abschließen -> Feedback)
      new SlashCommandBuilder().setName("finish").setDescription("Ticket/Bestellung abschließen (Team only)"),
    ].map(c => c.toJSON());

    await rest.put(
      Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID),
      { body: allCommands }
    );
    console.log("🔁 Alle Commands erneut/komplett registriert.");
  } catch (e) {
    console.error("❌ Re-Register Fehler:", e);
  }
})();

// ---------- /embed (Modal) ----------
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "embed") {
    const modal = new ModalBuilder().setCustomId("custom_embed_modal").setTitle("Embed erstellen");
    const color = new TextInputBuilder().setCustomId("color").setLabel("Farbe (HEX, optional)").setStyle(TextInputStyle.Short).setRequired(false);
    const title = new TextInputBuilder().setCustomId("title").setLabel("Titel").setStyle(TextInputStyle.Short).setRequired(true);
    const desc = new TextInputBuilder().setCustomId("desc").setLabel("Beschreibung (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false);
    const thumb = new TextInputBuilder().setCustomId("thumb").setLabel("Thumbnail URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
    const image = new TextInputBuilder().setCustomId("image").setLabel("Bild URL (optional)").setStyle(TextInputStyle.Short).setRequired(false);
    const footer = new TextInputBuilder().setCustomId("footer").setLabel("Footer (optional)").setStyle(TextInputStyle.Short).setRequired(false);
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

    const embed = new EmbedBuilder()
      .setColor(c)
      .setTitle(t)
      .setImage(im)
      .setFooter({ text: f });
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
      .setDescription(
        "Bitte wähle unten die Art deines Tickets aus:\n\n" +
        "💰 **Shop Ticket** – Käufe & Bestellungen\n" +
        "🎥 **Streamer Bewerbung** – Bewirb dich als Creator\n" +
        "✍️ **Kandar Bewerbung** – Allgemeine Bewerbung\n" +
        "🎨 **Designer Bewerbung** – Für Grafiker\n" +
        "✂️ **Cutter Bewerbung** – Für Videoeditoren\n" +
        "🛠️ **Highteam Anliegen** – Interne Anliegen\n" +
        "👥 **Support Anliegen** – Allgemeiner Support\n"
      )
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

  if (i.isStringSelectMenu() && i.customId === "ticket_select") {
    const choice = i.values[0];
    const map = {
      shop: { title: "💰 Shop Ticket", cat: "💰 Shop Tickets", desc: "Bitte beschreibe deinen Kauf / Wunsch." },
      streamer: { title: "🎥 Streamer Bewerbung", cat: "🎥 Streamer Bewerbungen", desc: "Bitte gib deine Kanäle & Stats an." },
      kandar: { title: "✍️ Kandar Bewerbung", cat: "✍️ Kandar Bewerbungen", desc: "Bitte schreibe deine Bewerbung hier." },
      designer: { title: "🎨 Designer Bewerbung", cat: "🎨 Designer Bewerbungen", desc: "Bitte sende dein Portfolio." },
      cutter: { title: "✂️ Cutter Bewerbung", cat: "✂️ Cutter Bewerbungen", desc: "Bitte nenne Software & Erfahrung." },
      highteam: { title: "🛠️ Highteam Ticket", cat: "🛠️ Highteam Anliegen", desc: "Beschreibe bitte dein Anliegen." },
      support: { title: "👥 Support Ticket", cat: "👥 Support Anliegen", desc: "Beschreibe bitte dein Anliegen." },
    };
    const data = map[choice];
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
      .setDescription(data.desc)
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });

    // Close-Button
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
    try { await i.channel.setLocked(true).catch(() => {}); } catch {}
    try { await i.channel.setArchived?.(true).catch(() => {}); } catch {}
  }
});

// ---------- ORDER: Interaktionen (Buttons/Select/Modals) ----------
client.on("interactionCreate", async i => {
  // Auswahl beim ersten /order (aus Teil 1)
  if (i.isStringSelectMenu() && i.customId === "order_select") {
    const { orders, idx } = getOrderByMsg(i.message.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });

    const order = orders[idx];
    const pick = i.values; // array von Artikelnamen
    // Items ersetzen (neue Auswahl)
    order.items = pick.map(n => ({ name: n, qty: 1 }));
    orders[idx] = order;
    saveJSON(FILES.orders, orders);

    const total = computeTotal(order);
    const desc = order.items.map(x => `• ${x.name} × **${x.qty}**`).join("\n") + `\n\n**Gesamt:** ${total.toFixed(2)}€`;
    const embed = EmbedBuilder.from(i.message.embeds[0]).setDescription(desc);
    await i.message.edit({ embeds: [embed], components: buildOrderButtons(total) });
    return i.deferUpdate();
  }

  // ➕ Artikel hinzufügen (erneute Auswahl)
  if (i.isButton() && i.customId === "order_add") {
    const { orders, idx } = getOrderByMsg(i.message.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
    const shop = loadJSON(FILES.shop);
    const select = new StringSelectMenuBuilder()
      .setCustomId("order_add_select")
      .setPlaceholder("Zusätzliche Artikel wählen")
      .setMinValues(1)
      .setMaxValues(Math.min(shop.length, 25))
      .addOptions(shop.map(a => ({ label: a.name, value: a.name, description: `${a.price.toFixed(2)}€` })));
    return i.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
  }

  if (i.isStringSelectMenu() && i.customId === "order_add_select") {
    const { orders, idx } = getOrderByMsg(i.message.reference?.messageId || i.message.id);
    // Fallback: Suche über letzten Order-Message im Channel
    let msgId = null;
    if (idx === -1) {
      const pinned = (await i.channel.messages.fetch({ limit: 10 })).find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith("🧾 Bestellung"));
      if (!pinned) return i.reply({ content: "❌ Bestellung nicht gefunden.", ephemeral: true });
      msgId = pinned.id;
    } else msgId = orders[idx].messageId;

    const state = getOrderByMsg(msgId);
    if (state.idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
    const order = state.orders[state.idx];
    for (const name of i.values) {
      const existing = order.items.find(x => x.name === name);
      if (existing) existing.qty += 1;
      else order.items.push({ name, qty: 1 });
    }
    state.orders[state.idx] = order;
    saveJSON(FILES.orders, state.orders);
    await i.deleteReply().catch(() => {});
    // Aktualisiere Hauptnachricht
    const fake = { message: await i.channel.messages.fetch(msgId) };
    await updateOrderMessage(fake, order);
  }

  // ➖ Artikel entfernen
  if (i.isButton() && i.customId === "order_remove") {
    const { orders, idx } = getOrderByMsg(i.message.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
    const order = orders[idx];
    if (!order.items.length) return i.reply({ content: "📭 Keine Artikel zum Entfernen.", ephemeral: true });

    const select = new StringSelectMenuBuilder()
      .setCustomId("order_remove_select")
      .setPlaceholder("Artikel zum Entfernen wählen")
      .setMinValues(1)
      .setMaxValues(order.items.length)
      .addOptions(order.items.map(it => ({ label: `${it.name} × ${it.qty}`, value: it.name })));
    return i.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
  }

  if (i.isStringSelectMenu() && i.customId === "order_remove_select") {
    // Finde zugehörige Order-Message (letzte Bot-Order-Embed)
    const pinned = (await i.channel.messages.fetch({ limit: 10 })).find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith("🧾 Bestellung"));
    if (!pinned) return i.reply({ content: "❌ Bestellung nicht gefunden.", ephemeral: true });

    const { orders, idx } = getOrderByMsg(pinned.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
    const order = orders[idx];

    for (const name of i.values) {
      const pos = order.items.findIndex(x => x.name === name);
      if (pos !== -1) {
        if (order.items[pos].qty > 1) order.items[pos].qty -= 1;
        else order.items.splice(pos, 1);
      }
    }
    orders[idx] = order;
    saveJSON(FILES.orders, orders);
    await i.deleteReply().catch(() => {});
    const fake = { message: pinned };
    await updateOrderMessage(fake, order);
  }

  // 🧹 Zurücksetzen
  if (i.isButton() && i.customId === "order_clear") {
    const { orders, idx } = getOrderByMsg(i.message.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
    orders[idx].items = [];
    saveJSON(FILES.orders, orders);
    await updateOrderMessage(i, orders[idx]);
    return i.deferUpdate();
  }

  // 🛠️ Bestellung bearbeiten (Team only) – DM an Kunde + Titel ändern
  if (i.isButton() && i.customId === "order_processing") {
    if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team.", ephemeral: true });
    const { orders, idx } = getOrderByMsg(i.message.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
    const order = orders[idx];
    const customer = await client.users.fetch(order.customerId);

    // DM senden
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor("#f39c12")
        .setTitle("⏳ Deine Bestellung wird bearbeitet")
        .setDescription("Bitte hab einen kleinen Moment Geduld. Unser Team kümmert sich gerade um deine Bestellung. 🙏✨")
        .setImage(BANNER_URL)
        .setFooter({ text: BRAND_FOOTER });
      await customer.send({ embeds: [dmEmbed] });
    } catch {}

    // Titel ändern
    const base = i.message.embeds[0];
    const newEmbed = EmbedBuilder.from(base)
      .setTitle(base.title.replace("🧾 Bestellung", "🧾 Bestellung in Bearbeitung ⏳"));
    await i.message.edit({ embeds: [newEmbed] });
    return i.reply({ content: "🛠️ Status gesetzt: in Bearbeitung.", ephemeral: true });
  }

  // ✅ Bestellung abschließen -> /finish automatisch + Feedback-Knopf
  if (i.isButton() && i.customId === "order_finish") {
    const { orders, idx } = getOrderByMsg(i.message.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });

    // Abschluss
    orders[idx].status = "closed";
    saveJSON(FILES.orders, orders);

    // Customer Rolle vergeben (falls konfiguriert)
    const guild = await client.guilds.fetch(orders[idx].guildId);
    const member = await guild.members.fetch(orders[idx].customerId).catch(() => null);
    const customerRoleId = process.env.CUSTOMER_ROLE_ID;
    if (member && customerRoleId) {
      try { await member.roles.add(customerRoleId); } catch {}
    }

    // Feedback Button
    const feedbackBtn = new ButtonBuilder().setCustomId("feedback_open").setLabel("⭐ Feedback abgeben").setStyle(ButtonStyle.Primary);
    const doneEmbed = new EmbedBuilder()
      .setColor("#2ecc71")
      .setTitle("✅ Bestellung abgeschlossen")
      .setDescription("Danke für deinen Einkauf! Du kannst jetzt Feedback abgeben. 💬✨")
      .setImage(BANNER_URL)
      .setFooter({ text: BRAND_FOOTER });

    await i.reply({ embeds: [doneEmbed], components: [new ActionRowBuilder().addComponents(feedbackBtn)] });

    // /finish Logik (ohne extra Command im Chat) – nur Side-Effect
    // (hier ggf. Logs etc. ergänzen)
  }

  // 🛑 Abbrechen
  if (i.isButton() && i.customId === "order_cancel") {
    const { orders, idx } = getOrderByMsg(i.message.id);
    if (idx === -1) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
    orders.splice(idx, 1);
    saveJSON(FILES.orders, orders);
    await i.message.edit({ components: [] });
    return i.reply({ content: "🛑 Bestellung abgebrochen.", ephemeral: true });
  }
});

// ---------- /finish (Team only) -> Feedback Button anzeigen ----------
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
});

// ---------- Feedback Flow: Button -> Modal -> Verkäufer-Select -> Post ----------
client.on("interactionCreate", async i => {
  if (i.isButton() && i.customId === "feedback_open") {
    const modal = new ModalBuilder().setCustomId("feedback_modal").setTitle("⭐ Feedback abgeben");
    const stars = new TextInputBuilder().setCustomId("stars").setLabel("Sterne (1-5)").setStyle(TextInputStyle.Short).setRequired(true);
    const text = new TextInputBuilder().setCustomId("text").setLabel("Dein Feedback").setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(
      new ActionRowBuilder().addComponents(stars),
      new ActionRowBuilder().addComponents(text)
    );
    return i.showModal(modal);
  }

  if (i.isModalSubmit() && i.customId === "feedback_modal") {
    const stars = Math.max(1, Math.min(5, parseInt(i.fields.getTextInputValue("stars")) || 5));
    const text = i.fields.getTextInputValue("text");

    // Verkäufer-Auswahl via UserSelect (Modals unterstützen keine Selects)
    const sellerSelect = new UserSelectMenuBuilder().setCustomId(`feedback_seller_${stars}_${Buffer.from(text).toString("base64").slice(0, 900)}`).setPlaceholder("Verkäufer auswählen").setMinValues(1).setMaxValues(1);
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
      .setColor("#ff0000") // Rot wie gewünscht
      .setTitle("📝 Neues Feedback eingegangen")
      .setDescription(`${starsEmoji}\n\n${text}\n\n👤 **Verkäufer:** <@${seller.id}>`)
      .setImage(BANNER_URL)
      .setFooter({ text: "Kandar Streaming" });

    if (channel) await channel.send({ embeds: [embed] });
    await i.update({ content: "✅ Danke! Dein Feedback wurde gespeichert.", components: [] });
  }
});

// ---------- /nuke ----------
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand() && i.commandName === "nuke") {
    if (!isTeam(i.member)) return i.reply({ content: "🚫 Nur Team.", ephemeral: true });
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
});

// ---------- GIVEAWAYS ----------
if (!fs.existsSync(FILES.giveaways)) fs.writeFileSync(FILES.giveaways, "[]");

const endGiveaway = async (msgid, interaction = null) => {
  const giveaways = loadJSON(FILES.giveaways);
  const g = giveaways.find(x => x.messageId === msgid);
  if (!g || g.beendet) return;
  g.beendet = true;
  saveJSON(FILES.giveaways, giveaways);

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
};

client.on("ready", async () => {
  // Re-Arm laufender Giveaways (persistiert)
  const giveaways = loadJSON(FILES.giveaways);
  for (const g of giveaways.filter(x => !x.beendet)) {
    const rest = g.endZeit - Date.now();
    if (rest <= 0) endGiveaway(g.messageId).catch(() => {});
    else setTimeout(() => endGiveaway(g.messageId).catch(() => {}), rest);
  }
  console.log(`🎉 Reaktivierte Giveaways: ${giveaways.filter(x => !x.beendet).length}`);
});

client.on("interactionCreate", async i => {
  try {
    if (i.isChatInputCommand() && i.commandName === "giveaway") {
      const preis = i.options.getString("preis");
      const dauerStr = i.options.getString("dauer");
      const gewinner = i.options.getInteger("gewinner");
      const dauer = parseDuration(dauerStr);
      if (!dauer || dauer <= 0) return i.reply({ content: "⚠️ Ungültige Dauer (z. B. 1d2h30m)", ephemeral: true });

      const endZeit = Date.now() + dauer;
      const embed = new EmbedBuilder()
        .setColor("#9B5DE5")
        .setTitle("🎉 Neues Giveaway 🎉")
        .setDescription(`**Preis:** ${preis}\n🎁 **Gewinner:** ${gewinner}\n⏰ **Endet in:** ${dauerStr}\n👥 **Teilnehmer:** 0\n\nKlicke unten, um teilzunehmen!`)
        .setImage(BANNER_URL)
        .setTimestamp(new Date(endZeit))
        .setFooter({ text: "Endet automatisch" });

      const btn = new ButtonBuilder().setCustomId("giveaway_join").setLabel("Teilnehmen 🎉").setStyle(ButtonStyle.Primary);
      const msg = await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)], fetchReply: true });

      const giveaways = loadJSON(FILES.giveaways);
      giveaways.push({ messageId: msg.id, channelId: msg.channel.id, guildId: msg.guild.id, preis, endZeit, gewinner, teilnehmer: [], beendet: false });
      saveJSON(FILES.giveaways, giveaways);
      setTimeout(() => endGiveaway(msg.id), dauer);
    }

    if (i.isButton() && i.customId === "giveaway_join") {
      const giveaways = loadJSON(FILES.giveaways);
      const g = giveaways.find(x => x.messageId === i.message.id);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (g.beendet) return i.reply({ content: "🚫 Beendet!", ephemeral: true });
      if (g.teilnehmer.includes(i.user.id)) return i.reply({ content: "⚠️ Du bist bereits dabei!", ephemeral: true });

      g.teilnehmer.push(i.user.id);
      saveJSON(FILES.giveaways, giveaways);

      // Embed Teilnehmer-Anzahl updaten
      const base = i.message.embeds[0];
      const updated = EmbedBuilder.from(base).setDescription(
        base.description.replace(/👥 \*\*Teilnehmer:\*\* \d+/, `👥 **Teilnehmer:** ${g.teilnehmer.length}`)
      );
      await i.message.edit({ embeds: [updated] });

      return i.reply({ content: "✅ Teilnahme gespeichert!", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "reroll") {
      const msgid = i.options.getString("msgid");
      const g = loadJSON(FILES.giveaways).find(x => x.messageId === msgid);
      if (!g) return i.reply({ content: "❌ Giveaway nicht gefunden!", ephemeral: true });
      if (!g.teilnehmer.length) return i.reply({ content: "😢 Keine Teilnehmer!", ephemeral: true });
      const winners = Array.from({ length: g.gewinner }, () => `<@${g.teilnehmer[Math.floor(Math.random() * g.teilnehmer.length)]}>`);
      i.reply(`🔁 Neue Gewinner für **${g.preis}**: ${winners.join(", ")}`);
    }

    if (i.isChatInputCommand() && i.commandName === "end") {
      await endGiveaway(i.options.getString("msgid"), i);
    }
  } catch (err) {
    console.error("❌ Giveaway Fehler:", err);
  }
});

// ---------- Logging ----------
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
client.on("messageDelete", msg => {
  if (!msg.guild || msg.author?.bot) return;
  const log = msg.guild.channels.cache.get(process.env.MESSAGE_LOGS_CHANNEL_ID);
  if (log)
    log.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑 Nachricht gelöscht").setDescription(`Von ${msg.author}\nIn ${msg.channel}\n\n${msg.content || "[Embed/Datei]"}`)] });
});
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
