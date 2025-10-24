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
  ButtonStyle
} from 'discord.js';
import 'dotenv/config';
import fs from 'fs';

// === Client erstellen ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// === Commands definieren ===
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Antwortet mit Pong!'),
  new SlashCommandBuilder().setName('serverstats').setDescription('Zeigt Server-Statistiken an'),
  new SlashCommandBuilder().setName('feedback').setDescription('Gib Feedback für einen Verkäufer'),
  new SlashCommandBuilder().setName('embed').setDescription('Erstellt ein Embed über ein Modal'),
  new SlashCommandBuilder()
    .setName('paypal')
    .setDescription('Erstellt einen PayPal-Zahlungslink')
    .addNumberOption(option =>
      option.setName('betrag')
            .setDescription('Betrag in Euro')
            .setRequired(true)
    ),
  new SlashCommandBuilder().setName('ticketmsg').setDescription('Sendet das Ticket-Auswahl-Embed')
].map(c => c.toJSON());

// === Commands registrieren ===
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔄 Commands werden registriert/überschrieben...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.BOT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Commands registriert!');
  } catch (err) {
    console.error('❌ Fehler beim Registrieren der Commands:', err);
  }
})();

// === Helper: Serverstats ===
async function createOrUpdateStatsChannels(guild) {
  try {
    let memberChannel = guild.channels.cache.find(c => c.name.includes('👥 Mitglieder'));
    if (!memberChannel) {
      await guild.channels.create({
        name: `👥 Mitglieder: ${guild.memberCount}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [{ id: guild.roles.everyone, deny: ['Connect'] }]
      });
    } else await memberChannel.setName(`👥 Mitglieder: ${guild.memberCount}`);

    console.log('✅ Serverstats aktualisiert');
  } catch (error) {
    console.error('Fehler bei Serverstats:', error);
  }
}

// === Bot Ready ===
client.once('ready', async () => {
  console.log(`🤖 Bot ist online als ${client.user.tag}`);
  client.guilds.cache.forEach(guild => createOrUpdateStatsChannels(guild));
});

// === Interactions ===
client.on('interactionCreate', async interaction => {
  try {
    // --- PING ---
    if (interaction.isCommand() && interaction.commandName === 'ping') {
      await interaction.reply('🏓 Pong!');
      return;
    }

    // --- /TICKETMSG ---
    if (interaction.isCommand() && interaction.commandName === 'ticketmsg') {
      const allowedRoles = process.env.TICKETMSG_ROLES ? process.env.TICKETMSG_ROLES.split(',') : [];
      const memberRoles = interaction.member.roles.cache.map(r => r.id);
      if (!allowedRoles.some(r => memberRoles.includes(r))) {
        await interaction.reply({ content: '❌ Du hast keine Berechtigung für diesen Command.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🎫 Erstelle dein Ticket')
        .setDescription('Bitte wähle die Art deines Tickets aus dem Menü unten aus.')
        .setColor('#00FF00')
        .setImage('https://files.fm/u/gbvzj5yexg')
        .setFooter({ text: 'Kandar Community', iconURL: interaction.guild.iconURL({ dynamic: true }) });

      const dropdown = new StringSelectMenuBuilder()
        .setCustomId('ticketSelect')
        .setPlaceholder('Wähle eine Ticket-Art')
        .addOptions([
          { label: 'Shop', value: 'shop', emoji: '💰', description: 'Ticket für Käufe' },
          { label: 'Kandar Bewerbung', value: 'kandar', emoji: '✍️', description: 'Ticket für Kandar Bewerbung' },
          { label: 'Designer Bewerbung', value: 'designer', emoji: '🎨', description: 'Ticket für Designer Bewerbung' },
          { label: 'Cutter Bewerbung', value: 'cutter', emoji: '✂️', description: 'Ticket für Cutter Bewerbung' },
        ]);

      const row = new ActionRowBuilder().addComponents(dropdown);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
      return;
    }

    // --- Dropdown Auswahl Ticket ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticketSelect') {
      const choice = interaction.values[0];
      const guild = interaction.guild;

      let categoryName;
      let channelName;
      switch(choice){
        case 'shop':
          categoryName = 'Shop Tickets';
          channelName = `💰-${interaction.user.username}`;
          break;
        case 'kandar':
          categoryName = 'Kandar Bewerbungen';
          channelName = `✍️-${interaction.user.username}`;
          break;
        case 'designer':
          categoryName = 'Designer Bewerbungen';
          channelName = `🎨-${interaction.user.username}`;
          break;
        case 'cutter':
          categoryName = 'Cutter Bewerbungen';
          channelName = `✂️-${interaction.user.username}`;
          break;
      }

      // Kategorie
      let category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
      if (!category) {
        category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
      }

      // Ticket Channel
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: ['ViewChannel'] },
          { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        ],
      });

      const closeButton = new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Ticket schließen')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(closeButton);

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`🎫 ${choice.charAt(0).toUpperCase()+choice.slice(1)} Ticket`)
        .setDescription(`Hallo ${interaction.user}, bitte schildere dein Anliegen unten.`)
        .setColor('#00FF00')
        .setFooter({ text: 'Kandar Community', iconURL: interaction.guild.iconURL({ dynamic: true }) });

      await ticketChannel.send({ content: `${interaction.user}`, embeds: [ticketEmbed], components: [row] });
      await interaction.reply({ content: `✅ Dein Ticket wurde erstellt: ${ticketChannel}`, ephemeral: true });
      return;
    }

    // --- Ticket schließen (Button) ---
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel('✅ Schließen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel('❌ Abbrechen').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ content: 'Bist du sicher, dass du dieses Ticket schließen möchtest?', components: [confirmRow] });
      return;
    }

    // --- Ticket-Schließung abbrechen ---
    if (interaction.isButton() && interaction.customId === 'cancel_close_ticket') {
      await interaction.update({ content: '❌ Ticket-Schließung abgebrochen!', components: [] });
      return;
    }

    // --- Ticket-Schließung bestätigen + Transkript ---
    if (interaction.isButton() && interaction.customId === 'confirm_close_ticket') {
      await interaction.reply({ content: '📦 Erstelle Transkript und schließe das Ticket...', ephemeral: false });
      const logChannelId = process.env.TICKET_LOG_CHANNEL_ID;
      const logChannel = interaction.guild.channels.cache.get(logChannelId);

      try {
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const sortedMessages = Array.from(messages.values()).reverse();

        let transcript = `--- 📜 Ticket-Transkript ---\nServer: ${interaction.guild.name}\nChannel: ${interaction.channel.name}\nGeschlossen von: ${interaction.user.tag}\nZeit: ${new Date().toLocaleString()}\n\n`;

        for (const msg of sortedMessages) {
          const time = new Date(msg.createdTimestamp).toLocaleString();
          const author = msg.author?.tag || 'Unbekannt';
          const content = msg.content || '[Anhang/Nachricht leer]';
          transcript += `[${time}] ${author}: ${content}\n`;
        }

        const path = `./transcript_${interaction.channel.id}.txt`;
        fs.writeFileSync(path, transcript, 'utf8');

        const embed = new EmbedBuilder()
          .setTitle('📁 Ticket geschlossen')
          .setDescription(`Das Ticket **${interaction.channel.name}** wurde geschlossen und archiviert.`)
          .addFields(
            { name: 'Geschlossen von', value: `${interaction.user}`, inline: true },
            { name: 'Ticket-ID', value: `\`${interaction.channel.id}\``, inline: true }
          )
          .setColor('#FF0000')
          .setTimestamp()
          .setFooter({ text: 'Kandar Community', iconURL: interaction.guild.iconURL({ dynamic: true }) });

        if (logChannel) {
          await logChannel.send({ embeds: [embed], files: [path] });
        }

        await interaction.followUp({ content: '✅ Ticket wird in **5 Sekunden** gelöscht...', ephemeral: false });

        setTimeout(async () => {
          fs.unlinkSync(path);
          await interaction.channel.delete().catch(() => {});
        }, 5000);
      } catch (err) {
        console.error('Fehler beim Erstellen des Transkripts:', err);
        await interaction.followUp({ content: '❌ Fehler beim Erstellen des Transkripts!', ephemeral: true });
      }
    }

  } catch (error) {
    console.error('Fehler im Interaction Listener:', error);
    if (interaction.replied || interaction.deferred)
      await interaction.followUp({ content: '❌ Es ist ein Fehler aufgetreten!', ephemeral: true });
    else
      await interaction.reply({ content: '❌ Es ist ein Fehler aufgetreten!', ephemeral: true });
  }
});

// === Login ===
client.login(process.env.DISCORD_TOKEN);
