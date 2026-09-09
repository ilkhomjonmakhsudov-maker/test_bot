/**
 * Ko'p tilli yordam matnlari: kalit formatlari (o'qituvchi) va javob
 * yuborish formati (talaba).
 *
 * Matnlar tuzilma sifatida saqlanadi, MarkdownV2 ekranlash `render` da
 * bir joyda bajariladi — shu sababli yangi til qo'shishda ekranlashni
 * qo'lda takrorlash shart emas.
 *
 * DIQQAT: kod bloklaridagi tur so'zlari ("variant", "ochiq") tarjima
 * QILINMAYDI — ajratgich faqat lotincha so'zlarni taniydi.
 */
import { escMd } from './message-builder';

export type Lang = 'uz' | 'ru' | 'en';

export const LANGS: Lang[] = ['uz', 'ru', 'en'];

const LANG_NAMES: Record<Lang, string> = {
  uz: "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

/** "ru", "RU", "русский", "russian" — hammasini tushunadi */
export function normalizeLang(raw: string): Lang | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (/^(uz|uzb|o'z|oz|uzbek|o'zbek|ozbek|uzbekcha)/.test(value)) return 'uz';
  if (/^(ru|rus|русск|russian)/.test(value)) return 'ru';
  if (/^(en|eng|english|ingliz)/.test(value)) return 'en';
  return null;
}

/** Telegram profilidagi til kodi bo'yicha taxmin; tanilmasa — o'zbekcha */
export function detectLang(languageCode?: string): Lang {
  return (languageCode && normalizeLang(languageCode)) || 'uz';
}

// ─── Tuzilma ──────────────────────────────────────────────────────────────────

interface FormatBlock {
  heading: string;
  /** Kod bloki qatorlari — ekranlanmaydi, tarjima qilinmaydi */
  code: string[];
  note?: string;
}

interface FormatHelp {
  title: string;
  intro: string;
  blocks: FormatBlock[];
  footer: string[];
}

/** Tuzilmani MarkdownV2 ga aylantiradi: matn ekranlanadi, kod bloki — yo'q */
function render(help: FormatHelp): string {
  const out: string[] = [`*${escMd(help.title)}*`, '', escMd(help.intro)];

  for (const block of help.blocks) {
    out.push('', `*${escMd(block.heading)}*`, '```', ...block.code, '```');
    if (block.note) out.push(escMd(block.note));
  }

  if (help.footer.length > 0) {
    out.push('');
    for (const line of help.footer) out.push(`• ${escMd(line)}`);
  }

  return out.join('\n');
}

// ─── Kalit formatlari (o'qituvchi) ────────────────────────────────────────────

const KEY_FORMATS: Record<Lang, FormatHelp> = {
  uz: {
    title: '🔑 Kalit formatlari',
    intro:
      "Kalitni matn orqali yuborish mumkin. Bitta xabarda formatlarni " +
      "aralashtirsa ham bo'ladi.",
    blocks: [
      {
        heading: '1. Qisqa yozuv — faqat variantli savollar',
        code: ['1-A 2-B 3-C', '1-A | 2-B | 3-C'],
        note: "Javob A–E harflaridan biri bo'lishi kerak.",
      },
      {
        heading: '2. Ustunli yozuv — ochiq savollar ham',
        code: ['1 | variant | A', '2 | ochiq | 18/60', '3 | ochiq | 18/60 | Savol matni'],
        note: 'Ustunlar: savol | turi | javob | savol matni (ixtiyoriy).',
      },
      {
        heading: "3. Turi bo'sh — bot o'zi aniqlaydi",
        code: ['1 || B', '2 || 18/60'],
        note: 'Bitta harf (A–E) — variantli, boshqasi — ochiq.',
      },
    ],
    footer: [
      "Ochiq javob ichida bo'shliq bo'lishi mumkin: 3 | ochiq | tez oqim",
      "Har bir savolni alohida qatorda yozing — bir qator, bitta savol.",
      "Savol matni faqat baholash faylida ko'rinadi, talabalarga yuborilmaydi.",
      'Excel orqali ham yuklash mumkin. Namuna: /namuna',
    ],
  },

  ru: {
    title: '🔑 Форматы ключа',
    intro:
      'Ключ можно отправить текстом. В одном сообщении форматы можно смешивать.',
    blocks: [
      {
        heading: '1. Краткая запись — только вопросы с вариантами',
        code: ['1-A 2-B 3-C', '1-A | 2-B | 3-C'],
        note: 'Ответ — одна буква A–E.',
      },
      {
        heading: '2. Запись столбцами — в том числе открытые вопросы',
        code: ['1 | variant | A', '2 | ochiq | 18/60', '3 | ochiq | 18/60 | Текст вопроса'],
        note:
          'Столбцы: вопрос | тип | ответ | текст вопроса (необязательно). ' +
          'Тип пишется латиницей: variant или ochiq (также open, text).',
      },
      {
        heading: '3. Тип не указан — бот определит сам',
        code: ['1 || B', '2 || 18/60'],
        note: 'Одна буква (A–E) — вариант, иначе — открытый вопрос.',
      },
    ],
    footer: [
      'В открытом ответе допустимы пробелы: 3 | ochiq | tez oqim',
      'Каждый вопрос — на отдельной строке.',
      'Текст вопроса виден только в файле проверки, студентам он не отправляется.',
      'Ключ также можно загрузить файлом Excel. Образец: /namuna',
    ],
  },

  en: {
    title: '🔑 Answer key formats',
    intro: 'Send the key as text. Formats can be mixed in one message.',
    blocks: [
      {
        heading: '1. Shorthand — variant questions only',
        code: ['1-A 2-B 3-C', '1-A | 2-B | 3-C'],
        note: 'The answer must be a single letter A–E.',
      },
      {
        heading: '2. Column format — open questions too',
        code: ['1 | variant | A', '2 | ochiq | 18/60', '3 | ochiq | 18/60 | Question text'],
        note:
          'Columns: question | type | answer | question text (optional). ' +
          'Type words are Latin: variant or ochiq (open and text also work).',
      },
      {
        heading: '3. Type omitted — the bot infers it',
        code: ['1 || B', '2 || 18/60'],
        note: 'A single letter (A–E) means variant, anything else open.',
      },
    ],
    footer: [
      'An open answer may contain spaces: 3 | ochiq | tez oqim',
      'Put each question on its own line.',
      'Question text appears only in the grading file, never sent to students.',
      'The key can also be uploaded as Excel. Template: /namuna',
    ],
  },
};

