// ========================================================
//  Kandar Community Bot – All-in-One Index (Teil 1 / 2)
// ========================================================

import {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionFlagsBits,
  ChannelType, StringSelectMenuBuilder, UserSelectMenuBuilder
} from "discord.js";
import fs from "fs";
import "dotenv/config";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences,
  ],
});

// ---------- Basis-Setup ----------
if (!fs.existsSync("./data")) fs.mkdirSync("./data");
const FILES = {
  giveaways: "./data/giveaways.json",
  creators: "./data/creators.json",
  orders: "./data/orders.json",
  shop: "./data/shop.json"
};
for (const f of Object.values(FILES))
  if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");

const BRAND_COLOR = "#00FF88";
const BRAND_FOOTER = "Kandar Shop";
const BANNER_URL = "https://cdn.discordapp.com/attachments/1413564981777141981/1431085432690704495/kandar_banner.gif";
const loadJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const saveJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));
const isTeam = (m) => {
  const ids = (process.env.TEAM_ROLE_IDS || "").split(",").map(x => x.trim());
  return m.roles.cache.some(r => ids.includes(r.id));
};
const paypalLink = (amt) => `https://www.paypal.com/paypalme/${process.env.PAYPAL_ME}/${amt}`;

// ---------- Slash-Commands ----------
const cmds = [
  new SlashCommandBuilder()
    .setName("paypal").setDescription("Erstellt einen PayPal-Link")
    .addNumberOption(o => o.setName("betrag").setDescription("Betrag (auch Cent)").setRequired(true)),
  new SlashCommandBuilder()
    .setName("panel").setDescription("Sendet das Ticket-Panel"),
  new SlashCommandBuilder()
    .setName("verifymsg").setDescription("Sendet die Verify-Nachricht"),
  new SlashCommandBuilder()
    .setName("nuke").setDescription("Löscht alle Nachrichten im Channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder()
    .setName("creator").setDescription("Creator verwalten")
    .addSubcommand(s => s.setName("add").setDescription("Creator-Embed hinzufügen")
      .addStringOption(o => o.setName("titel").setDescription("Titel").setRequired(true))
      .addUserOption(o => o.setName("creator").setDescription("User").setRequired(true))
      .addStringOption(o => o.setName("twitch").setDescription("Twitch-Link").setRequired(true))
      .addStringOption(o => o.setName("youtube").setDescription("YouTube").setRequired(false))
      .addStringOption(o => o.setName("tiktok").setDescription("TikTok").setRequired(false))
      .addStringOption(o => o.setName("instagram").setDescription("Instagram").setRequired(false))
      .addStringOption(o => o.setName("code").setDescription("Creator-Code").setRequired(false))),
  new SlashCommandBuilder()
    .setName("shop").setDescription("Shop-System")
    .addSubcommand(s => s.setName("add").setDescription("Artikel hinzufügen")
      .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true))
      .addNumberOption(o => o.setName("preis").setDescription("Preis").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Artikel löschen")
      .addStringOption(o => o.setName("name").setDescription("Artikelname").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("Zeigt alle Artikel")),
  new SlashCommandBuilder()
    .setName("order").setDescription("Neue Bestellung starten")
    .addUserOption(o => o.setName("kunde").setDescription("Kunde").setRequired(true)),
  new SlashCommandBuilder()
    .setName("finish").setDescription("Ticket/Bestellung abschließen (Team)"),
  new SlashCommandBuilder()
    .setName("embed").setDescription("Eigenes Embed über Modal erstellen"),
  new SlashCommandBuilder()
    .setName("giveaway").setDescription("Starte ein Giveaway")
    .addStringOption(o => o.setName("preis").setDescription("Preis").setRequired(true))
    .addStringOption(o => o.setName("dauer").setDescription("z.B. 1d 2h 30m").setRequired(true))
    .addIntegerOption(o => o.setName("gewinner").setDescription("Anzahl Gewinner").setRequired(true)),
  new SlashCommandBuilder()
    .setName("reroll").setDescription("Neue Gewinner ziehen")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),
  new SlashCommandBuilder()
    .setName("end").setDescription("Giveaway beenden")
    .addStringOption(o => o.setName("msgid").setDescription("Nachrichten-ID").setRequired(true)),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID),
      { body: cmds }
    );
    console.log("✅ Slash-Commands registriert");
  } catch (e) { console.error("❌ Register-Fehler:", e); }
})();

