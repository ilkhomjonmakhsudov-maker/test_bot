import * as crypto from 'crypto';

/**
 * Telegram Mini App autentifikatsiyasi.
 *
 * Mini App ochilganda Telegram `initData` qatorini beradi — u bot tokeni
 * bilan imzolangan. Imzoni tekshirgach foydalanuvchi ID siga ishonish
 * mumkin, shu sababli alohida login kerak emas.
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

export interface WebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export class InitDataError extends Error {}

/**
 * initData ni tekshiradi va foydalanuvchini qaytaradi.
 *
 * @param maxAgeSeconds  imzo eskirgan deb hisoblanadigan muddat (0 — tekshirilmaydi)
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60,
): WebAppUser {
  if (!botToken) throw new InitDataError('Bot tokeni sozlanmagan.');
  if (!initData) throw new InitDataError('initData bo\'sh.');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new InitDataError('initData imzosi yo\'q.');

  // Imzo hisoblashda "hash" ishtirok etmaydi
  params.delete('hash');

  const checkString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  // Vaqt bo'yicha teng taqqoslash
  const expected = Buffer.from(computed, 'hex');
  const received = Buffer.from(hash, 'hex');
  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    throw new InitDataError('initData imzosi noto\'g\'ri.');
  }

  if (maxAgeSeconds > 0) {
    const authDate = Number(params.get('auth_date') ?? 0);
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (!authDate || ageSeconds > maxAgeSeconds) {
      throw new InitDataError('initData eskirgan — panelni qayta oching.');
    }
  }

  const rawUser = params.get('user');
  if (!rawUser) throw new InitDataError('initData ichida foydalanuvchi yo\'q.');

  let user: WebAppUser;
  try {
    user = JSON.parse(rawUser);
  } catch {
    throw new InitDataError('initData ichidagi foydalanuvchi o\'qilmadi.');
  }

  if (!user || typeof user.id !== 'number') {
    throw new InitDataError('initData ichida foydalanuvchi ID si yo\'q.');
  }

  return user;
}
