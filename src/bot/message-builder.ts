import { Session, StudentResult } from '../session/interfaces/session.interface';
import { Admin } from '../teacher/interfaces/admin.interface';

/**
 * Barcha foydalanuvchi interfeysidagi matnlar shu yerda joylashgan.
 * O'zbek tilida yozilgan.
 */
export class MessageBuilder {

  // ─── Super Admin ─────────────────────────────────────────────────────────────

  static superAdminWelcome(name: string): string {
    return (
      `👑 *Xush kelibsiz, Super Admin ${escMd(name)}\\!*\n\n` +
      `Siz o'qituvchilarni boshqarishingiz va barcha o'qituvchi buyruqlaridan foydalanishingiz mumkin\\.\n\n` +
      `*O'qituvchilarni boshqarish:*\n` +
      `/oqituvchi\\_qosh @username — O'qituvchini username orqali qo'shish\n` +
      `/oqituvchi\\_qosh 123456789 — O'qituvchini ID orqali qo'shish\n` +
      `/oqituvchi\\_ochir @username — O'qituvchini o'chirish\n` +
      `/oqituvchilar — Barcha o'qituvchilar ro'yxati\n\n` +
      `*O'qituvchi buyruqlari:*\n` +
      `/yangitest /javoblar /ball /natijalar /yakunla /holat\n\n` +
      `To'liq ro'yxat uchun /yordam buyrug'ini yuboring\\.`
    );
  }

  static superAdminHelp(): string {
    return (
      `📖 *Super Admin Buyruqlari*\n\n` +
      `*O'qituvchilarni boshqarish:*\n` +
      `/oqituvchi\\_qosh @username yoki ID — O'qituvchi qo'shish\n` +
      `/oqituvchi\\_ochir @username yoki ID — O'qituvchi o'chirish\n` +
      `/oqituvchilar — Barcha o'qituvchilar ro'yxati\n\n` +
      `*O'qituvchi buyruqlari \\(ham mavjud\\):*\n` +
      `/yangitest /javoblar /ball /natijalar /yakunla /holat\n\n` +
      `*Eslatma:*\n` +
      `• @username orqali qo'shish uchun o'qituvchi avval /start yuborgan bo'lishi kerak\n` +
      `• ID orqali qo'shish har doim ishlaydi\n` +
      `• O'zgarishlar darhol admins\\.json fayliga saqlanadi`
    );
  }

  static teacherAdded(name: string, telegramId: number): string {
    return (
      `✅ *O'qituvchi muvaffaqiyatli qo'shildi\\!*\n\n` +
      `Ism: *${escMd(name)}*\n` +
      `Telegram ID: \`${telegramId}\`\n\n` +
      `Endi ular barcha o'qituvchi buyruqlaridan foydalana oladi\\.`
    );
  }

  static teacherRemoved(name: string, telegramId: number): string {
    return (
      `✅ *O'qituvchi o'chirildi\\.*\n\n` +
      `Ism: *${escMd(name)}*\n` +
      `Telegram ID: \`${telegramId}\``
    );
  }

  static teacherList(teachers: Admin[]): string {
    if (teachers.length === 0) {
      return (
        `📋 *O'qituvchilar ro'yxati*\n\n` +
        `Hozircha hech qanday o'qituvchi ro'yxatdan o'tmagan\\.\n` +
        `/oqituvchi\\_qosh buyrug'i orqali qo'shing\\.`
      );
    }
    const lines = teachers.map(
      (t, i) => `${i + 1}\\. *${escMd(t.name)}* — \`${t.telegramId}\``,
    );
    return `📋 *O'qituvchilar ro'yxati \\(${teachers.length} ta\\)*\n\n${lines.join('\n')}`;
  }

  // ─── O'qituvchi ───────────────────────────────────────────────────────────────

  static teacherWelcome(name: string): string {
    return (
      `👋 *Xush kelibsiz, ${escMd(name)}\\!*\n\n` +
      `Siz o'qituvchi sifatida ro'yxatdan o'tgansiz\\. Buyruqlar:\n\n` +
      `/yangitest — Yangi test sessiyasini boshlash\n` +
      `/javoblar — To'g'ri javoblarni kiritish\n` +
      `/ball — Baholash tizimini sozlash\n` +
      `/natijalar — Joriy natijalarni ko'rish\n` +
      `/yakunla — Testni yakunlash va Excel olish\n` +
      `/holat — Sessiya holati\n` +
      `/bekor — Amalni bekor qilish\n\n` +
      `To'liq ro'yxat uchun /yordam buyrug'ini yuboring\\.`
    );
  }