// ---------- Utility ----------
function parseDuration(s) {
  const r = /(\d+d)?(\d+h)?(\d+m)?/;
  const m = s.match(r);
  let ms = 0;
  if (m[1]) ms += parseInt(m[1]) * 864e5;
  if (m[2]) ms += parseInt(m[2]) * 36e5;
  if (m[3]) ms += parseInt(m[3]) * 6e4;
  return ms;
}

// ---------- READY ----------
client.once("ready", async () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);

  // Server-Stats-Kategorie
  const g = client.guilds.cache.get(process.env.GUILD_ID);
  if (!g) return;
  const catName = "📊 Server Stats";
  let cat = g.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
  if (!cat) cat = await g.channels.create({ name: catName, type: ChannelType.GuildCategory });
  const labels = { m: "🧍 Mitglieder", o: "💻 Online", b: "🤖 Bots", s: "💎 Boosts" };
  for (const l of Object.values(labels))
    if (!g.channels.cache.find(c => c.parentId === cat.id && c.name.startsWith(l)))
      await g.channels.create({ name: `${l}: 0`, type: ChannelType.GuildVoice, parent: cat.id,
        permissionOverwrites: [{ id: g.roles.everyone.id, deny: [PermissionFlagsBits.Connect] }] });

  const update = async () => {
    const mem = g.members.cache;
    const online = mem.filter(m => m.presence && m.presence.status !== "offline").size;
    const bots = mem.filter(m => m.user.bot).size;
    const humans = mem.size - bots;
    const boosts = g.premiumSubscriptionCount || 0;
    const ch = {
      m: g.channels.cache.find(c => c.name.startsWith(labels.m)),
      o: g.channels.cache.find(c => c.name.startsWith(labels.o)),
      b: g.channels.cache.find(c => c.name.startsWith(labels.b)),
      s: g.channels.cache.find(c => c.name.startsWith(labels.s)),
    };
    if (ch.m) ch.m.setName(`${labels.m}: ${humans}`);
    if (ch.o) ch.o.setName(`${labels.o}: ${online}`);
    if (ch.b) ch.b.setName(`${labels.b}: ${bots}`);
    if (ch.s) ch.s.setName(`${labels.s}: ${boosts}`);
  };
  update(); setInterval(update, 300000);
});

// ---------- Welcome / Booster ----------
client.on("guildMemberAdd", m => {
  const c = m.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
  if (!c) return;
  const e = new EmbedBuilder()
    .setColor("#00FF00").setTitle("👋 Willkommen!").setDescription(`Willkommen ${m}!`)
    .setImage(BANNER_URL).setThumbnail(m.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: BRAND_FOOTER });
  c.send({ embeds: [e] });
});
client.on("guildMemberUpdate", (o, n) => {
  if (o.premiumSince !== n.premiumSince && n.premiumSince) {
    const c = n.guild.channels.cache.get(process.env.BOOSTER_CHANNEL_ID);
    if (!c) return;
    const e = new EmbedBuilder().setColor("#FF00FF").setTitle("💎 Neuer Boost!").setDescription(`Danke ${n} für den Serverboost!`)
      .setImage(BANNER_URL).setFooter({ text: BRAND_FOOTER });
    c.send({ embeds: [e] });
  }
});
// ========================================================
//  Kandar Community Bot – All-in-One Index (Teil 2 / 2)
// ========================================================

