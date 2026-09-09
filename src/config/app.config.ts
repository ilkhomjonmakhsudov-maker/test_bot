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

  /** Statistika fayli — yakunlangan testlar hisobi */
  statsFilePath: process.env.STATS_FILE_PATH || './data/stats.json',

  /**
   * Telegram Mini App uchun ochiq HTTPS manzil (masalan
   * https://bot.example.com). Bo'sh bo'lsa panelda veb tugmasi
   * ko'rsatilmaydi — Telegram web_app tugmasi HTTPS talab qiladi.
   */
  publicUrl: (
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.WEBHOOK_URL ||
    ''
  ).replace(/\/+$/, ''),

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