  static teacherHelp(): string {
    return (
      `📖 *O'qituvchi Buyruqlari*\n\n` +
      `/yangitest \\[nom\\] — Yangi test sessiyasini boshlash\n` +
      `/javoblar \\[1\\-A 2\\-B\\.\\.\\.\\] — To'g'ri javoblarni belgilash\n` +
      `/ball \\[ball\\] \\[jarima\\] — Baholash tizimini sozlash\n` +
      `/natijalar — Topshirilgan javoblarni ko'rish\n` +
      `/yakunla — Testni yakunlash, Excel yuborish, ma'lumotlarni o'chirish\n` +
      `/holat — Joriy sessiya ma'lumotlari\n` +
      `/bekor — Joriy amalni bekor qilish\n\n` +
      `*Baholash formati misollari:*\n` +
      `\`1\` — 1 ball to'g'ri, jarima yo'q\n` +
      `\`1 0\\.25\` — 1 ball to'g'ri, har noto'g'ri uchun \\-0\\.25\n` +
      `\`2 1\` — 2 ball to'g'ri, har noto'g'ri uchun \\-1`
    );
  }

  static sessionCreated(session: Session): string {
    return (
      `✅ *Test sessiyasi yaratildi\\!*\n\n` +
      `📋 *Nomi:* ${escMd(session.testName)}\n` +
      `🔑 *Sessiya ID:* \`${session.sessionId}\`\n\n` +
      `Bu ID ni talabalar bilan ulashing\\. Ular quyidagi buyruq orqali qo'shiladi:\n` +
      `\`/qoshil ${session.sessionId}\`\n\n` +
      `*Keyingi qadam:* /javoblar buyrug'i bilan to'g'ri javoblarni kiriting\\.`
    );
  }

  static answersSet(count: number, preview: string): string {
    return (
      `✅ *${count} ta javob saqlandi\\.*\n\n` +
      `Ko'rinish: \`${escMd(preview)}\`\n\n` +
      `Talabalar endi /yuborish buyrug'i bilan javob topshira oladi\\.\n` +
      `/ball buyrug'i bilan baholashni o'zgartiring \\(standart: har to'g'ri 1 ball\\)\\.`
    );
  }

  static scoringSet(pointsPerCorrect: number, pointsPerWrong: number): string {
    return (
      `✅ *Baholash tizimi yangilandi:*\n` +
      `\\+${escMd(String(pointsPerCorrect))} — har to'g'ri javob uchun\n` +
      `\\-${escMd(String(pointsPerWrong))} — har noto'g'ri javob uchun`
    );
  }

  static sessionStatus(session: Session): string {
    const answerCount = Object.keys(session.answers).length;
    const studentCount = session.students.size;
    const answerStatus =
      answerCount > 0
        ? `${answerCount} ta savol belgilangan`
        : `⚠️ Hali belgilanmagan`;

    return (
      `📋 *Joriy Sessiya*\n\n` +
      `Nomi: *${escMd(session.testName)}*\n` +
      `ID: \`${session.sessionId}\`\n` +
      `Javoblar: ${escMd(answerStatus)}\n` +
      `Baholash: \\+${escMd(String(session.scoring.pointsPerCorrect))} / \\-${escMd(String(session.scoring.pointsPerWrong))}\n` +
      `Javob topshirganlar: *${studentCount} ta*\n` +
      `Yaratilgan vaqt: ${escMd(session.createdAt.toLocaleString())}`
    );
  }

  static resultsSummary(session: Session): string {
    const students = [...session.students.values()].sort(
      (a, b) => b.score - a.score,
    );

    if (students.length === 0) {
      return `📊 *${escMd(session.testName)}* — Hali hech kim javob topshirmagan\\.`;
    }

    const lines = students.map(
      (r, i) =>
        `${i + 1}\\. *${escMd(r.fullName)}* — ${r.score}/${r.maxScore} ball ` +
        `\\(✅${r.correctCount} ❌${r.wrongCount} ⬜${r.missingCount}\\)`,
    );

    const avg = students.reduce((s, r) => s + r.score, 0) / students.length;

    return (
      `📊 *Natijalar: ${escMd(session.testName)}*\n` +
      `${students.length} ta talaba • O'rtacha ball: ${escMd(avg.toFixed(2))}\n\n` +
      lines.join('\n')
    );
  }

  /**
   * Generates paginated messages for the teacher listing every student's
   * per-answer breakdown. Returns an array of pages because Telegram has a
   * 4096-character message limit and there can be many students.
   */
  static teacherDetailedBreakdown(session: Session): string[] {
    const students = [...session.students.values()].sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    );