client.on("interactionCreate", async (i) => {
  try {
    // ---------- VERIFY ----------
    if (i.isChatInputCommand() && i.commandName === "verifymsg") {
      const e = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("✅ Verifizierung")
        .setDescription("Drücke unten auf **Verifizieren**, um Zugriff auf den Server zu erhalten!")
        .setImage(BANNER_URL);
      const b = new ButtonBuilder().setCustomId("verify").setLabel("Verifizieren").setStyle(ButtonStyle.Success);
      return i.reply({ embeds: [e], components: [new ActionRowBuilder().addComponents(b)] });
    }
    if (i.isButton() && i.customId === "verify") {
      const r = i.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
      if (!r) return i.reply({ content: "❌ Verify-Rolle nicht gefunden!", ephemeral: true });
      try { await i.member.roles.add(r); } 
      catch { return i.reply({ content: "⚠️ Konnte Rolle nicht hinzufügen – prüfe Rechte.", ephemeral: true }); }
      return i.reply({ content: "🎉 Du bist jetzt verifiziert!", ephemeral: true });
    }

    // ---------- PAYPAL ----------
    if (i.isChatInputCommand() && i.commandName === "paypal") {
      const betrag = i.options.getNumber("betrag");
      const e = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("💰 PayPal Zahlung")
        .setDescription(`Klicke auf den Button, um **${betrag.toFixed(2)} €** zu zahlen.`)
        .setFooter({ text: BRAND_FOOTER });
      const b = new ButtonBuilder()
        .setLabel(`Jetzt ${betrag.toFixed(2)} € zahlen`)
        .setStyle(ButtonStyle.Link)
        .setURL(paypalLink(betrag));
      return i.reply({ embeds: [e], components: [new ActionRowBuilder().addComponents(b)] });
    }

    // ---------- SHOP ----------
    if (i.isChatInputCommand() && i.commandName === "shop") {
      if (!isTeam(i.member))
        return i.reply({ content: "🚫 Nur Teammitglieder dürfen das.", ephemeral: true });

      const sub = i.options.getSubcommand(false);
      const shop = loadJSON(FILES.shop);

      if (!sub) {
        const e = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle("🛍️ Shop-Befehle")
          .setDescription("• `/shop add` – Artikel hinzufügen 🆕\n• `/shop remove` – Artikel löschen ❌\n• `/shop list` – Alle Artikel anzeigen 📦")
          .setImage(BANNER_URL);
        return i.reply({ embeds: [e], ephemeral: true });
      }

      if (sub === "add") {
        const name = i.options.getString("name");
        const preis = i.options.getNumber("preis");
        if (shop.find(x => x.name === name))
          return i.reply({ content: "⚠️ Artikel existiert bereits.", ephemeral: true });
        shop.push({ name, preis });
        saveJSON(FILES.shop, shop);
        return i.reply({ content: `✅ Artikel **${name}** für **${preis} €** hinzugefügt.`, ephemeral: true });
      }

      if (sub === "remove") {
        const name = i.options.getString("name");
        const idx = shop.findIndex(x => x.name === name);
        if (idx === -1) return i.reply({ content: "❌ Artikel nicht gefunden.", ephemeral: true });
        shop.splice(idx, 1); saveJSON(FILES.shop, shop);
        return i.reply({ content: `🗑️ Artikel **${name}** gelöscht.`, ephemeral: true });
      }

      if (sub === "list") {
        if (!shop.length) return i.reply({ content: "📭 Keine Artikel im Shop.", ephemeral: true });
        const e = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle("🛒 Kandar Shop – Sortiment")
          .setDescription(shop.map(p => `• **${p.name}** – ${p.preis.toFixed(2)} €`).join("\n"))
          .setImage(BANNER_URL);
        return i.reply({ embeds: [e], ephemeral: true });
      }
    }

    // ---------- ORDER ----------
    if (i.isChatInputCommand() && i.commandName === "order") {
      const kunde = i.options.getUser("kunde");
      const shop = loadJSON(FILES.shop);
      if (!shop.length) return i.reply({ content: "❌ Keine Artikel im Shop.", ephemeral: true });

      const e = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`🧾 Bestellung von ${kunde.username}`)
        .setDescription("Aktuelle Artikel:\n*(noch keine)*")
        .setFooter({ text: BRAND_FOOTER }).setImage(BANNER_URL);

      const add = new ButtonBuilder().setCustomId("order_add").setLabel("➕ Artikel hinzufügen").setStyle(ButtonStyle.Success);
      const rem = new ButtonBuilder().setCustomId("order_remove").setLabel("➖ Artikel entfernen").setStyle(ButtonStyle.Secondary);
      const done = new ButtonBuilder().setCustomId("order_done").setLabel("✅ Bestellung abschließen").setStyle(ButtonStyle.Primary);
      const pay = new ButtonBuilder().setLabel("💳 Bezahlen").setStyle(ButtonStyle.Link).setURL(paypalLink(0));

      const msg = await i.reply({
        embeds: [e],
        components: [new ActionRowBuilder().addComponents(add, rem, done, pay)],
        fetchReply: true
      });

      const orders = loadJSON(FILES.orders);
      orders.push({ msgId: msg.id, channelId: msg.channel.id, kundeId: kunde.id, items: [] });
      saveJSON(FILES.orders, orders);
    }

    // ---------- ORDER Buttons ----------
    if (i.isButton() && i.customId.startsWith("order_")) {
      const orders = loadJSON(FILES.orders);
      const o = orders.find(x => x.msgId === i.message.id);
      if (!o) return i.reply({ content: "❌ Bestellung nicht mehr aktiv.", ephemeral: true });
      const shop = loadJSON(FILES.shop);

      if (i.customId === "order_add") {
        const modal = new ModalBuilder().setCustomId("order_add_modal").setTitle("➕ Artikel hinzufügen");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId("order_article")
              .setPlaceholder("Wähle einen Artikel")
              .addOptions(shop.map(p => ({ label: `${p.name} – ${p.preis.toFixed(2)} €`, value: p.name })))
          )
        );
        return i.showModal(modal);
      }

      if (i.customId === "order_remove") {
        if (!o.items.length)
          return i.reply({ content: "⚠️ Keine Artikel in der Bestellung.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId("order_remove_modal").setTitle("➖ Artikel entfernen");
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId("order_remove_select")
              .addOptions(o.items.map(p => ({ label: p.name, value: p.name })))
          )
        );
        return i.showModal(modal);
      }

      if (i.customId === "order_done") {
        const total = o.items.reduce((a, b) => a + b.preis, 0);
        const ch = i.guild.channels.cache.get(o.channelId);
        const e = EmbedBuilder.from(i.message.embeds[0])
          .setTitle(`🧾 Bestellung von <@${o.kundeId}> – ✅ Abgeschlossen`)
          .setDescription(o.items.map(p => `• ${p.name} – ${p.preis.toFixed(2)} €`).join("\n") + `\n\n💰 **Gesamt:** ${total.toFixed(2)} €`)
          .setColor("#00FF00");
        await i.message.edit({ embeds: [e], components: [] });
        await ch.send(`💬 <@${o.kundeId}> Deine Bestellung wurde abgeschlossen!`);
        orders.splice(orders.indexOf(o), 1); saveJSON(FILES.orders, orders);
        return;
      }
    }

    // ---------- CREATOR ----------
    if (i.isChatInputCommand() && i.commandName === "creator") {
      const t = i.options.getString("titel");
      const u = i.options.getUser("creator");
      const twitch = i.options.getString("twitch");
      const yt = i.options.getString("youtube") || "";
      const tk = i.options.getString("tiktok") || "";
      const ig = i.options.getString("instagram") || "";
      const code = i.options.getString("code") || "";

      const e = new EmbedBuilder().setColor("#9b5de5").setTitle(t)
        .addFields({ name: "Twitch", value: twitch });
      if (yt) e.addFields({ name: "YouTube", value: yt });
      if (tk) e.addFields({ name: "TikTok", value: tk });
      if (ig) e.addFields({ name: "Instagram", value: ig });
      if (code) e.addFields({ name: "Creator Code", value: code });
      e.setFooter({ text: BRAND_FOOTER }).setImage(BANNER_URL);

      await i.reply({ embeds: [e] });
    }

    // ---------- EMBED ----------
    if (i.isChatInputCommand() && i.commandName === "embed") {
      const m = new ModalBuilder().setCustomId("embedModal").setTitle("Embed erstellen");
      const f = (id, lbl, req = false) =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(id).setLabel(lbl).setStyle(TextInputStyle.Short).setRequired(req)
        );
      m.addComponents(
        f("color", "Farbe (z. B. #FF0000)"),
        f("title", "Titel", true),
        f("footer", "Footer"),
        f("thumb", "Thumbnail URL"),
        f("image", "Bild URL")
      );
      return i.showModal(m);
    }

    if (i.isModalSubmit() && i.customId === "embedModal") {
      const e = new EmbedBuilder()
        .setColor(i.fields.getTextInputValue("color") || BRAND_COLOR)
        .setTitle(i.fields.getTextInputValue("title"))
        .setFooter({ text: i.fields.getTextInputValue("footer") || BRAND_FOOTER })
        .setImage(i.fields.getTextInputValue("image") || null)
        .setThumbnail(i.fields.getTextInputValue("thumb") || null);
      await i.reply({ embeds: [e] });
    }

  } catch (err) { console.error("❌ Interaction Error:", err); }
});

