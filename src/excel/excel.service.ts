import { Injectable, Logger } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import {
  Session,
  QuestionKey,
  ManualGrade,
  StudentResult,
} from "../session/interfaces/session.interface";
import { TestSessionService } from "../session/session.service";

/** Baholash varag'idagi ustun sarlavhalari — qaytib o'qishda shu nomlar izlanadi */
const GRADE_SHEET = "Baholash";
const COL_STUDENT = "Talaba";
const COL_USER_ID = "ID";
const COL_QUESTION_NO = "Savol";
const COL_QUESTION_TEXT = "Savol matni";
const COL_EXPECTED = "To'g'ri javob";
const COL_GIVEN = "Talaba javobi";
const COL_VERDICT = "To'g'rimi? (1/0)";

@Injectable()
export class ExcelService {
  private readonly logger = new Logger(ExcelService.name);

  // ══ 1. Kalitni Exceldan o'qish ═════════════════════════════════════════════

  /**
   * O'qituvchi yuklagan kalit faylini o'qiydi.
   * Ustunlar: 1) savol (raqam yoki matn) 2) turi 3) to'g'ri javob
   */
  async parseAnswerKey(buffer: Buffer): Promise<QuestionKey[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);

    const ws = wb.worksheets[0];
    if (!ws) throw new Error("Excel faylida varaq topilmadi.");

    const questions: QuestionKey[] = [];
    const seen = new Set<number>();
    let counter = 0;

    ws.eachRow((row, rowNumber) => {
      const first = this.cellText(row.getCell(1));
      const second = this.cellText(row.getCell(2));
      const third = this.cellText(row.getCell(3));

      // Bo'sh qatorlarni o'tkazib yuborish
      if (!first && !second && !third) return;

      // Sarlavha qatorini o'tkazib yuborish
      if (rowNumber === 1 && this.looksLikeHeader(first, second, third)) return;

      const answer = third;
      if (!answer) {
        throw new Error(
          `${rowNumber}-qatorda to'g'ri javob (3-ustun) bo'sh. ` +
          `Ustunlar: savol | turi | to'g'ri javob`,
        );
      }

      const type = this.parseQuestionType(second, answer);

      // Savol raqami: 1-ustun raqam bo'lsa o'sha, aks holda tartib bo'yicha
      const parsed = parseInt(first, 10);
      const isNumber = /^\d+$/.test(first.trim());
      const number = isNumber ? parsed : ++counter;
      if (isNumber) counter = Math.max(counter, number);

      if (seen.has(number)) {
        throw new Error(`${number}-savol Excel faylida ikki marta uchradi.`);
      }
      seen.add(number);

      if (type === "variant" && !/^[A-Ea-e]$/.test(answer.trim())) {
        throw new Error(
          `${number}-savol "variant" turida, lekin javobi "${answer}". ` +
          `Variantli savolda javob A–E harflaridan biri bo'lishi kerak, ` +
          `yoki turini "ochiq" deb belgilang.`,
        );
      }

      questions.push({
        number,
        type,
        answer: type === "variant" ? answer.trim().toUpperCase() : answer.trim(),
        text: isNumber ? undefined : first || undefined,
      });
    });

    if (questions.length === 0) {
      throw new Error(
        "Excel faylida savollar topilmadi.\n\n" +
        "Ustunlar tartibi: 1) savol 2) turi (variant / ochiq) 3) to'g'ri javob\n" +
        "Namuna olish uchun /namuna buyrug'ini yuboring.",
      );
    }