    if (students.length === 0) return [];

    const questions = Object.keys(session.answers)
      .map(Number)
      .sort((a, b) => a - b);

    // Build one text block per student
    const blocks: string[] = students.map((result) => {
      const studentAnswers: Record<number, string> = {};
      for (const pair of result.rawAnswers.split(/\s+/)) {
        const match = pair.match(/^(\d+)-([A-E])$/);
        if (match) studentAnswers[parseInt(match[1], 10)] = match[2];
      }

      const tokens: string[] = [];
      for (const q of questions) {
        const correct = session.answers[q];
        const given = studentAnswers[q];
        if (!given) {
          tokens.push(`${q}\\-⬜`);
        } else if (given === correct) {
          tokens.push(`${q}\\-${given} ✅`);
        } else {
          tokens.push(`${q}\\-${given} ❌\\(${correct}\\)`);
        }
      }

      // 5 answers per row
      const rows: string[] = [];
      for (let i = 0; i < tokens.length; i += 5) {
        rows.push(tokens.slice(i, i + 5).join('  '));
      }

      const percentage =
        result.maxScore > 0
          ? Math.round((result.score / result.maxScore) * 100)
          : 0;

      return (
        `👤 *${escMd(result.fullName)}*\n` +
        `${rows.join('\n')}\n` +
        `_Ball: ${result.score}/${result.maxScore} \\(${percentage}%\\) — ` +
        `✅${result.correctCount} ❌${result.wrongCount} ⬜${result.missingCount}_`
      );
    });

    // Pack blocks into pages of max 3800 chars (safe Telegram limit)
    const MAX = 3800;
    const header = `📋 *${escMd(session.testName)} — Barcha natijalar*\n\n`;
    const pages: string[] = [];
    let current = header;

    for (const block of blocks) {
      const separator = '\n\n';
      if (current !== header && current.length + separator.length + block.length > MAX) {
        pages.push(current.trimEnd());
        current = block + separator;
      } else {
        current += (current === header ? '' : separator) + block;
      }
    }