// ---------- Logging ----------
client.on("guildMemberAdd", m => {
  const c = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (c) c.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("👋 Mitglied beigetreten").setDescription(`${m}`)] });
});
client.on("guildMemberRemove", m => {
  const c = m.guild.channels.cache.get(process.env.MEMBER_LOGS_CHANNEL_ID);
  if (c) c.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🚪 Mitglied verlassen").setDescription(`${m.user.tag}`)] });
});
client.on("messageDelete", msg => {
  if (!msg.guild || msg.author?.bot) return;
  const c = msg.guild.channels.cache.get(process.env.MESSAGE_LOGS_CHANNEL_ID);
  if (c) c.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑️ Nachricht gelöscht").setDescription(`Von ${msg.author}\n${msg.content}`)] });
});
client.on("channelCreate", ch => {
  const c = ch.guild.channels.cache.get(process.env.CHANNEL_LOGS_CHANNEL_ID);
  if (c) c.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("📢 Channel erstellt").setDescription(ch.name)] });
});
client.on("channelDelete", ch => {
  const c = ch.guild.channels.cache.get(process.env.CHANNEL_LOGS_CHANNEL_ID);
  if (c) c.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🗑️ Channel gelöscht").setDescription(ch.name)] });
});
client.on("roleCreate", r => {
  const c = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (c) c.send({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle("🎭 Rolle erstellt").setDescription(r.name)] });
});
client.on("roleDelete", r => {
  const c = r.guild.channels.cache.get(process.env.ROLE_LOGS_CHANNEL_ID);
  if (c) c.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setTitle("🎭 Rolle gelöscht").setDescription(r.name)] });
});
client.on("voiceStateUpdate", (o, n) => {
  const c = n.guild.channels.cache.get(process.env.VOICE_LOGS_CHANNEL_ID);
  if (!c) return;
  let t = "";
  const u = n.member.user;
  if (!o.channel && n.channel) t = `🎙️ ${u} ist ${n.channel.name} beigetreten.`;
  else if (o.channel && !n.channel) t = `🔇 ${u} hat ${o.channel.name} verlassen.`;
  else if (o.channelId !== n.channelId) t = `🔁 ${u} wechselte ${o.channel.name} → ${n.channel.name}.`;
  if (t) c.send({ embeds: [new EmbedBuilder().setColor("#00A8FF").setTitle("🔊 Voice Log").setDescription(t)] });
});

// ---------- Login ----------
client.login(process.env.DISCORD_TOKEN);
console.log("🚀 Bot gestartet – Kandar Community");
