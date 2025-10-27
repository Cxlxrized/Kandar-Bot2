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
  StringSelectMenuBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import express from 'express';

// =============================
// EXPRESS: Keep-Alive (Railway)
// =============================
const app = express();
app.get('/', (_, res) => res.send('✅ Bot läuft auf Railway!'));
app.listen(process.env.PORT || 3000, () => console.log('🌍 Webserver läuft'));

// =============================
// DISCORD CLIENT
// =============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// =============================
// HILFSFUNKTIONEN & STATE
// =============================

// 1d / 2h / 30m oder Sekunden (als Zahl)
function parseDuration(str) {
  if (!str) return 0;
  const s = String(str).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 1000;
  const m = s.match(/^(\d+)\s*([dhm])$/i);
  if (!m) return 0;
  const v = parseInt(m[1], 10);
  const u = m[2];
  if (u === 'd') return v * 24 * 60 * 60 * 1000;
  if (u === 'h') return v * 60 * 60 * 1000;
  if (u === 'm') return v * 60 * 1000;
  return 0;
}

const ordersMap = new Map();   // userId -> { items: [], messageId }
const giveaways = new Map();   // msgId -> { entrants:Set<userId>, winners, prize, timeoutId }

// =============================
// SLASH COMMANDS DEFINIEREN
// =============================
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Antwortet mit Pong!'),

  new SlashCommandBuilder().setName('serverstats').setDescription('Aktualisiert Serverstatistik'),

  new SlashCommandBuilder()
    .setName('paypal')
    .setDescription('Erstellt einen PayPal-Zahlungslink')
    .addNumberOption(o => o.setName('betrag').setDescription('Betrag in Euro').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ticketmsg')
    .setDescription('Sendet Ticket-Auswahl'),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Sendet Regelwerk & Verify-Button'),

  new SlashCommandBuilder()
    .setName('order')
    .setDescription('Starte eine Bestellung (nur bestimmte Rollen)')
    .addStringOption(o => o.setName('artikel').setDescription('Erster Artikel').setRequired(true)),

  new SlashCommandBuilder()
    .setName('finish')
    .setDescription('Bestellung abschließen – Kunde gibt Feedback (nur bestimmte Rollen)')
    .addUserOption(o => o.setName('kunde').setDescription('Kunde').setRequired(true)),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway verwalten')
    .addSubcommand(s =>
      s.setName('start')
        .setDescription('Starte ein Giveaway')
        .addStringOption(o => o.setName('dauer').setDescription('z.B. 1d, 2h, 30m oder Sekunden').setRequired(true))
        .addIntegerOption(o => o.setName('gewinner').setDescription('Anzahl Gewinner').setRequired(true))
        .addStringOption(o => o.setName('preis').setDescription('Preis').setRequired(true))
        .addChannelOption(o => o.setName('kanal').setDescription('Zielkanal').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('reroll')
        .setDescription('Ziehe neue Gewinner')
        .addStringOption(o => o.setName('message_id').setDescription('Nachrichten-ID des Giveaways').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('delete')
        .setDescription('Stoppe Giveaway (in-memory)')
        .addStringOption(o => o.setName('message_id').setDescription('Nachrichten-ID des Giveaways').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Leert den aktuellen Channel (nur bestimmte Rollen)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
].map(c => c.toJSON());

// =============================
// SLASH COMMANDS REGISTRIEREN
// =============================
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    console.log('🔄 Registriere Slash Commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash Commands registriert!');
  } catch (err) {
    console.error('❌ Fehler beim Registrieren:', err);
  }
})();

// =============================
// SERVERSTATS
// =============================
async function updateStats(guild) {
  try {
    let ch = guild.channels.cache.find(c => c.name.startsWith('👥 Mitglieder'));
    if (!ch) {
      await guild.channels.create({
        name: `👥 Mitglieder: ${guild.memberCount}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [{ id: guild.roles.everyone, deny: ['Connect'] }],
      });
    } else {
      await ch.setName(`👥 Mitglieder: ${guild.memberCount}`);
    }
    console.log('✅ Serverstats aktualisiert');
  } catch (e) {
    console.error('Serverstats Fehler:', e);
  }
}

// =============================
// READY
// =============================
client.once('ready', () => {
  console.log(`🤖 Eingeloggt als ${client.user.tag}`);
  client.guilds.cache.forEach(g => updateStats(g));
});

// =============================
// INTERACTION HANDLER
// =============================
client.on('interactionCreate', async i => {
  try {
    // /ping
    if (i.isChatInputCommand() && i.commandName === 'ping')
      return i.reply('🏓 Pong!');

    // /serverstats
    if (i.isChatInputCommand() && i.commandName === 'serverstats') {
      await updateStats(i.guild);
      return i.reply({ content: '✅ Stats aktualisiert!', flags: 64 });
    }

    // /paypal
    if (i.isChatInputCommand() && i.commandName === 'paypal') {
      const roles = process.env.PAYPAL_ROLES?.split(',') || [];
      if (roles.length && !roles.some(r => i.member.roles.cache.has(r)))
        return i.reply({ content: '❌ Keine Berechtigung.', flags: 64 });

      const amount = i.options.getNumber('betrag');
      if (!amount || amount <= 0)
        return i.reply({ content: '⚠️ Ungültiger Betrag!', flags: 64 });

      const embed = new EmbedBuilder()
        .setTitle('💳 PayPal Zahlung')
        .setDescription(`Klicke unten, um **${amount}€** zu bezahlen.`)
        .setColor('#0099ff')
        .setImage('https://cdn.discordapp.com/attachments/1310294304280719441/1310313363142371368/paypal-banner.png')
        .setTimestamp();

      const button = new ButtonBuilder()
        .setLabel(`Jetzt ${amount}€ zahlen`)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.paypal.com/paypalme/jonahborospreitzer/${amount}`);

      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    // /ticketmsg
    if (i.isChatInputCommand() && i.commandName === 'ticketmsg') {
      const roles = process.env.TICKETMSG_ROLES?.split(',') || [];
      if (roles.length && !roles.some(r => i.member.roles.cache.has(r)))
        return i.reply({ content: '❌ Keine Berechtigung.', flags: 64 });

      const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket erstellen')
        .setDescription(
          'Bitte wähle die Ticket-Art unten aus:\n\n' +
          '💰 **Shop** – Für Käufe\n' +
          '✍️ **Kandar Bewerbung** – Bewerbung für Kandar\n' +
          '🎨 **Designer Bewerbung** – Bewerbung für Designer\n' +
          '✂️ **Cutter Bewerbung** – Bewerbung für Cutter\n' +
          '🛠️ **Support** – Allgemeine Hilfe'
        )
        .setColor('#00ff00');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('ticketSelect')
        .setPlaceholder('Ticket auswählen')
        .addOptions(
          { label: 'Shop', value: 'shop', emoji: '💰' },
          { label: 'Kandar Bewerbung', value: 'kandar', emoji: '✍️' },
          { label: 'Designer Bewerbung', value: 'designer', emoji: '🎨' },
          { label: 'Cutter Bewerbung', value: 'cutter', emoji: '✂️' },
          { label: 'Support', value: 'support', emoji: '🛠️' },
        );

      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // Ticket erstellen
    if (i.isStringSelectMenu() && i.customId === 'ticketSelect') {
      const map = {
        shop: 'Shop Tickets',
        kandar: 'Kandar Bewerbungen',
        designer: 'Designer Bewerbungen',
        cutter: 'Cutter Bewerbungen',
        support: 'Support Tickets',
      };
      const choice = i.values[0];
      const catName = map[choice];
      const guild = i.guild;

      let cat = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
      if (!cat) cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });

      const ch = await guild.channels.create({
        name: `${choice}-${i.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: cat.id,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: ['ViewChannel'] },
          { id: i.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        ],
      });

      const embed = new EmbedBuilder()
        .setTitle(`🎫 ${choice} Ticket`)
        .setDescription(`Hallo ${i.user}, bitte schildere dein Anliegen.`)
        .setColor('#00ff00');

      const btn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Ticket schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒');

      await ch.send({ content: `${i.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
      return i.reply({ content: `✅ Ticket erstellt: ${ch}`, flags: 64 });
    }

    // Ticket schließen
    if (i.isButton() && i.customId === 'close_ticket') {
      const confirm = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel('✅ Schließen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel('❌ Abbrechen').setStyle(ButtonStyle.Secondary),
      );
      return i.reply({ content: 'Sicher schließen?', components: [confirm] });
    }

    if (i.isButton() && i.customId === 'cancel_close_ticket') {
      return i.update({ content: '❌ Abgebrochen.', components: [] });
    }

    if (i.isButton() && i.customId === 'confirm_close_ticket') {
      try {
        const msgs = await i.channel.messages.fetch({ limit: 100 });
        const transcript = msgs
          .map(m => `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author?.tag || 'Unbekannt'}: ${m.content || '[leer/Anhang]'} `)
          .reverse()
          .join('\n');

        const path = `./transcript_${i.channel.id}.txt`;
        fs.writeFileSync(path, transcript, 'utf8');

        await i.reply('📁 Ticket wird geschlossen...');
        const log = i.guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID);
        if (log) await log.send({ content: `Ticket **${i.channel.name}** geschlossen von ${i.user}`, files: [path] });

        setTimeout(async () => {
          try { fs.unlinkSync(path); } catch {}
          await i.channel.delete().catch(() => {});
        }, 3000);
      } catch (e) {
        console.error('Transkript Fehler:', e);
        await i.reply({ content: '❌ Fehler beim Erstellen des Transkripts!', flags: 64 });
      }
    }

    // /verify
    if (i.isChatInputCommand() && i.commandName === 'verify') {
      const channel = i.guild.channels.cache.get(process.env.VERIFY_CHANNEL_ID);
      const roleId = process.env.VERIFY_ROLE_ID;
      if (!channel || !roleId)
        return i.reply({ content: '❌ VERIFY_CHANNEL_ID oder VERIFY_ROLE_ID fehlt/ungültig.', flags: 64 });

      const embed = new EmbedBuilder()
        .setTitle('📜 Regelwerk')
        .setColor('#00ff00')
        .setDescription(
          '§ 1: Umgang – Freundlich & respektvoll.\n' +
          '§ 2: Anweisungen – Folge Teammitgliedern.\n' +
          '§ 3: Pingen – Kein Spam.\n' +
          '§ 4: Leaking – Keine Datenweitergabe.\n' +
          '§ 5: Spam – Verboten.\n' +
          '§ 6: Channels – Richtige Nutzung.\n' +
          '§ 7: Letztes Wort – Team entscheidet.\n' +
          '§ 8: Beleidigungen – Streng verboten.\n' +
          '§ 10: Werbung – Keine Fremdserver.\n' +
          '§ 11: NSFW – Verboten.\n' +
          '§ 12: Drohung/Erpressung – Verboten.\n' +
          '§ 13: Bots/Raids – Verboten.\n' +
          '§ 14: Discord-ToS gelten.'
        );

      const btn = new ButtonBuilder().setCustomId('verify_role').setLabel('✅ Verifizieren').setStyle(ButtonStyle.Success);
      await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
      return i.reply({ content: '✅ Verify-Embed gesendet!', flags: 64 });
    }

    // Verify Button: Rolle geben
    if (i.isButton() && i.customId === 'verify_role') {
      const role = i.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
      if (!role) return i.reply({ content: '❌ Verify-Rolle nicht gefunden.', flags: 64 });
      await i.member.roles.add(role).catch(() => {});
      return i.reply({ content: '✅ Verifiziert!', flags: 64 });
    }

    // /order
    if (i.isChatInputCommand() && i.commandName === 'order') {
      const roles = process.env.ORDER_ROLES?.split(',') || [];
      if (roles.length && !roles.some(r => i.member.roles.cache.has(r)))
        return i.reply({ content: '❌ Keine Berechtigung.', flags: 64 });

      const item = i.options.getString('artikel');
      const entry = ordersMap.get(i.user.id) || { items: [] };
      entry.items.push(item);

      const embed = new EmbedBuilder()
        .setTitle(`🛒 Bestellung von ${i.user.username}`)
        .setDescription(entry.items.map((v, idx) => `**${idx + 1}.** ${v}`).join('\n'))
        .setColor('#00A8FF');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('order-menu')
        .setPlaceholder('Aktion auswählen')
        .addOptions(
          { label: 'Artikel hinzufügen', value: 'add', description: 'Weiteren Artikel hinzufügen' },
          { label: 'Abschließen', value: 'finish', description: 'Bestellung abschließen' },
        );

      const msg = await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], fetchReply: true });
      entry.messageId = msg.id;
      ordersMap.set(i.user.id, entry);
      return;
    }

    // Order Menü
    if (i.isStringSelectMenu() && i.customId === 'order-menu') {
      const entry = ordersMap.get(i.user.id);
      if (!entry) return i.reply({ content: '❌ Keine Bestellung gefunden.', flags: 64 });

      if (i.values[0] === 'add') {
        const modal = new ModalBuilder().setCustomId('order-modal').setTitle('Artikel hinzufügen');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('order-item').setLabel('Artikel').setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
      } else {
        ordersMap.delete(i.user.id);

        // optional Kunde-Rolle
        const roleId = process.env.CUSTOMER_ROLE_ID;
        if (roleId) {
          const role = i.guild.roles.cache.get(roleId);
          if (role) await i.member.roles.add(role).catch(() => {});
        }

        const embed = new EmbedBuilder().setTitle('✅ Bestellung abgeschlossen').setDescription('Danke! Deine Bestellung wurde übermittelt.').setColor('#00ff88');
        return i.update({ embeds: [embed], components: [] });
      }
    }

    // Order Modal submit
    if (i.isModalSubmit() && i.customId === 'order-modal') {
      const entry = ordersMap.get(i.user.id);
      if (!entry) return i.reply({ content: '❌ Keine Bestellung gefunden.', flags: 64 });

      const newItem = i.fields.getTextInputValue('order-item');
      entry.items.push(newItem);

      const embed = new EmbedBuilder()
        .setTitle(`🛒 Bestellung von ${i.user.username}`)
        .setDescription(entry.items.map((v, idx) => `**${idx + 1}.** ${v}`).join('\n'))
        .setColor('#00A8FF');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('order-menu')
        .addOptions(
          { label: 'Artikel hinzufügen', value: 'add' },
          { label: 'Abschließen', value: 'finish' },
        );

      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // /finish
    if (i.isChatInputCommand() && i.commandName === 'finish') {
      const roles = process.env.FINISH_ROLES?.split(',') || [];
      if (roles.length && !roles.some(r => i.member.roles.cache.has(r)))
        return i.reply({ content: '❌ Keine Berechtigung.', flags: 64 });

      const kunde = i.options.getUser('kunde');
      const embed = new EmbedBuilder()
        .setTitle('🧾 Bestellung abschließen')
        .setDescription(`${kunde}, bitte gib dein Feedback ab.`)
        .setColor('#00B894');

      const btn = new ButtonBuilder().setCustomId(`finish_feedback_${kunde.id}`).setLabel('⭐ Feedback geben').setStyle(ButtonStyle.Primary);
      return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
    }

    // Finish: Feedback Button
    if (i.isButton() && i.customId.startsWith('finish_feedback_')) {
      const userId = i.customId.split('finish_feedback_')[1];
      if (i.user.id !== userId) return i.reply({ content: '❌ Dieses Feedback ist nicht für dich.', flags: 64 });

      const modal = new ModalBuilder().setCustomId(`finish_feedback_modal_${userId}`).setTitle('Feedback abgeben');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fb_text').setLabel('Dein Feedback').setStyle(TextInputStyle.Paragraph).setRequired(true)));
      return i.showModal(modal);
    }

    // Finish: Feedback Modal submit
    if (i.isModalSubmit() && i.customId.startsWith('finish_feedback_modal_')) {
      const userId = i.customId.split('finish_feedback_modal_')[1];
      const text = i.fields.getTextInputValue('fb_text');

      // optional Kunde-Rolle vergeben
      const roleId = process.env.CUSTOMER_ROLE_ID;
      if (roleId) {
        const role = i.guild.roles.cache.get(roleId);
        const member = await i.guild.members.fetch(userId).catch(() => null);
        if (role && member) await member.roles.add(role).catch(() => {});
      }

      // optional Log
      const logId = process.env.TICKET_LOG_CHANNEL_ID;
      const log = i.guild.channels.cache.get(logId);
      if (log) {
        const e = new EmbedBuilder()
          .setTitle('📝 Feedback erhalten')
          .addFields(
            { name: 'Von', value: `<@${userId}>`, inline: true },
            { name: 'Feedback', value: text || '-' }
          )
          .setColor('#FFD166');
        await log.send({ embeds: [e] });
      }

      // Button-Message löschen (falls möglich)
      try { await i.message.delete().catch(() => {}); } catch {}

      return i.reply({ content: '✅ Danke für dein Feedback!', flags: 64 });
    }

    // /giveaway
    if (i.isChatInputCommand() && i.commandName === 'giveaway') {
      const sub = i.options.getSubcommand();

      if (sub === 'start') {
        const ms = parseDuration(i.options.getString('dauer'));
        if (!ms) return i.reply({ content: '❌ Ungültige Dauer! Nutze z.B. 1d, 2h, 30m oder Sekunden.', flags: 64 });

        const winners = i.options.getInteger('gewinner');
        const prize = i.options.getString('preis');
        const channel = i.options.getChannel('kanal');
        if (!channel || channel.type !== ChannelType.GuildText)
          return i.reply({ content: '❌ Bitte einen Textkanal angeben.', flags: 64 });

        const endTs = Date.now() + ms;
        const emb = new EmbedBuilder()
          .setTitle('🎉 Giveaway')
          .setDescription(`**Preis:** ${prize}\n**Gewinner:** ${winners}\n**Ende:** <t:${Math.floor(endTs / 1000)}:R>\n\nKlicke auf **Teilnehmen**!`)
          .setColor('#f39c12');

        const btn = new ButtonBuilder().setCustomId('gw_enter').setLabel('🎉 Teilnehmen').setStyle(ButtonStyle.Success);
        const msg = await channel.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(btn)] });

        giveaways.set(msg.id, { entrants: new Set(), winners, prize, timeoutId: null });

        const timeoutId = setTimeout(async () => {
          const state = giveaways.get(msg.id);
          if (!state) return;

          const list = Array.from(state.entrants);
          if (list.length === 0) {
            await msg.reply('❌ Keine Teilnehmer. Giveaway beendet.');
          } else {
            const shuffled = list.sort(() => Math.random() - 0.5);
            const selected = shuffled.slice(0, winners);
            await msg.reply(`🎉 Gewinner: ${selected.map(id => `<@${id}>`).join(', ')} — Preis: **${prize}**`);
          }
          giveaways.delete(msg.id);
        }, ms);
        giveaways.get(msg.id).timeoutId = timeoutId;

        return i.reply({ content: `✅ Giveaway gestartet in ${channel}!`, flags: 64 });
      }

      if (sub === 'reroll') {
        const messageId = i.options.getString('message_id');
        const state = giveaways.get(messageId);
        if (!state) return i.reply({ content: '❌ Kein aktives Giveaway (oder Bot neu gestartet).', flags: 64 });
        const list = Array.from(state.entrants);
        if (list.length === 0) return i.reply({ content: '❌ Keine Teilnehmer vorhanden.', flags: 64 });
        const shuffled = list.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, state.winners);
        return i.reply({ content: `🎲 Reroll Gewinner: ${selected.map(id => `<@${id}>`).join(', ')} — Preis: **${state.prize}**`, flags: 64 });
      }

      if (sub === 'delete') {
        const messageId = i.options.getString('message_id');
        const state = giveaways.get(messageId);
        if (state?.timeoutId) clearTimeout(state.timeoutId);
        giveaways.delete(messageId);
        return i.reply({ content: '🗑️ Giveaway gestoppt (In-Memory).', flags: 64 });
      }
    }

    // Giveaway Teilnahme
    if (i.isButton() && i.customId === 'gw_enter') {
      const state = giveaways.get(i.message.id);
      if (!state) return i.reply({ content: '❌ Dieses Giveaway ist nicht mehr aktiv.', flags: 64 });
      state.entrants.add(i.user.id);
      return i.reply({ content: '✅ Teilnahme registriert! Viel Glück 🍀', flags: 64 });
    }

    // /nuke (mit Bestätigung)
    if (i.isChatInputCommand() && i.commandName === 'nuke') {
      const roles = process.env.NUKE_ROLES?.split(',') || [];
      if (roles.length && !roles.some(r => i.member.roles.cache.has(r)))
        return i.reply({ content: '❌ Keine Berechtigung für /nuke.', flags: 64 });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nuke_confirm').setLabel('✅ Bestätigen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('nuke_cancel').setLabel('❌ Abbrechen').setStyle(ButtonStyle.Secondary),
      );
      return i.reply({ content: '⚠️ Bist du sicher, dass du diesen Channel leeren willst?', components: [row], flags: 64 });
    }

    if (i.isButton() && (i.customId === 'nuke_confirm' || i.customId === 'nuke_cancel')) {
      if (i.customId === 'nuke_cancel')
        return i.update({ content: '❌ Nuke abgebrochen.', components: [] });

      // bestätigen
      await i.update({ content: '⏳ Leere Channel, bitte warten...', components: [] });
      const channel = i.channel;
      try {
        let fetched;
        do {
          fetched = await channel.messages.fetch({ limit: 100 });
          if (fetched.size > 0) await channel.bulkDelete(fetched, true);
          await new Promise(r => setTimeout(r, 400));
        } while (fetched.size >= 2);

        await channel.send(`✅ Channel wurde von **${i.user.tag}** geleert. (Hinweis: Nachrichten älter als 14 Tage können nicht gelöscht werden)`);
      } catch (err) {
        console.error('Nuke Error:', err);
        try { await channel.send('❌ Fehler beim Leeren des Channels.'); } catch {}
      }
    }
  } catch (error) {
    console.error('Interaction Fehler:', error);
    try {
      if (i.deferred || i.replied) await i.followUp({ content: '❌ Es ist ein Fehler aufgetreten!', flags: 64 });
      else await i.reply({ content: '❌ Es ist ein Fehler aufgetreten!', flags: 64 });
    } catch {}
  }
});

// =============================
// LOGIN
// =============================
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('🔐 Login erfolgreich.'))
  .catch(err => console.error('❌ Login fehlgeschlagen:', err));