// ─── Javob yuborish formati (talaba) ──────────────────────────────────────────

const SUBMIT_FORMATS: Record<Lang, FormatHelp> = {
  uz: {
    title: '📨 Javob yuborish formati',
    intro:
      "Barcha javoblarni bitta xabarda yuboring. Misol: /yuborish 1-A 2-C 3-18/60",
    blocks: [
      {
        heading: '1. Oddiy yozuv',
        code: ['1-A 2-C 3-18/60 4-20x'],
        note: "Savol raqamidan keyin -, . yoki ) belgisi bo'lishi mumkin.",
      },
      {
        heading: "2. Quvur bilan — javob ichida bo'shliq bo'lsa",
        code: ['1-A | 2-C | 3-18 / 60'],
        note: "Ochiq javobingizda bo'shliq bo'lsa, shu yozuvni ishlating.",
      },
      {
        heading: '3. Har bir javob alohida qatorda',
        code: ['1-A', '2-C', '3-18/60'],
      },
    ],
    footer: [
      'Variantli savolga javob faqat bitta harf: A, B, C, D yoki E.',
      'Javobni qayta yuborsangiz, oldingisi almashtiriladi.',
      "Ochiq javoblarni o'qituvchi tekshiradi — natija test yakunlangach keladi.",
    ],
  },

  ru: {
    title: '📨 Формат отправки ответов',
    intro:
      'Отправьте все ответы одним сообщением. Пример: /yuborish 1-A 2-C 3-18/60',
    blocks: [
      {
        heading: '1. Обычная запись',
        code: ['1-A 2-C 3-18/60 4-20x'],
        note: 'После номера вопроса допустимы -, . или ).',
      },
      {
        heading: '2. Через вертикальную черту — если в ответе есть пробелы',
        code: ['1-A | 2-C | 3-18 / 60'],
        note: 'Используйте эту запись, если открытый ответ содержит пробелы.',
      },
      {
        heading: '3. Каждый ответ на отдельной строке',
        code: ['1-A', '2-C', '3-18/60'],
      },
    ],
    footer: [
      'Ответ на вопрос с вариантами — одна буква: A, B, C, D или E.',
      'Повторная отправка заменяет предыдущие ответы.',
      'Открытые ответы проверяет преподаватель — результат придёт после завершения теста.',
    ],
  },

  en: {
    title: '📨 How to submit answers',
    intro: 'Send all answers in one message. Example: /yuborish 1-A 2-C 3-18/60',
    blocks: [
      {
        heading: '1. Plain form',
        code: ['1-A 2-C 3-18/60 4-20x'],
        note: 'The question number may be followed by -, . or ).',
      },
      {
        heading: '2. Pipe-separated — when an answer contains spaces',
        code: ['1-A | 2-C | 3-18 / 60'],
        note: 'Use this form if your open answer has spaces in it.',
      },
      {
        heading: '3. One answer per line',
        code: ['1-A', '2-C', '3-18/60'],
      },
    ],
    footer: [
      'A variant question takes a single letter: A, B, C, D or E.',
      'Submitting again replaces your previous answers.',
      'Open answers are checked by the teacher — your result arrives once the test is closed.',
    ],
  },
};

// ─── Til tanlash xabarlari ────────────────────────────────────────────────────

const LANG_PROMPT: Record<Lang, string> = {
  uz: 'Tilni tanlang:',
  ru: 'Выберите язык:',
  en: 'Choose a language:',
};

const LANG_SET: Record<Lang, string> = {
  uz: "✅ Til o'zbekchaga o'zgartirildi.",
  ru: '✅ Язык изменён на русский.',
  en: '✅ Language set to English.',
};

const LANG_UNKNOWN: Record<Lang, string> = {
  uz: 'Bunday til yo\'q.',
  ru: 'Такой язык не поддерживается.',
  en: 'That language is not supported.',
};

// ─── Ommaviy API ──────────────────────────────────────────────────────────────

export function keyFormatHelp(lang: Lang): string {
  return render(KEY_FORMATS[lang]);
}

export function submitFormatHelp(lang: Lang): string {
  return render(SUBMIT_FORMATS[lang]);
}

/** Joriy til + tanlash yo'riqnomasi (oddiy matn, MarkdownV2 emas) */
export function languagePrompt(lang: Lang): string {
  const options = LANGS.map(
    (l) => `  /til ${l} — ${LANG_NAMES[l]}${l === lang ? ' ✅' : ''}`,
  );
  return `${LANG_PROMPT[lang]}\n${options.join('\n')}`;
}

export function languageSet(lang: Lang): string {
  return LANG_SET[lang];
}

export function languageUnknown(lang: Lang, raw: string): string {
  return `${LANG_UNKNOWN[lang]} "${raw}"\n\n${languagePrompt(lang)}`;
}
