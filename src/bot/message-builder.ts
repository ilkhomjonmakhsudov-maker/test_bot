import {
  Session,
  StudentResult,
  QuestionKey,
} from '../session/interfaces/session.interface';
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
      `/yangitest /javoblar /namuna /ball /natijalar /yakunla /natijalarni\\_yubor /holat\n\n` +
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
      `/yangitest /javoblar /namuna /ball /natijalar /yakunla /natijalarni\\_yubor /davom /holat\n\n` +
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
      `/javoblar — To'g'ri javoblarni kiritish \\(matn yoki Excel\\)\n` +
      `/namuna — Excel kalit namunasini olish\n` +
      `/ball — Baholash tizimini sozlash\n` +
      `/natijalar — Joriy natijalarni ko'rish\n` +
      `/yakunla — Topshirishni to'xtatish \\+ baholash faylini olish\n` +
      `/natijalarni\\_yubor — Natijalarni talabalarga yuborish va testni yopish\n` +
      `/holat — Sessiya holati\n` +
      `/bekor — Amalni bekor qilish\n\n` +
      `To'liq ro'yxat uchun /yordam buyrug'ini yuboring\\.`
    );
  }

  static teacherHelp(): string {
    return (
      `📖 *O'qituvchi Buyruqlari*\n\n` +
      `/yangitest \\[nom\\] — Yangi test sessiyasini boshlash\n` +
      `/javoblar \\[1\\-A 2\\-B\\.\\.\\.\\] — Kalitni matn orqali belgilash\n` +
      `/namuna — Excel kalit namunasi \\(ochiq savollar uchun\\)\n` +
      `/ball \\[ball\\] \\[jarima\\] — Baholash tizimini sozlash\n` +
      `/natijalar — Topshirilgan javoblarni ko'rish\n` +
      `/yakunla — Topshirishni to'xtatish va baholash faylini olish\n` +
      `/davom — Topshirishni qayta ochish\n` +
      `/natijalarni\\_yubor — Natijalarni talabalarga yuborib, testni yopish\n` +
      `/holat — Joriy sessiya ma'lumotlari\n` +
      `/bekor — Joriy amalni bekor qilish\n` +
      `/kalit\\_format — Kalit formatlari \\(uz / ru / en\\)\n` +
      `/til — Yordam matnlari tilini tanlash\n\n` +
      `*Kalitni ikki xil kiritish mumkin:*\n` +
      `1\\. Matn orqali \\(variantli va ochiq savollar\\):\n` +
      `   Qisqa: \`/javoblar 1\\-A 2\\-B 3\\-C\`\n` +
      `   Ustunli — har bir savol alohida qatorda:\n` +
      `   \`1 \\| variant \\| A\`\n` +
      `   \`2 \\| ochiq \\| 18/60 \\| Savol matni\`\n` +
      `   Ustunlar: savol \\| turi \\| javob \\| savol matni \\(ixtiyoriy\\)\n` +
      `2\\. Excel fayl: xuddi shu ustunlar bilan\n` +
      `   Ochiq javob misoli: \`18/60\`, \`20x\`\n\n` +
      `*Test qanday yakunlanadi:*\n` +
      `1\\. /yakunla — talabalar javob topshira olmaydi, sizga Excel keladi\n` +
      `2\\. Excelda ochiq javoblarni 1 \\(to'g'ri\\) / 0 \\(xato\\) deb belgilang\n` +
      `3\\. Faylni botga qaytaring\n` +
      `4\\. /natijalarni\\_yubor — natijalar talabalarga boradi\n\n` +
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
      `*Keyingi qadam — kalitni kiriting:*\n` +
      `• Matn orqali: \`/javoblar 1\\-A 2\\-B 3\\-C\`\n` +
      `• Ochiq savol ham bo'lsa, har birini alohida qatorda yozing:\n` +
      `  \`2 \\| ochiq \\| 18/60 \\| Savol matni\`\n` +
      `• Excel orqali: faylni shu chatga yuboring \\(namuna: /namuna\\)`
    );
  }

  /** Kalit belgilangach yuboriladi — matn yoki Excel orqali */
  static answersSet(questions: QuestionKey[], viaExcel: boolean): string {
    const variants = questions.filter((q) => q.type === 'variant');
    const open = questions.filter((q) => q.type === 'open');

    const previewParts: string[] = [];
    if (variants.length > 0) {
      const preview = variants
        .slice(0, 30)
        .map((q) => `${q.number}-${q.answer}`)
        .join(' ');
      previewParts.push(
        `*Variantli \\(${variants.length} ta\\):*\n\`${escMd(preview)}${variants.length > 30 ? ' …' : ''}\``,
      );
    }
    if (open.length > 0) {
      const preview = open
        .slice(0, 10)
        .map((q) => `${q.number}\\-${escMd(q.answer)}`)
        .join(', ');
      previewParts.push(
        `*Ochiq javobli \\(${open.length} ta\\):*\n${preview}${open.length > 10 ? ' …' : ''}`,
      );
    }

    const openNote =
      open.length > 0
        ? `\n\n⚠️ Ochiq javoblarni bot avtomatik baholamaydi\\. ` +
          `/yakunla dan keyin ularni Excelda o'zingiz tasdiqlaysiz\\.`
        : '';

    return (
      `✅ *${questions.length} ta savol saqlandi* ${viaExcel ? '\\(Excel\\)' : '\\(matn\\)'}\\.\n\n` +
      previewParts.join('\n\n') +
      openNote +
      `\n\nTalabalar endi javob topshira oladi\\.\n` +
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

  static sessionStatus(session: Session, pending: number): string {
    const questions = Object.values(session.questions);
    const openCount = questions.filter((q) => q.type === 'open').length;
    const studentCount = session.students.size;

    const answerStatus =
      questions.length > 0
        ? `${questions.length} ta savol (${questions.length - openCount} variantli, ${openCount} ochiq)`
        : `⚠️ Hali belgilanmagan`;

    const statusLine =
      session.status === 'ACTIVE'
        ? `🟢 Ochiq — talabalar javob topshirmoqda`
        : `⏸ To'xtatilgan — baholash bosqichida`;

    const pendingLine =
      session.status === 'GRADING'
        ? pending > 0
          ? `\n⏳ Tekshirilmagan ochiq javoblar: *${pending} ta*\n` +
            `Baholangan Excelni qaytaring\\.`
          : `\n✅ Barcha javoblar baholangan\\. /natijalarni\\_yubor buyrug'ini yuboring\\.`
        : '';

    return (
      `📋 *Joriy Sessiya*\n\n` +
      `Nomi: *${escMd(session.testName)}*\n` +
      `ID: \`${session.sessionId}\`\n` +
      `Holat: ${escMd(statusLine)}\n` +
      `Savollar: ${escMd(answerStatus)}\n` +
      `Baholash: \\+${escMd(String(session.scoring.pointsPerCorrect))} / \\-${escMd(String(session.scoring.pointsPerWrong))}\n` +
      `Javob topshirganlar: *${studentCount} ta*\n` +
      `Yaratilgan vaqt: ${escMd(session.createdAt.toLocaleString())}` +
      pendingLine
    );
  }

  static resultsSummary(session: Session): string {
    const students = [...session.students.values()].sort(
      (a, b) => b.score - a.score,
    );

    if (students.length === 0) {
      return `📊 *${escMd(session.testName)}* — Hali hech kim javob topshirmagan\\.`;
    }

    const lines = students.map((r, i) => {
      const pending = r.pendingCount > 0 ? ` ⏳${r.pendingCount}` : '';
      return (
        `${i + 1}\\. *${escMd(r.fullName)}* — ${r.score}/${r.maxScore} ball ` +
        `\\(✅${r.correctCount} ❌${r.wrongCount} ⬜${r.missingCount}${pending}\\)`
      );
    });

    const avg = students.reduce((s, r) => s + r.score, 0) / students.length;
    const pending = students.reduce((s, r) => s + r.pendingCount, 0);
    const note =
      pending > 0
        ? `\n\n⏳ ${pending} ta ochiq javob hali tekshirilmagan — ballar vaqtinchalik\\.`
        : '';

    return (
      `📊 *Natijalar: ${escMd(session.testName)}*\n` +
      `${students.length} ta talaba • O'rtacha ball: ${escMd(avg.toFixed(2))}\n\n` +
      lines.join('\n') +
      note
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

    const questions = sortedQuestions(session);

    // Build one text block per student
    const blocks: string[] = students.map((result) => {
      const percentage =
        result.maxScore > 0
          ? Math.round((result.score / result.maxScore) * 100)
          : 0;

      const pending = result.pendingCount > 0 ? ` ⏳${result.pendingCount}` : '';

      return (
        `👤 *${escMd(result.fullName)}*\n` +
        `${answerLines(questions, result).join('\n')}\n` +
        `_Ball: ${result.score}/${result.maxScore} \\(${percentage}%\\) — ` +
        `✅${result.correctCount} ❌${result.wrongCount} ⬜${result.missingCount}${pending}_`
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

  // ─── Yakunlash oqimi ─────────────────────────────────────────────────────────

  /** /yakunla — topshirish to'xtadi, baholash bosqichi boshlandi */
  static gradingStarted(session: Session, pending: number): string {
    const total = session.students.size;

    const head =
      `⏹ *"${escMd(session.testName)}" testi to'xtatildi\\.*\n\n` +
      `Talabalar endi javob topshira olmaydi\\.\n` +
      `👥 Javob topshirganlar: *${total} ta*\n\n`;

    if (pending === 0) {
      return (
        head +
        `✅ Ochiq javobli savol yo'q — hammasi avtomatik tekshirildi\\.\n\n` +
        `Natijalarni talabalarga yuborish uchun:\n` +
        `/natijalarni\\_yubor\n\n` +
        `Testni qayta ochish uchun: /davom`
      );
    }

    return (
      head +
      `⏳ *${pending} ta ochiq javob* sizning tasdiqingizni kutmoqda\\.\n\n` +
      `*Nima qilish kerak:*\n` +
      `1\\. Yuqoridagi Excel faylini oching\n` +
      `2\\. "Baholash" varag'ida oxirgi ustunga *1* \\(to'g'ri\\) yoki *0* \\(xato\\) qo'ying\n` +
      `   _Bot taxminiy baho qo'yib bergan — faqat tekshirib chiqing_\n` +
      `3\\. Faylni saqlab, shu chatga qaytaring\n` +
      `4\\. So'ng /natijalarni\\_yubor buyrug'ini yuboring\n\n` +
      `⚠️ Natijalar siz yubormaguningizcha talabalarga bormaydi\\.\n` +
      `Testni qayta ochish uchun: /davom`
    );
  }

  /** Baholangan Excel qabul qilindi */
  static gradesApplied(applied: number, pending: number): string {
    const head = `✅ *${applied} ta baho qabul qilindi\\.*\n\n`;

    if (pending > 0) {
      return (
        head +
        `⏳ Hali *${pending} ta* ochiq javob tekshirilmagan\\.\n` +
        `Qolgan qatorlarni ham to'ldirib, faylni qayta yuboring\\.\n\n` +
        `Natijalarni ko'rish uchun: /natijalar`
      );
    }

    return (
      head +
      `Barcha ochiq javoblar baholandi\\.\n\n` +
      `Natijalarni ko'rish: /natijalar\n` +
      `Talabalarga yuborish: /natijalarni\\_yubor`
    );
  }

  /** Kalit Excel orqali yangilandi, lekin talabalar javoblari qayta hisoblandi */
  static resumed(session: Session): string {
    return (
      `🟢 *Test qayta ochildi\\.*\n\n` +
      `Talabalar yana javob topshira oladi\\.\n` +
      `Sessiya ID: \`${session.sessionId}\`\n\n` +
      `Tugatish uchun yana /yakunla buyrug'ini yuboring\\.`
    );
  }

  /** /natijalarni_yubor — hali tekshirilmagan javoblar bor */
  static pendingBlocksSend(pending: number): string {
    return (
      `⚠️ *${pending} ta ochiq javob hali tekshirilmagan\\.*\n\n` +
      `Baholash faylini to'ldirib qaytaring, so'ng /natijalarni\\_yubor buyrug'ini takrorlang\\.\n\n` +
      `Tekshirilmaganlarni *xato* deb hisoblab yakunlash uchun:\n` +
      `\`/natijalarni\\_yubor majburiy\``
    );
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
    const questions = Object.values(session.questions);
    const hasOpen = questions.some((q) => q.type === 'open');

    if (questions.length === 0) {
      return (
        `✅ *"${escMd(session.testName)}" testiga qo'shildingiz\\!*\n\n` +
        `⏳ O'qituvchi hali javoblarni kiritgani yo'q\\. ` +
        `Kutib turing, so'ng /yuborish buyrug'ini yuboring\\.`
      );
    }

    if (session.status !== 'ACTIVE') {
      return (
        `✅ *"${escMd(session.testName)}" testiga qo'shildingiz\\.*\n\n` +
        `⏹ Lekin test allaqachon yakunlangan — javob topshirib bo'lmaydi\\.`
      );
    }

    const openHint = hasOpen
      ? `\n\nBu testda *ochiq javobli* savollar ham bor \\(${questions.filter((q) => q.type === 'open').length} ta\\)\\.\n` +
        `Ularga javobni to'liq yozing: \`3\\-18/60\`, \`4\\-20x\`\n` +
        `Javob ichida bo'shliq bo'lsa \`\\|\` bilan ajrating: \`3\\-18 / 60 \\| 4\\-20 x\``
      : '';

    return (
      `✅ *"${escMd(session.testName)}" testiga qo'shildingiz\\!*\n\n` +
      `📝 Savollar soni: *${questions.length} ta*\n\n` +
      `Javoblaringizni quyidagicha yuboring:\n` +
      `\`/yuborish 1\\-A 2\\-B 3\\-18/60\`` +
      openHint +
      `\n\n_Barcha javoblarni bitta xabarda yuboring\\._`
    );
  }

  /**
   * Sent to each student personally when the teacher sends out the results.
   * Shows every answer with ✅ / ❌ and reveals the correct option for wrong answers.
   */
  static detailedStudentResult(result: StudentResult, session: Session): string {
    const questions = sortedQuestions(session);
    const percentage =
      result.maxScore > 0
        ? Math.round((result.score / result.maxScore) * 100)
        : 0;

    return (
      `📋 *"${escMd(session.testName)}" testi yakunlandi*\n\n` +
      `👤 *${escMd(result.fullName)}*\n\n` +
      `*Javoblaringiz:*\n` +
      `${answerLines(questions, result).join('\n')}\n\n` +
      `✅ To'g'ri: *${result.correctCount}*\n` +
      `❌ Noto'g'ri: *${result.wrongCount}*\n` +
      `⬜ Javob berilmagan: *${result.missingCount}*\n\n` +
      `🎯 Ball: *${result.score} / ${result.maxScore}* \\(${percentage}%\\)\n` +
      `${grade(percentage)}`
    );
  }

  /** Javob topshirilgandan keyin darhol yuboriladi (natija hali yashirin) */
  static submissionResult(result: StudentResult, session: Session): string {
    const answered = Object.keys(result.answers).length;
    const total = Object.keys(session.questions).length;

    return (
      `✅ *Javoblaringiz qabul qilindi\\!*\n\n` +
      `📝 Belgilangan: *${answered} / ${total}* savol\n` +
      (result.missingCount > 0
        ? `⬜ Javobsiz qolgan: *${result.missingCount}* ta\n`
        : '') +
      `\n⏳ Natijangiz o'qituvchi tekshiruvidan so'ng yuboriladi\\.\n\n` +
      `_Xatolikni sezsangiz, javoblarni qayta yuborishingiz mumkin — ` +
      `oxirgi urinish hisobga olinadi\\._`
    );
  }

  /** Yuborilgan javoblarning takrorlanishi (talaba tekshirishi uchun) */
  static submissionEcho(result: StudentResult, session: Session): string {
    const questions = sortedQuestions(session);
    const lines = questions.map((q) => {
      const given = result.answers[q.number];
      return given === undefined || given === ''
        ? `${q.number}\\-⬜`
        : `${q.number}\\-${escMd(given)}`;
    });

    const rows: string[] = [];
    for (let i = 0; i < lines.length; i += 5) {
      rows.push(lines.slice(i, i + 5).join('  '));
    }

    return `📄 *Sizning javoblaringiz:*\n${rows.join('\n')}`;
  }

  static studentHelp(): string {
    return (
      `📖 *Test topshirish tartibi*\n\n` +
      `1\\. /start yuboring va to'liq ismingizni kiriting\n` +
      `2\\. \`/qoshil <sessiya\\_id>\` — testga qo'shiling\n` +
      `3\\. \`/yuborish 1\\-A 2\\-B 3\\-18/60\` — javoblarni yuboring\n\n` +
      `*Javob formati:*\n` +
      `• Variantli savol: savol raqami \\+ tire \\+ harf \\(A–E\\)\n` +
      `  Misol: \`1\\-A 2\\-C\`\n` +
      `• Ochiq savol: savol raqami \\+ tire \\+ javobning o'zi\n` +
      `  Misol: \`3\\-18/60 4\\-20x\`\n\n` +
      `*Javob ichida bo'shliq bo'lsa* — javoblarni \`\\|\` bilan ajrating:\n` +
      `\`1\\-A \\| 2\\-C \\| 3\\-18 / 60\`\n` +
      `yoki har bir javobni yangi qatorga yozing\\.\n\n` +
      `/javob\\_format — barcha formatlar \\(uz / ru / en\\)\n` +
      `/til — tilni tanlash`
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

// ─── Ichki yordamchilar ─────────────────────────────────────────────────────────

function sortedQuestions(session: Session): QuestionKey[] {
  return Object.values(session.questions).sort((a, b) => a.number - b.number);
}

/**
 * Har bir savol uchun natija qatorlari.
 * Variantli savollar 5 tadan bir qatorga, ochiq savollar alohida qatorga
 * chiqadi (javob matni uzun bo'lishi mumkin).
 */
function answerLines(questions: QuestionKey[], result: StudentResult): string[] {
  const compact: string[] = [];
  const lines: string[] = [];

  const flush = () => {
    for (let i = 0; i < compact.length; i += 5) {
      lines.push(compact.slice(i, i + 5).join('  '));
    }
    compact.length = 0;
  };

  for (const q of questions) {
    const given = result.answers[q.number];
    const verdict = result.verdicts[q.number];

    if (q.type === 'variant') {
      if (verdict === 'missing' || given === undefined) {
        compact.push(`${q.number}\\-⬜`);
      } else if (verdict === 'correct') {
        compact.push(`${q.number}\\-${escMd(given)} ✅`);
      } else {
        compact.push(`${q.number}\\-${escMd(given)} ❌\\(${escMd(q.answer)}\\)`);
      }
      continue;
    }

    // Ochiq savol — alohida qator
    flush();
    if (verdict === 'missing' || given === undefined) {
      lines.push(`${q.number}\\. ⬜ _javob berilmagan_ \\(${escMd(q.answer)}\\)`);
    } else if (verdict === 'correct') {
      lines.push(`${q.number}\\. ${escMd(given)} ✅`);
    } else if (verdict === 'wrong') {
      lines.push(`${q.number}\\. ${escMd(given)} ❌ → *${escMd(q.answer)}*`);
    } else {
      lines.push(`${q.number}\\. ${escMd(given)} ⏳ _tekshirilmoqda_`);
    }
  }

  flush();
  return lines;
}

function grade(percentage: number): string {
  return percentage >= 90 ? '🏆 A\'lo\\!'
    : percentage >= 75 ? '✨ Yaxshi\\!'
    : percentage >= 60 ? '👍 Qoniqarli'
    : percentage >= 40 ? '📚 Ko\'proq o\'qing'
    : '❗ Qoniqarsiz';
}

/** Telegram MarkdownV2 uchun maxsus belgilarni ekranlaydi */
export function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
