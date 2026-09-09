import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Markup } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/types';
import { escMd } from './message-builder';
import {
  Dashboard,
  PendingItem,
  SessionOverview,
} from '../admin/admin.service';
import { StatsSnapshot } from '../stats/stats.service';
import { QuestionKey } from '../session/interfaces/session.interface';

export interface PanelView {
  text: string;
  keyboard: InlineKeyboardMarkup;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '🟢 ACTIVE',
  GRADING: '🟡 GRADING',
};

/**
 * Panel ko'rinishlari: matn + inline tugmalar.
 *
 * Faqat chizadi — hech qanday amal bajarmaydi, shu sababli har bir
 * ko'rinishni testdan o'tkazish oson.
 *
 * callback_data 64 baytdan oshmasligi kerak, shuning uchun qisqa
 * prefikslar ishlatiladi: "p:" panel, "p:sa:" super admin.
 */
@Injectable()
export class PanelService {
  private readonly webAppUrl: string;

  constructor(private readonly config: ConfigService) {
    const base = this.config.get<string>('app.publicUrl', '');
    this.webAppUrl = base ? `${base}/panel` : '';
  }

  /** Mini App faqat HTTPS manzil sozlanganda ko'rsatiladi */
  private webAppRow() {
    if (!this.webAppUrl.startsWith('https://')) return [];
    return [[Markup.button.webApp('🌐 Veb panel', this.webAppUrl)]];
  }

  // ─── Bosh sahifa ────────────────────────────────────────────────────────────