    questions.sort((a, b) => a.number - b.number);
    this.logger.log(
      `Kalit o'qildi: ${questions.length} ta savol ` +
      `(${questions.filter((q) => q.type === "open").length} ta ochiq).`,
    );
    return questions;
  }

  /** O'qituvchiga yuboriladigan namuna kalit fayli */
  async generateKeyTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Telegram Test Bot";

    const ws = wb.addWorksheet("Kalit");
    ws.columns = [
      { header: "Savol", key: "q", width: 42 },
      { header: "Turi", key: "type", width: 14 },
      { header: "To'g'ri javob", key: "answer", width: 24 },
    ];
    this.styleHeader(ws.getRow(1));

    const samples = [
      ["1", "variant", "A"],
      ["2", "variant", "C"],
      ["3", "ochiq", "18/60"],
      ["4", "ochiq", "20x"],
      ["Suvning qaynash harorati necha daraja?", "ochiq", "100"],
    ];
    samples.forEach((r) => ws.addRow(r));

    const help = wb.addWorksheet("Yo'riqnoma");
    help.columns = [{ width: 18 }, { width: 76 }];
    const lines: [string, string][] = [
      ["Ustun 1 — Savol", "Savol raqami (1, 2, 3...) yoki savol matni. Matn yozilsa raqam tartib bo'yicha beriladi."],
      ["Ustun 2 — Turi", "\"variant\" — javob A–E harflaridan biri, bot o'zi tekshiradi."],
      ["", "\"ochiq\" — erkin javob (18/60, 20x, 100). Botni o'zingiz tasdiqlaysiz."],
      ["", "Bo'sh qoldirilsa: javob bitta harf bo'lsa variant, aks holda ochiq deb olinadi."],
      ["Ustun 3 — Javob", "To'g'ri javob. Variant uchun A–E, ochiq uchun erkin matn."],
      ["", ""],
      ["Jarayon", "1. Bu faylni to'ldiring va botga yuboring (yoki /javoblar 1-A 2-B ... yozing)."],
      ["", "2. Talabalar javob topshiradi."],
      ["", "3. /yakunla — topshirish to'xtaydi, bot sizga baholash faylini yuboradi."],
      ["", "4. Ochiq javoblarni 1 (to'g'ri) yoki 0 (xato) deb belgilab, faylni botga qaytaring."],
      ["", "5. /natijalarni_yubor — natijalar talabalarga yuboriladi va test yopiladi."],
    ];
    lines.forEach(([a, b]) => {
      const row = help.addRow([a, b]);
      row.getCell(1).font = { bold: true };
      row.getCell(2).alignment = { wrapText: true };
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ══ 2. Baholash fayli (oraliq qadam) ═══════════════════════════════════════

  /**
   * /yakunla dan keyin o'qituvchiga yuboriladigan fayl.
   * "Baholash" varag'ida har bir ochiq javob alohida qator — o'qituvchi
   * oxirgi ustunga 1 yoki 0 qo'yadi va faylni botga qaytaradi.
   */
  async generateGradingWorkbook(session: Session): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Telegram Test Bot";
    wb.created = new Date();

    const questions = TestSessionService.sortedQuestions(session);
    const openQuestions = questions.filter((q) => q.type === "open");
    const students = [...session.students.values()].sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    );

    // ── Baholash varag'i ────────────────────────────────────────────────────
    const ws = wb.addWorksheet(GRADE_SHEET, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = [
      { header: COL_STUDENT, key: "student", width: 26 },
      { header: COL_USER_ID, key: "userId", width: 14 },
      { header: COL_QUESTION_NO, key: "qno", width: 8 },
      { header: COL_QUESTION_TEXT, key: "qtext", width: 34 },
      { header: COL_EXPECTED, key: "expected", width: 22 },
      { header: COL_GIVEN, key: "given", width: 22 },
      { header: COL_VERDICT, key: "verdict", width: 16 },
    ];
    this.styleHeader(ws.getRow(1));

    let rowCount = 0;
    for (const student of students) {
      for (const q of openQuestions) {
        const given = student.answers[q.number];
        if (given === undefined || given === "") continue; // javob bermagan — baholanmaydi

        const current = student.verdicts[q.number];
        const suggestion =
          current === "correct" ? 1
          : current === "wrong" ? 0
          : TestSessionService.guessOpen(given, q.answer) ? 1
          : 0;

        const row = ws.addRow({
          student: student.fullName,
          userId: student.userId,
          qno: q.number,
          qtext: q.text ?? "",
          expected: q.answer,
          given,
          verdict: suggestion,
        });

        // Bot taxminini ajratib ko'rsatish: mos kelmaganini sariq qilamiz
        if (suggestion === 0) {
          row.getCell("verdict").fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFF2CC" },
          };
        }
        row.getCell("verdict").alignment = { horizontal: "center" };
        row.getCell("verdict").font = { bold: true };
        row.getCell("userId").font = { color: { argb: "FF999999" } };
        rowCount++;
      }
    }

    if (rowCount === 0) {
      ws.addRow({
        student: openQuestions.length === 0
          ? "Bu testda ochiq javobli savol yo'q — baholash shart emas."
          : "Ochiq savollarga hech kim javob bermagan.",
      });
    } else {
      // 1 / 0 uchun ochiladigan ro'yxat
      for (let i = 2; i <= rowCount + 1; i++) {
        ws.getCell(`G${i}`).dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: ['"1,0"'],
          showErrorMessage: true,
          errorTitle: "Faqat 1 yoki 0",
          error: "1 = to'g'ri, 0 = xato",
        };
      }
    }

    // ── Yo'riqnoma ──────────────────────────────────────────────────────────
    const help = wb.addWorksheet("Yo'riqnoma");
    help.columns = [{ width: 90 }];
    [
      `Test: ${session.testName}  (ID: ${session.sessionId})`,
      "",
      `1. "${GRADE_SHEET}" varag'idagi "${COL_VERDICT}" ustunini to'ldiring.`,
      "   1 = to'g'ri javob,  0 = xato javob.",
      "2. Bot allaqachon taxminiy baho qo'ygan — faqat noto'g'risini tuzating.",
      "   Sariq katakchalar = bot javobni mos kelmadi deb hisobladi, tekshirib chiqing.",
      "3. Boshqa ustunlarni (ayniqsa ID ustunini) o'zgartirmang va qatorlarni o'chirmang.",
      "4. Faylni saqlang va shu botga qaytaring.",
      "5. So'ng /natijalarni_yubor buyrug'ini yuboring — natijalar talabalarga boradi.",
      "",
      "Variantli (A–E) savollar bot tomonidan avtomatik tekshirilgan —",
      "ular bu varaqda ko'rsatilmaydi.",
    ].forEach((line) => help.addRow([line]));

    // ── Joriy holat (ma'lumot uchun) ───────────────────────────────────────
    this.addResultsSheet(wb, session, "Joriy natijalar");
    this.addAnswersSheet(wb, session);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    this.logger.log(
      `Baholash fayli tayyorlandi (${session.sessionId}): ` +
      `${rowCount} ta ochiq javob, ${students.length} ta talaba.`,
    );
    return buffer;
  }

  /**
   * O'qituvchi qaytargan baholash faylini o'qiydi.
   * ID + savol raqami bo'yicha moslashtiradi, ustun tartibi o'zgarsa ham ishlaydi.
   */
  async parseGradedWorkbook(buffer: Buffer): Promise<ManualGrade[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);

    const ws =
      wb.getWorksheet(GRADE_SHEET) ??
      wb.worksheets.find((sheet) => this.hasGradingHeaders(sheet));

    if (!ws) {
      throw new Error(
        `Faylda "${GRADE_SHEET}" varag'i topilmadi.\n\n` +
        `Bot yuborgan faylni tahrirlab, o'sha faylni qaytaring.`,
      );
    }

    const headerRow = ws.getRow(1);
    const col = this.locateColumns(headerRow);

    if (!col.userId || !col.qno || !col.verdict) {
      throw new Error(
        `Faylning sarlavha qatori buzilgan ("${COL_USER_ID}", "${COL_QUESTION_NO}", ` +
        `"${COL_VERDICT}" ustunlari topilmadi). Bot yuborgan faylni ishlating.`,
      );
    }

    const grades: ManualGrade[] = [];
    const invalid: number[] = [];

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const userId = parseInt(this.cellText(row.getCell(col.userId!)), 10);
      const question = parseInt(this.cellText(row.getCell(col.qno!)), 10);
      if (isNaN(userId) || isNaN(question)) return;

      const verdict = this.parseVerdict(this.cellText(row.getCell(col.verdict!)));
      if (verdict === null) {
        invalid.push(rowNumber);
        return;
      }

      grades.push({ userId, question, correct: verdict });
    });

    if (invalid.length > 0) {
      const preview = invalid.slice(0, 10).join(", ");
      throw new Error(
        `Quyidagi qatorlarda "${COL_VERDICT}" ustuni to'ldirilmagan yoki noto'g'ri: ` +
        `${preview}${invalid.length > 10 ? " ..." : ""}\n\n` +
        `Har bir qatorga 1 (to'g'ri) yoki 0 (xato) yozing va faylni qayta yuboring.`,
      );
    }

    if (grades.length === 0) {
      throw new Error(
        `Faylda baholanadigan qator topilmadi. Bot yuborgan faylni ishlating.`,
      );
    }

    this.logger.log(`Baholash fayli o'qildi: ${grades.length} ta baho.`);
    return grades;
  }

  // ══ 3. Yakuniy natijalar ═══════════════════════════════════════════════════

  /**
   * Generates an in-memory Excel workbook for a completed test session.
   * Returns a Buffer ready to be sent as a Telegram document.
   */
  async generateResultsBuffer(session: Session): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Telegram Test Bot";
    wb.created = new Date();

    this.addResultsSheet(wb, session, "Natijalar");
    this.addAnswersSheet(wb, session);
    this.addKeySheet(wb, session);
    this.addSummarySheet(wb, session);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    this.logger.log(
      `Excel generated for session ${session.sessionId}: ` +
      `${session.students.size} rows, ${buffer.length} bytes`,
    );
    return buffer;
  }

  // ══ Varaqlar ═══════════════════════════════════════════════════════════════

  private addResultsSheet(wb: ExcelJS.Workbook, session: Session, name: string) {
    const ws = wb.addWorksheet(name, {
      pageSetup: { fitToPage: true, orientation: "landscape" },
      views: [{ state: "frozen", ySplit: 1 }],
    });

    ws.columns = [
      { header: "F.I.SH", key: "fullName", width: 28 },
      { header: "Username", key: "username", width: 18 },
      { header: "Telegram ID", key: "userId", width: 14 },
      { header: "Ball", key: "score", width: 10 },
      { header: "Maksimal ball", key: "maxScore", width: 14 },
      { header: "%", key: "percent", width: 8 },
      { header: "To'g'ri", key: "correctCount", width: 9 },
      { header: "Xato", key: "wrongCount", width: 9 },
      { header: "Belgilanmagan", key: "missingCount", width: 14 },
      { header: "Tekshirilmagan", key: "pendingCount", width: 15 },
      { header: "Topshirilgan javoblar", key: "rawAnswers", width: 45 },
      { header: "Topshirilgan vaqt", key: "submittedAt", width: 22 },
    ];
    this.styleHeader(ws.getRow(1));

    const students = [...session.students.values()].sort((a, b) => b.score - a.score);

    students.forEach((r, idx) => {
      const percent = r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0;

      const row = ws.addRow({
        fullName: r.fullName,
        username: r.username ? `@${r.username}` : "—",
        userId: r.userId,
        score: r.score,
        maxScore: r.maxScore,
        percent: `${percent}%`,
        correctCount: r.correctCount,
        wrongCount: r.wrongCount,
        missingCount: r.missingCount,
        pendingCount: r.pendingCount,
        rawAnswers: r.rawAnswers,
        submittedAt: new Date(r.submittedAt).toLocaleString("en-GB"),
      });

      if (idx % 2 === 1) {
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F2F2" },
        };
      }

      // Tekshirilmagan ochiq javoblar qolgan bo'lsa — diqqatni tortamiz
      if (r.pendingCount > 0) {
        row.getCell("pendingCount").fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF2CC" },
        };
        row.getCell("pendingCount").font = { bold: true };
      }

      row.alignment = { vertical: "middle" };
    });
  }

  /** Har bir savol bo'yicha javoblar matritsasi */
  private addAnswersSheet(wb: ExcelJS.Workbook, session: Session) {
    const questions = TestSessionService.sortedQuestions(session);
    if (questions.length === 0) return;

    const ws = wb.addWorksheet("Javoblar", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
    });

    // 1-qator: to'g'ri javob, 2-qator: savol raqami
    const keyRow = ws.addRow([
      "To'g'ri javob →",
      ...questions.map((q) => q.answer),
    ]);
    keyRow.font = { italic: true, color: { argb: "FF1F7A1F" } };

    const headerRow = ws.addRow([
      "F.I.SH",
      ...questions.map((q) => `${q.number}${q.type === "open" ? "*" : ""}`),
    ]);
    this.styleHeader(headerRow);

    ws.getColumn(1).width = 28;
    for (let i = 2; i <= questions.length + 1; i++) ws.getColumn(i).width = 12;

    const students = [...session.students.values()].sort((a, b) => b.score - a.score);

    for (const student of students) {
      const row = ws.addRow([
        student.fullName,
        ...questions.map((q) => {
          const given = student.answers[q.number];
          return given === undefined || given === "" ? "—" : given;
        }),
      ]);

      questions.forEach((q, i) => {
        const cell = row.getCell(i + 2);
        const verdict = student.verdicts[q.number];
        const color =
          verdict === "correct" ? "FFD7F0D7"
          : verdict === "wrong" ? "FFF8D0D0"
          : verdict === "pending" ? "FFFFF2CC"
          : "FFEFEFEF";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
        cell.alignment = { horizontal: "center" };
      });
    }

    ws.addRow([]);
    ws.addRow(["* — ochiq javobli savol"]).font = { italic: true, size: 9 };
    ws.addRow(["Yashil = to'g'ri, qizil = xato, sariq = tekshirilmagan, kulrang = javob yo'q"])
      .font = { italic: true, size: 9 };
  }

  private addKeySheet(wb: ExcelJS.Workbook, session: Session) {
    const questions = TestSessionService.sortedQuestions(session);
    if (questions.length === 0) return;

    const ws = wb.addWorksheet("Kalit");
    ws.columns = [
      { header: "Savol", key: "no", width: 8 },
      { header: "Turi", key: "type", width: 12 },
      { header: "To'g'ri javob", key: "answer", width: 24 },
      { header: "Savol matni", key: "text", width: 42 },
    ];
    this.styleHeader(ws.getRow(1));

    for (const q of questions) {
      ws.addRow({
        no: q.number,
        type: q.type === "open" ? "ochiq" : "variant",
        answer: q.answer,
        text: q.text ?? "",
      });
    }
  }

  private addSummarySheet(wb: ExcelJS.Workbook, session: Session) {
    const ws = wb.addWorksheet("Xulosa");
    const students = [...session.students.values()];
    const total = students.length;
    const avgScore = total > 0 ? students.reduce((s, r) => s + r.score, 0) / total : 0;
    const questions = TestSessionService.sortedQuestions(session);
    const maxPossible = questions.length * session.scoring.pointsPerCorrect;

    const rows: [string, string | number][] = [
      ["Test nomi", session.testName],
      ["Sessiya ID", session.sessionId],
      ["Yaratilgan", session.createdAt.toLocaleString("en-GB")],
      ["Yakunlangan", new Date().toLocaleString("en-GB")],
      ["Savollar soni", questions.length],
      ["  — variantli", questions.filter((q) => q.type === "variant").length],
      ["  — ochiq javobli", questions.filter((q) => q.type === "open").length],
      ["Talabalar soni", total],
      ["O'rtacha ball", Number(avgScore.toFixed(2))],
      ["Maksimal ball", maxPossible],
      [
        "Baholash",
        `+${session.scoring.pointsPerCorrect} to'g'ri / -${session.scoring.pointsPerWrong} xato`,
      ],
    ];

    rows.forEach(([a, b]) => {
      const row = ws.addRow([a, b]);
      row.getCell(1).font = { bold: true };
    });

    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 36;
  }

  // ══ Yordamchilar ═══════════════════════════════════════════════════════════

  private styleHeader(row: ExcelJS.Row) {
    row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    row.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.height = 22;
  }

  /** Katak qiymatini matnga aylantiradi (formula, rich text, sana...) */
  private cellText(cell: ExcelJS.Cell): string {
    const value = cell?.value;
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
      const v = value as any;
      if ("text" in v && typeof v.text === "string") return v.text.trim();
      if ("result" in v) return String(v.result ?? "").trim();
      if ("richText" in v && Array.isArray(v.richText)) {
        return v.richText.map((p: any) => p.text).join("").trim();
      }
      if ("hyperlink" in v && "text" in v) return String(v.text).trim();
    }
    return String(value).trim();
  }

  private looksLikeHeader(...cells: string[]): boolean {
    const joined = cells.join(" ").toLowerCase();
    return /savol|question|tur|type|javob|answer|№/.test(joined);
  }

  /** "ochiq" / "variant" ni aniqlaydi; bo'sh bo'lsa javobning o'zidan taxmin qiladi */
  private parseQuestionType(raw: string, answer: string): "variant" | "open" {
    const value = raw.trim().toLowerCase();

    if (!value) {
      return /^[A-Ea-e]$/.test(answer.trim()) ? "variant" : "open";
    }
    if (/ochiq|open|matn|erkin|yozma|free|text/.test(value)) return "open";
    if (/variant|test|tanlov|yopiq|closed|choice|abcd/.test(value)) return "variant";

    // Tanib bo'lmadi — javobning shakliga qaraymiz
    return /^[A-Ea-e]$/.test(answer.trim()) ? "variant" : "open";
  }

  /** 1/0, ha/yo'q, +/-, true/false, ✅/❌ — hammasini tushunadi */
  private parseVerdict(raw: string): boolean | null {
    const value = raw.trim().toLowerCase();
    if (!value) return null;

    if (/^(1|1\.0|true|ha|yes|y|t|to'g'ri|tog'ri|togri|to‘g‘ri|\+|✅|✔|v)$/.test(value)) {
      return true;
    }
    if (/^(0|0\.0|false|yo'q|yoq|yo‘q|no|n|x|xato|noto'g'ri|notogri|-|❌|✖)$/.test(value)) {
      return false;
    }
    return null;
  }

  private hasGradingHeaders(ws: ExcelJS.Worksheet): boolean {
    const col = this.locateColumns(ws.getRow(1));
    return Boolean(col.userId && col.qno && col.verdict);
  }

  /** Sarlavha qatoridan kerakli ustunlar indeksini topadi */
  private locateColumns(headerRow: ExcelJS.Row): {
    userId?: number;
    qno?: number;
    verdict?: number;
  } {
    const result: { userId?: number; qno?: number; verdict?: number } = {};

    headerRow.eachCell((cell, colNumber) => {
      const title = this.cellText(cell).toLowerCase();
      if (!title) return;

      if (!result.userId && /^(id|telegram id|user ?id)$/.test(title)) {
        result.userId = colNumber;
      } else if (!result.qno && /^savol( ?№| raqami)?$/.test(title)) {
        result.qno = colNumber;
      } else if (!result.verdict && /to'g'rimi|togrimi|to‘g‘rimi|baho|verdict|1\/0/.test(title)) {
        result.verdict = colNumber;
      }
    });

    return result;
  }
}
