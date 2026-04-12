import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    botMode: (process.env.BOT_MODE || 'polling') as 'polling' | 'webhook',
    webhookUrl: process.env.WEBHOOK_URL || '',
    webhookPort: parseInt(process.env.WEBHOOK_PORT || '3000', 10),
  },

  adminsFilePath: process.env.ADMINS_FILE_PATH || './admins.json',

  superAdminIds: (process.env.SUPER_ADMIN_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number),

  /** Auto-expire sessions after this many minutes (0 = disabled) */
  sessionTtlMinutes: parseInt(process.env.SESSION_TTL_MINUTES || '0', 10),

  /** Directory where active session JSON snapshots are stored */
  sessionDataPath: process.env.SESSION_DATA_PATH || './data/sessions',
}));