  home(dash: Dashboard): PanelView {
    const lines = [`🛠 *Boshqaruv paneli*`, ''];

    if (!dash.session) {
      lines.push(escMd(`${dash.name}, faol test sessiyangiz yo'q.`));
      lines.push('');
      lines.push(escMd('Yangi test boshlash uchun: /yangitest'));
    } else {
      lines.push(...this.sessionLines(dash.session));
    }

    const rows: any[][] = [];

    if (dash.session) {
      rows.push([
        Markup.button.callback('📊 Natijalar', 'p:res'),
        Markup.button.callback('🔑 Kalit', 'p:key'),
      ]);

      if (dash.session.pending > 0) {
        rows.push([
          Markup.button.callback(
            `✍️ Baholash (${dash.session.pending})`,
            'p:grade',
          ),
        ]);
      }

      rows.push(
        dash.session.status === 'ACTIVE'
          ? [
              Markup.button.callback('⏹ Yakunlash', 'p:stop'),
              Markup.button.callback('⚙️ Ball', 'p:ball'),
            ]
          : [
              Markup.button.callback('▶️ Davom', 'p:resume'),
              Markup.button.callback('📤 Natijalarni yuborish', 'p:send'),
            ],
      );
    }

    if (dash.role === 'super') {
      rows.push([Markup.button.callback('👑 Super admin', 'p:sa')]);
    }

    rows.push(...this.webAppRow());
    rows.push([Markup.button.callback('🔄 Yangilash', 'p:home')]);

    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows).reply_markup };
  }

  private sessionLines(s: SessionOverview): string[] {
    const status = STATUS_LABEL[s.status] ?? s.status;
    const lines = [
      `📋 *${escMd(s.testName)}*`,
      `🔑 \`${s.sessionId}\`  ·  ${escMd(status)}`,
      '',
      escMd(`👥 Talabalar: ${s.students}`),
      escMd(
        `❓ Savollar: ${s.questions}` +
        (s.openQuestions > 0 ? ` (${s.openQuestions} ta ochiq)` : ''),
      ),
      escMd(
        `⚖️ Ball: +${s.scoring.pointsPerCorrect} / −${s.scoring.pointsPerWrong}`,
      ),
    ];

    if (s.questions === 0) {
      lines.push('', escMd('⚠️ Kalit hali kiritilmagan — /javoblar'));
    } else if (s.pending > 0) {
      lines.push('', escMd(`⏳ Tekshirilmagan ochiq javoblar: ${s.pending} ta`));
    } else if (s.status === 'GRADING') {
      lines.push('', escMd('✅ Barcha javoblar baholangan.'));
    }

    return lines;
  }

  // ─── Natijalar ──────────────────────────────────────────────────────────────

  results(rows: ReturnType<() => any[]>, s: SessionOverview): PanelView {
    const lines = [`📊 *Natijalar* — ${escMd(s.testName)}`, ''];

    if (rows.length === 0) {
      lines.push(escMd('Hali hech kim javob topshirmagan.'));
    } else {
      rows.slice(0, 25).forEach((r: any, i: number) => {
        const percent = r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0;
        const flag = r.pendingCount > 0 ? ' ⏳' : '';
        lines.push(
          escMd(`${i + 1}. ${r.fullName} — ${r.score}/${r.maxScore} (${percent}%)${flag}`),
        );
      });
      if (rows.length > 25) {
        lines.push('', escMd(`… va yana ${rows.length - 25} ta talaba`));
      }
    }

    return this.withBack(lines.join('\n'));
  }

  // ─── Kalit ──────────────────────────────────────────────────────────────────

  keyView(questions: QuestionKey[], s: SessionOverview): PanelView {
    const lines = [`🔑 *Kalit* — ${escMd(s.testName)}`, ''];

    if (questions.length === 0) {
      lines.push(escMd('Kalit kiritilmagan. /javoblar yoki Excel fayl yuboring.'));
      return this.withBack(lines.join('\n'));
    }

    for (const q of questions) {
      const mark = q.type === 'open' ? '✍️' : '🔘';
      const text = q.text ? ` — ${q.text}` : '';
      lines.push(escMd(`${mark} ${q.number}. ${q.answer}${text}`));
    }
    lines.push('', escMd('Turini o\'zgartirish uchun savol raqamini bosing:'));

    const rows: any[] = [];
    for (let i = 0; i < questions.length; i += 5) {
      rows.push(
        questions.slice(i, i + 5).map((q) =>
          Markup.button.callback(String(q.number), `p:kt:${q.number}`),
        ),
      );
      if (rows.length >= 8) break; // Telegram tugmalar chegarasi
    }
    rows.push([Markup.button.callback('◀️ Orqaga', 'p:home')]);

    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows).reply_markup };
  }

  // ─── Ochiq javoblarni baholash ──────────────────────────────────────────────

  gradeCard(item: PendingItem, remaining: number): PanelView {
    const lines = [
      `✍️ *Ochiq javobni baholash*`,
      escMd(`Qolgani: ${remaining} ta`),
      '',
      escMd(`👤 ${item.studentName}`),
      escMd(`❓ ${item.question}-savol${item.questionText ? `: ${item.questionText}` : ''}`),
      '',
      `*Talaba javobi:*`,
      `\`${escMd(item.given)}\``,
      `*To'g'ri javob:*`,
      `\`${escMd(item.expected)}\``,
    ];

    if (item.guess) {
      lines.push('', escMd('🤖 Bot: javob mos keladi'));
    }

    const id = `${item.studentId}:${item.question}`;
    const rows = [
      [
        Markup.button.callback('✅ To\'g\'ri', `p:g:${id}:1`),
        Markup.button.callback('❌ Xato', `p:g:${id}:0`),
      ],
      [Markup.button.callback('🤖 Bot taxminini qabul qilish', 'p:gq')],
      [
        Markup.button.callback('✅ Hammasi to\'g\'ri', 'p:ga:1'),
        Markup.button.callback('❌ Hammasi xato', 'p:ga:0'),
      ],
      [Markup.button.callback('◀️ Orqaga', 'p:home')],
    ];

    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows).reply_markup };
  }

  gradingDone(s: SessionOverview): PanelView {
    const lines = [
      '✅ *Barcha ochiq javoblar baholandi*',
      '',
      escMd(`${s.testName} — ${s.students} ta talaba.`),
      '',
      escMd('Endi natijalarni talabalarga yuborishingiz mumkin.'),
    ];
    const rows = [
      [Markup.button.callback('📤 Natijalarni yuborish', 'p:send')],
      [Markup.button.callback('◀️ Orqaga', 'p:home')],
    ];
    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows).reply_markup };
  }

  // ─── Super admin ────────────────────────────────────────────────────────────

  superHome(activeSessions: number, teachers: number): PanelView {
    const lines = [
      '👑 *Super admin*',
      '',
      escMd(`🗂 Faol sessiyalar: ${activeSessions}`),
      escMd(`👨‍🏫 O'qituvchilar: ${teachers}`),
    ];
    const rows = [
      [Markup.button.callback('🗂 Barcha sessiyalar', 'p:sa:s')],
      [Markup.button.callback('👨‍🏫 O\'qituvchilar', 'p:sa:t')],
      [Markup.button.callback('📈 Statistika', 'p:sa:st')],
      [Markup.button.callback('◀️ Orqaga', 'p:home')],
    ];
    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows).reply_markup };
  }

  allSessions(list: SessionOverview[]): PanelView {
    const lines = ['🗂 *Barcha faol sessiyalar*', ''];

    if (list.length === 0) {
      lines.push(escMd('Hozircha faol sessiya yo\'q.'));
      return this.withBack(lines.join('\n'), 'p:sa');
    }

    const rows: any[] = [];
    for (const s of list) {
      const status = STATUS_LABEL[s.status] ?? s.status;
      lines.push(
        `\`${s.sessionId}\` ${escMd(status)}`,
        escMd(`  ${s.testName} · ${s.teacherName}`),
        escMd(
          `  👥 ${s.students} · ❓ ${s.questions}` +
          (s.pending > 0 ? ` · ⏳ ${s.pending}` : ''),
        ),
        '',
      );
      rows.push([
        s.status === 'ACTIVE'
          ? Markup.button.callback(`⏹ ${s.sessionId} to'xtatish`, `p:sa:x:${s.sessionId}`)
          : Markup.button.callback(`▶️ ${s.sessionId} ochish`, `p:sa:o:${s.sessionId}`),
      ]);
      if (rows.length >= 10) break;
    }

    rows.push([Markup.button.callback('◀️ Orqaga', 'p:sa')]);
    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows).reply_markup };
  }

  teacherList(list: { telegramId: number; name: string; hasSession: boolean }[]): PanelView {
    const lines = ['👨‍🏫 *O\'qituvchilar*', ''];

    if (list.length === 0) {
      lines.push(escMd('Ro\'yxat bo\'sh.'));
    } else {
      for (const t of list) {
        lines.push(
          escMd(`${t.hasSession ? '🟢' : '⚪️'} ${t.name}`),
          `  \`${t.telegramId}\``,
        );
      }
    }

    lines.push(
      '',
      escMd('Qo\'shish: /oqituvchi_qosh @username'),
      escMd('O\'chirish: /oqituvchi_ochir @username'),
    );

    return this.withBack(lines.join('\n'), 'p:sa');
  }

  statistics(snapshot: StatsSnapshot, activeSessions: number): PanelView {
    const since = new Date(snapshot.since).toLocaleDateString('en-GB');
    const lines = [
      '📈 *Statistika*',
      escMd(`${since} dan buyon`),
      '',
      escMd(`✅ Yakunlangan testlar: ${snapshot.totalSessions}`),
      escMd(`🗂 Yaratilgan sessiyalar: ${snapshot.createdSessions}`),
      escMd(`🟢 Hozir faol: ${activeSessions}`),
      escMd(`👥 Jami talaba javoblari: ${snapshot.totalStudents}`),
      escMd(`❓ Jami savollar: ${snapshot.totalQuestions}`),
    ];

    if (snapshot.lastSessionAt) {
      lines.push(
        escMd(`🕓 Oxirgi test: ${new Date(snapshot.lastSessionAt).toLocaleString('en-GB')}`),
      );
    }

    if (snapshot.teachers.length > 0) {
      lines.push('', '*O\'qituvchilar bo\'yicha:*');
      for (const t of snapshot.teachers.slice(0, 15)) {
        lines.push(escMd(`• ${t.name} — ${t.sessions} ta test, ${t.students} ta talaba`));
      }
    }

    return this.withBack(lines.join('\n'), 'p:sa');
  }

  // ─── Yordamchi ──────────────────────────────────────────────────────────────

  private withBack(text: string, target = 'p:home'): PanelView {
    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Orqaga', target)],
      ]).reply_markup,
    };
  }
}