    if (current.trim().length > 0) pages.push(current.trimEnd());
    return pages;
  }

  static testEnded(session: Session): string {
    const total = session.students.size;
    if (total === 0) {
      return (
        `🔒 *"${escMd(session.testName)}" testi yakunlandi\\.*\n\n` +
        `Hech qanday javob topshirilmagan\\.`
      );
    }
    const students = [...session.students.values()];
    const avg = students.reduce((s, r) => s + r.score, 0) / total;
    const maxScore = students[0]?.maxScore ?? 0;
    const highest = Math.max(...students.map((r) => r.score));
    const lowest = Math.min(...students.map((r) => r.score));

    return (
      `🔒 *"${escMd(session.testName)}" testi yakunlandi\\.*\n\n` +
      `👥 Ishtirokchilar: *${total} ta*\n` +
      `📈 O'rtacha ball: *${escMd(avg.toFixed(2))} / ${maxScore}*\n` +
      `🏆 Eng yuqori: *${highest}*\n` +
      `📉 Eng past: *${lowest}*\n\n` +
      `Excel fayli yuqorida joylashgan\\. Barcha ma'lumotlar xotiradan o'chirildi\\.`
    );
  }

  // ─── Talaba ───────────────────────────────────────────────────────────────────

  static studentWelcome(): string {
    return (
      `👋 *Test botiga xush kelibsiz\\!*\n\n` +
      `Iltimos, to'liq ismingizni kiriting \\(Ism va Familiya\\):\n\n` +
      `Misol: \`Abdullayev Jasur\``
    );
  }

  static nameSet(name: string): string {
    return (
      `✅ *Ismingiz saqlandi:* ${escMd(name)}\n\n` +
      `Testga qo'shilish uchun quyidagi buyruqdan foydalaning:\n` +
      `\`/qoshil <sessiya_id>\`\n\n` +
      `Sessiya ID ni o'qituvchingizdan so'rang\\.`
    );
  }

  static joinedSession(session: Session): string {
    const answerCount = Object.keys(session.answers).length;
    const submitCmd = '`/yuborish 1\\-A 2\\-B 3\\-C\\.\\.\\.`';
    const readyMsg =
      answerCount > 0
        ? `Javoblaringizni quyidagicha yuboring:\n${submitCmd}\n\nFormat: savol raqami \\+ harf \\(A–E\\)`
        : `⏳ O'qituvchi hali javoblarni kiritgani yo'q\\. Kutib turing, so'ng /yuborish buyrug'ini yuboring\\.`;

    return (
      `✅ *"${escMd(session.testName)}" testiga qo'shildingiz\\!*\n\n` +
      readyMsg
    );
  }

  /**
   * Sent to each student personally when the teacher ends the test.
   * Shows every answer with ✅ / ❌ and reveals the correct option for wrong answers.
   */
  static detailedStudentResult(result: StudentResult, session: Session): string {
    // Parse student's stored raw answers into a lookup map
    const studentAnswers: Record<number, string> = {};
    for (const pair of result.rawAnswers.split(/\s+/)) {
      const match = pair.match(/^(\d+)-([A-E])$/);
      if (match) studentAnswers[parseInt(match[1], 10)] = match[2];
    }

    // Build per-answer tokens sorted by question number
    const questions = Object.keys(session.answers)
      .map(Number)
      .sort((a, b) => a - b);

    const tokens: string[] = [];
    for (const q of questions) {
      const correct = session.answers[q];
      const given = studentAnswers[q];

      if (!given) {
        tokens.push(`${q}\\-⬜`);
      } else if (given === correct) {
        tokens.push(`${q}\\-${given} ✅`);
      } else {
        // Show what they answered and reveal the correct answer
        tokens.push(`${q}\\-${given} ❌\\(${correct}\\)`);
      }
    }

    // Group into rows of 5 so long tests stay readable
    const rows: string[] = [];
    for (let i = 0; i < tokens.length; i += 5) {
      rows.push(tokens.slice(i, i + 5).join('  '));
    }

    const percentage =
      result.maxScore > 0
        ? Math.round((result.score / result.maxScore) * 100)
        : 0;

    const baho =
      percentage >= 90 ? '🏆 A\'lo!'
      : percentage >= 75 ? '✨ Yaxshi!'
      : percentage >= 60 ? '👍 Qoniqarli'
      : percentage >= 40 ? '📚 Ko\'proq o\'qing'
      : '❗ Qoniqarsiz';

    return (
      `📋 *"${escMd(session.testName)}" testi yakunlandi*\n\n` +
      `👤 *${escMd(result.fullName)}*\n\n` +
      `*Javoblaringiz:*\n` +
      `${rows.join('\n')}\n\n` +
      `✅ To'g'ri: *${result.correctCount}*\n` +
      `❌ Noto'g'ri: *${result.wrongCount}*\n` +
      `⬜ Javob berilmagan: *${result.missingCount}*\n\n` +
      `🎯 Ball: *${result.score} / ${result.maxScore}* \\(${percentage}%\\)\n` +
      `${baho}`
    );
  }

  static submissionResult(result: StudentResult): string {
    const percentage =
      result.maxScore > 0
        ? Math.round((result.score / result.maxScore) * 100)
        : 0;

    const baho =
      percentage >= 90 ? '🏆 A\'lo!'
      : percentage >= 75 ? '✨ Yaxshi!'
      : percentage >= 60 ? '👍 Qoniqarli'
      : percentage >= 40 ? '📚 Ko\'proq o\'qing'
      : '❗ Qoniqarsiz';

    return (
      `📊 *Sizning natijangiz*\n\n` +
      `✅ To'g'ri: *${result.correctCount}*\n` +
      `❌ Noto'g'ri: *${result.wrongCount}*\n` +
      `⬜ Javob berilmagan: *${result.missingCount}*\n\n` +
      `🎯 Ball: *${result.score} / ${result.maxScore}* \\(${percentage}%\\)\n` +
      `${baho}\n\n` +
      `_Javoblaringiz qabul qilindi\\._`
    );
  }

  static studentHelp(): string {
    return (
      `📖 *Test topshirish tartibi*\n\n` +
      `1\\. /start yuboring va to'liq ismingizni kiriting\n` +
      `2\\. \`/qoshil <sessiya\\_id>\` — testga qo'shiling\n` +
      `3\\. \`/yuborish 1\\-A 2\\-B 3\\-C\\.\\.\\.\` — javoblarni yuboring\n\n` +
      `*Javob formati:* savol raqami \\+ tire \\+ harf \\(A–E\\)\n` +
      `Misol: \`1\\-A 2\\-C 3\\-B 4\\-D 5\\-E\``
    );
  }

  // ─── Umumiy ───────────────────────────────────────────────────────────────────

  static error(message: string): string {
    return `❌ ${message}`;
  }

  static cancelled(): string {
    return '✅ Amal bekor qilindi\\. Qayta boshlash uchun /start yuboring\\.';
  }
}

/** Telegram MarkdownV2 uchun maxsus belgilarni ekranlaydi */
function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
