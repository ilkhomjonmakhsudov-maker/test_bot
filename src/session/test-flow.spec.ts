import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestSessionService } from './session.service';
import { ExcelService } from '../excel/excel.service';
import { MessageBuilder } from '../bot/message-builder';
import { QuestionKey } from './interfaces/session.interface';

/**
 * Test o'tkazish oqimining to'liq tekshiruvi:
 * kalit (matn/Excel) → javob topshirish → /yakunla → qo'lda baholash → yakunlash.
 */

const TEACHER = 100;

let dataDir: string;
let sessions: TestSessionService;
let excel: ExcelService;

const makeService = () => {
  const config: any = {
    get: (key: string, def?: any) =>
      key === 'app.sessionDataPath' ? dataDir
      : key === 'app.sessionTtlMinutes' ? 0
      : def,
  };
  const service = new TestSessionService(config);
  service.onModuleInit();
  return service;
};

/** Kalit faylini yasaydi: har bir qator [savol, turi, javob] */
const keyWorkbook = async (rows: any[][], header = true): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kalit');
  if (header) ws.addRow(['Savol', 'Turi', "To'g'ri javob"]);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const MIXED: QuestionKey[] = [
  { number: 1, type: 'variant', answer: 'A' },
  { number: 2, type: 'variant', answer: 'C' },
  { number: 3, type: 'open', answer: '18/60' },
  { number: 4, type: 'open', answer: '20x' },
];

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testbot-'));
  sessions = makeService();
  excel = new ExcelService();
});

afterEach(() => {
  sessions.onModuleDestroy();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Kalitni kiritish', () => {
  it('matn orqali faqat variantli savollarni qabul qiladi', () => {
    sessions.createSession(TEACHER, 'Test');
    const questions = sessions.setAnswers(TEACHER, '1-A 2-b 3-C');

    expect(Object.keys(questions)).toHaveLength(3);
    expect(questions[2]).toEqual({ number: 2, type: 'variant', answer: 'B' });
  });

  it('matn orqali quvur (|) bilan ajratilgan kalitni qabul qiladi', () => {
    sessions.createSession(TEACHER, 'Test');
    const questions = sessions.setAnswers(TEACHER, '1-A | 2-B | 3-C');

    expect(Object.keys(questions)).toHaveLength(3);
    expect(questions[3].answer).toBe('C');
  });

  it('matn orqali ochiq javob kiritilsa, Excelga yo\'naltiradi', () => {
    sessions.createSession(TEACHER, 'Test');
    expect(() => sessions.setAnswers(TEACHER, '1-A 2-18/60')).toThrow(/Excel/);
  });

  it('Exceldan aralash turdagi savollarni o\'qiydi', async () => {
    const questions = await excel.parseAnswerKey(
      await keyWorkbook([
        [1, 'variant', 'A'],
        [2, 'ochiq', '18/60'],
        [3, 'open', '20x'],
      ]),
    );

    expect(questions).toHaveLength(3);
    expect(questions[1].type).toBe('open');
    expect(questions[2].type).toBe('open');
  });

  it('turi ko\'rsatilmasa javobning shaklidan aniqlaydi', async () => {
    const questions = await excel.parseAnswerKey(
      await keyWorkbook([
        [1, '', 'B'],       // bitta harf → variant
        [2, '', '100'],     // raqam → ochiq
      ]),
    );

    expect(questions[0].type).toBe('variant');
    expect(questions[1].type).toBe('open');
  });

  it('savol matni yozilsa raqamni tartib bo\'yicha beradi', async () => {
    const questions = await excel.parseAnswerKey(
      await keyWorkbook([
        ['Suvning qaynash harorati?', 'ochiq', '100'],
        ['Eng katta sayyora?', 'ochiq', 'Yupiter'],
      ]),
    );

    expect(questions[0]).toMatchObject({ number: 1, text: 'Suvning qaynash harorati?' });
    expect(questions[1].number).toBe(2);
  });

  it('variantli savolga harf bo\'lmagan javob berilsa xato qaytaradi', async () => {
    await expect(
      excel.parseAnswerKey(await keyWorkbook([[1, 'variant', '18/60']])),
    ).rejects.toThrow(/ochiq/);
  });

  it('takrorlangan savol raqamini rad etadi', async () => {
    await expect(
      excel.parseAnswerKey(await keyWorkbook([[1, 'variant', 'A'], [1, 'variant', 'B']])),
    ).rejects.toThrow(/ikki marta/);
  });

  it('bo\'sh faylni rad etadi', async () => {
    await expect(excel.parseAnswerKey(await keyWorkbook([]))).rejects.toThrow(/topilmadi/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Talaba javoblarini ajratish', () => {
  let sid: string;

  beforeEach(() => {
    sid = sessions.createSession(TEACHER, 'Test').sessionId;
    sessions.setQuestions(TEACHER, MIXED);
  });

  const submit = (raw: string) => sessions.submitAnswers(sid, 1, 'Talaba', 'u', raw);

  it.each([
    ['bir qatorda', '1-A 2-C 3-18/60 4-20x'],
    ['nuqta bilan', '1. A 2. C 3. 18/60 4. 20x'],
    ['qavs bilan', '1) A 2) C 3) 18/60 4) 20x'],
    ['uzun tire bilan', '1—A 2—C 3—18/60 4—20x'],
    ['har biri yangi qatorda', '1-A\n2-C\n3-18/60\n4-20x'],
    ['quvur (|) bilan', '1-A | 2-C | 3-18/60 | 4-20x'],
    ['quvur, bo\'shliqsiz', '1-A|2-C|3-18/60|4-20x'],
    ['aralash: quvur + bo\'shliq', '1-A 2-C | 3-18/60 4-20x'],
  ])('%s formatini tushunadi', (_label, raw) => {
    expect(submit(raw).answers).toEqual({ 1: 'A', 2: 'C', 3: '18/60', 4: '20x' });
  });

  it('quvur bilan ajratilganda ochiq javob bo\'shliqli bo\'lishi mumkin', () => {
    expect(submit('1-A | 2-C | 3-18 / 60 | 4-20 x').answers).toEqual({
      1: 'A', 2: 'C', 3: '18 / 60', 4: '20 x',
    });
  });

  it('quvur ochiq javobdagi raqam chalkashligini yechadi', () => {
    // Bo'shliqsiz "3-18/604-20x" noaniq — quvur bilan aniq bo'ladi
    expect(submit('1-A|2-C|3-18/60|4-20x').answers[3]).toBe('18/60');
  });

  it('ortiqcha quvurlarga chidamli', () => {
    expect(submit('| 1-A || 2-C | | 3-x | 4-y |').answers[1]).toBe('A');
  });

  it('ochiq javob ichidagi bo\'shliqni saqlaydi', () => {
    expect(submit('1-A 2-C 3-18 / 60 4-20x').answers[3]).toBe('18 / 60');
  });

  it('kichik harfni katta harfga aylantiradi', () => {
    expect(submit('1-a 2-c 3-x 4-y').answers[1]).toBe('A');
  });

  it('javob berilmagan savolni "missing" deb belgilaydi', () => {
    const result = submit('1-A');
    expect(result.missingCount).toBe(3);
    expect(result.verdicts[3]).toBe('missing');
  });

  it('mavjud bo\'lmagan savol raqamini rad etadi', () => {
    expect(() => submit('1-A 9-B')).toThrow(/Bunday savol yo'q/);
  });

  it('variantli savolga uzun javobni rad etadi', () => {
    expect(() => submit('1-ABC')).toThrow(/bitta harf/);
  });

  it('javobsiz qoldirilgan markerni rad etadi', () => {
    expect(() => submit('1-A 2- 3-x')).toThrow(/javob yozilmagan/);
  });

  it('javoblar oldidagi begona matnni rad etadi', () => {
    expect(() => submit('salom 1-A')).toThrow(/tushunilmadi/);
  });

  it('faqat variantli testda bo\'shliqsiz formatni qabul qiladi', () => {
    const s = sessions.createSession(200, 'Variant');
    sessions.setAnswers(200, '1-A 2-B 3-C');
    expect(sessions.submitAnswers(s.sessionId, 2, 'T', 'u', '1-A2-B3-C').correctCount).toBe(3);
  });

  it('ochiq savolli testda bo\'shliqsiz format noaniq — rad etiladi', () => {
    expect(() => submit('1-A2-C3-18/60')).toThrow(/bitta harf/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Baholash', () => {
  let sid: string;

  beforeEach(() => {
    sid = sessions.createSession(TEACHER, 'Test').sessionId;
    sessions.setQuestions(TEACHER, MIXED);
    sessions.setScoring(TEACHER, { pointsPerCorrect: 2, pointsPerWrong: 0.5 });
  });

  it('variantli savollarni avtomatik, ochiqlarni "pending" qiladi', () => {
    const r = sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-A 2-B 3-18/60 4-20x');

    expect(r.verdicts[1]).toBe('correct');
    expect(r.verdicts[2]).toBe('wrong');
    expect(r.verdicts[3]).toBe('pending');
    expect(r.pendingCount).toBe(2);
  });

  it('ball to\'g\'ri va xato javoblardan hisoblanadi', () => {
    const r = sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-A 2-B 3-18/60 4-20x');
    sessions.applyManualGrades(TEACHER, [
      { userId: 1, question: 3, correct: true },
      { userId: 1, question: 4, correct: true },
    ]);

    // 3 to'g'ri × 2 = 6, 1 xato × 0.5 = 0.5 → 5.5
    expect(r.score).toBe(5.5);
    expect(r.maxScore).toBe(8);
  });

  it('ball hech qachon manfiy bo\'lmaydi', () => {
    sessions.setScoring(TEACHER, { pointsPerCorrect: 1, pointsPerWrong: 5 });
    const r = sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-B 2-B 3-x 4-y');
    sessions.applyManualGrades(TEACHER, [
      { userId: 1, question: 3, correct: false },
      { userId: 1, question: 4, correct: false },
    ]);

    expect(r.score).toBe(0);
  });

  it('javob berilmagan savolga qo\'lda baho qo\'yib bo\'lmaydi', () => {
    const r = sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-A');
    sessions.applyManualGrades(TEACHER, [{ userId: 1, question: 3, correct: true }]);

    expect(r.verdicts[3]).toBe('missing');
  });

  it('kalit o\'zgarsa talabalar qayta baholanadi', () => {
    const r = sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-A 2-C 3-x 4-y');
    expect(r.verdicts[2]).toBe('correct');

    sessions.setQuestions(TEACHER, [...MIXED.slice(0, 1), { number: 2, type: 'variant', answer: 'D' }, ...MIXED.slice(2)]);
    expect(sessions.getSessionById(sid)!.students.get(1)!.verdicts[2]).toBe('wrong');
  });

  it('qayta baholashda o\'qituvchi qo\'ygan baho saqlanadi', () => {
    sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-A 2-C 3-x 4-y');
    sessions.applyManualGrades(TEACHER, [{ userId: 1, question: 3, correct: true }]);

    sessions.setScoring(TEACHER, { pointsPerCorrect: 3, pointsPerWrong: 0 });

    expect(sessions.getSessionById(sid)!.students.get(1)!.verdicts[3]).toBe('correct');
  });

  it('majburiy yakunlashda tekshirilmaganlar xato bo\'ladi', () => {
    const r = sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-A 2-C 3-x 4-y');
    expect(sessions.forceResolvePending(TEACHER)).toBe(2);
    expect(r.pendingCount).toBe(0);
    expect(r.verdicts[3]).toBe('wrong');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Oraliq qadam: /yakunla → Excel → qaytarish', () => {
  let sid: string;

  beforeEach(() => {
    sid = sessions.createSession(TEACHER, 'Matematika').sessionId;
    sessions.setQuestions(TEACHER, MIXED);
    sessions.submitAnswers(sid, 1, 'Ali Valiyev', 'ali', '1-A 2-C 3-18 / 60 4-20x');
    sessions.submitAnswers(sid, 2, 'Bek Karimov', 'bek', '1-B 2-C 3-19/60 4-20y');
  });

  it('/yakunla topshirishni to\'xtatadi, lekin sessiyani o\'chirmaydi', () => {
    sessions.startGrading(TEACHER);

    expect(sessions.getSessionById(sid)).not.toBeNull();
    expect(fs.existsSync(path.join(dataDir, `${sid}.json`))).toBe(true);
    expect(() => sessions.submitAnswers(sid, 3, 'Kech', 'k', '1-A')).toThrow(/to'xtatilgan/);
  });

  it('/davom topshirishni qayta ochadi', () => {
    sessions.startGrading(TEACHER);
    sessions.resumeSubmissions(TEACHER);

    expect(() => sessions.submitAnswers(sid, 3, 'Yangi', 'y', '1-A')).not.toThrow();
  });

  it('baholash bosqichida kalitni o\'zgartirib bo\'lmaydi', () => {
    sessions.startGrading(TEACHER);
    expect(() => sessions.setAnswers(TEACHER, '1-A')).toThrow(/baholash bosqichida/i);
  });

  it('ikki marta /yakunla yuborib bo\'lmaydi', () => {
    sessions.startGrading(TEACHER);
    expect(() => sessions.startGrading(TEACHER)).toThrow(/allaqachon to'xtatilgan/);
  });

  it('baholash faylida faqat javob berilgan ochiq savollar bo\'ladi', async () => {
    sessions.submitAnswers(sid, 3, 'Dilnoza', 'dil', '1-A 3-18/60');   // 4-savolsiz
    const session = sessions.getSessionById(sid)!;
    sessions.startGrading(TEACHER);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excel.generateGradingWorkbook(session)) as any);
    const ws = wb.getWorksheet('Baholash')!;

    // 2 talaba × 2 ochiq + 1 talaba × 1 ochiq = 5 qator (+ sarlavha)
    expect(ws.rowCount).toBe(6);
  });

  it('bot mos javobni oldindan 1 deb belgilaydi ("18 / 60" ≡ "18/60")', async () => {
    const session = sessions.getSessionById(sid)!;
    sessions.startGrading(TEACHER);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excel.generateGradingWorkbook(session)) as any);
    const ws = wb.getWorksheet('Baholash')!;

    const aliRow = ws.getRow(2);
    expect(aliRow.getCell(1).value).toBe('Ali Valiyev');
    expect(aliRow.getCell(7).value).toBe(1);
    // Bek "19/60" yozgan — mos emas
    expect(ws.getRow(4).getCell(7).value).toBe(0);
  });

  it('qaytarilgan faylni o\'qib baholarni qo\'llaydi', async () => {
    const session = sessions.getSessionById(sid)!;
    sessions.startGrading(TEACHER);
    expect(sessions.countPending(session)).toBe(4);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excel.generateGradingWorkbook(session)) as any);
    const ws = wb.getWorksheet('Baholash')!;
    ws.eachRow((row, n) => { if (n > 1) row.getCell(7).value = 1; });   // hammasi to'g'ri

    const grades = await excel.parseGradedWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(sessions.applyManualGrades(TEACHER, grades)).toBe(4);
    expect(sessions.countPending(session)).toBe(0);
    expect(session.students.get(2)!.verdicts[3]).toBe('correct');
  });

  it.each([
    ['ha', true], ["yo'q", false], ['+', true], ['-', false],
    ['TRUE', true], ['false', false], ['✅', true], ['❌', false],
    ["to'g'ri", true], ['xato', false], [1, true], [0, false],
  ])('baho ustunida "%s" qiymatini tushunadi', async (value, expected) => {
    const session = sessions.getSessionById(sid)!;
    sessions.startGrading(TEACHER);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excel.generateGradingWorkbook(session)) as any);
    const ws = wb.getWorksheet('Baholash')!;
    ws.eachRow((row, n) => { if (n > 1) row.getCell(7).value = value as any; });

    const grades = await excel.parseGradedWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(grades.every((g) => g.correct === expected)).toBe(true);
  });

  it('to\'ldirilmagan baho ustunini aniq xato bilan qaytaradi', async () => {
    const session = sessions.getSessionById(sid)!;
    sessions.startGrading(TEACHER);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excel.generateGradingWorkbook(session)) as any);
    wb.getWorksheet('Baholash')!.getRow(2).getCell(7).value = null;

    await expect(
      excel.parseGradedWorkbook(Buffer.from(await wb.xlsx.writeBuffer())),
    ).rejects.toThrow(/to'ldirilmagan/);
  });

  it('noto\'g\'ri fayl qaytarilsa tushunarli xato beradi', async () => {
    await expect(excel.parseGradedWorkbook(await excel.generateKeyTemplate()))
      .rejects.toThrow(/Baholash/);
  });

  it('ustunlar joyi almashsa ham ishlaydi', async () => {
    const session = sessions.getSessionById(sid)!;
    sessions.startGrading(TEACHER);

    // Sarlavhalar bo'yicha topiladi — ustun tartibiga bog'liq emas
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excel.generateGradingWorkbook(session)) as any);
    const ws = wb.getWorksheet('Baholash')!;
    ws.spliceColumns(1, 1);                       // "Talaba" ustunini olib tashlaymiz
    ws.eachRow((row, n) => { if (n > 1) row.getCell(6).value = 1; });

    const grades = await excel.parseGradedWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(grades).toHaveLength(4);
  });

  it('yakunlagach sessiya va fayl o\'chadi', () => {
    sessions.startGrading(TEACHER);
    sessions.forceResolvePending(TEACHER);
    sessions.finishSession(TEACHER);

    expect(sessions.getSessionById(sid)).toBeNull();
    expect(fs.existsSync(path.join(dataDir, `${sid}.json`))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Saqlash va tiklash', () => {
  it('baholash bosqichidagi sessiya qayta ishga tushgach tiklanadi', () => {
    const sid = sessions.createSession(TEACHER, 'Fizika').sessionId;
    sessions.setQuestions(TEACHER, MIXED);
    sessions.submitAnswers(sid, 1, 'Ali', 'ali', '1-A 2-C 3-18/60 4-20x');
    sessions.startGrading(TEACHER);
    sessions.onModuleDestroy();

    const revived = makeService();
    const session = revived.getSessionById(sid)!;

    expect(session.status).toBe('GRADING');
    expect(session.questions[3].type).toBe('open');
    expect(session.students.get(1)!.answers[3]).toBe('18/60');
    expect(session.students.get(1)!.pendingCount).toBe(2);
    revived.onModuleDestroy();
  });

  it('eski formatdagi (faqat variantli) sessiyani o\'qiydi', () => {
    fs.writeFileSync(path.join(dataDir, 'OLD123.json'), JSON.stringify({
      sessionId: 'OLD123', teacherId: 999, testName: 'Eski test',
      answers: { 1: 'A', 2: 'B' },
      scoring: { pointsPerCorrect: 1, pointsPerWrong: 0 },
      students: [{
        userId: 55, fullName: 'Eski Talaba', username: 'old',
        rawAnswers: '1-A 2-C', correctCount: 1, wrongCount: 1,
        missingCount: 0, score: 1, maxScore: 2, submittedAt: new Date().toISOString(),
      }],
      createdAt: new Date().toISOString(),
    }));

    const revived = makeService();
    const session = revived.getSessionById('OLD123')!;

    expect(session.status).toBe('ACTIVE');
    expect(session.questions[1]).toEqual({ number: 1, type: 'variant', answer: 'A' });
    expect(session.students.get(55)!.answers[2]).toBe('C');
    revived.onModuleDestroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Telegram xabarlari (MarkdownV2)', () => {
  /** Kod bloklaridan tashqarida ekranlanmagan maxsus belgi qolmasligi kerak */
  const unescaped = (text: string): string[] => {
    const SPECIALS = '[]()~>#+=|{}.!';
    const found: string[] = [];
    let inCode = false;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '`') { inCode = !inCode; continue; }
      if (inCode || !SPECIALS.includes(text[i])) continue;

      let slashes = 0;
      for (let k = i - 1; k >= 0 && text[k] === '\\'; k--) slashes++;
      if (slashes % 2 === 0) found.push(`${text[i]} @${i}: ${text.slice(Math.max(0, i - 20), i + 10)}`);
    }
    return found;
  };

  it('barcha xabarlar to\'g\'ri ekranlangan va uzunlik chegarasida', () => {
    const sid = sessions.createSession(TEACHER, 'Kimyo / 10-sinf (A. Karimov)').sessionId;
    sessions.setQuestions(TEACHER, MIXED);
    const student = sessions.submitAnswers(sid, 1, 'Ali Valiyev', 'ali', '1-A 2-B 3-18/60 4-20x');
    const session = sessions.getSessionById(sid)!;

    const messages: Record<string, string> = {
      sessionCreated: MessageBuilder.sessionCreated(session),
      answersSet: MessageBuilder.answersSet(MIXED, true),
      sessionStatus: MessageBuilder.sessionStatus(session, 2),
      resultsSummary: MessageBuilder.resultsSummary(session),
      gradingStarted: MessageBuilder.gradingStarted(session, 4),
      gradingStartedNoOpen: MessageBuilder.gradingStarted(session, 0),
      gradesApplied: MessageBuilder.gradesApplied(4, 2),
      gradesAppliedDone: MessageBuilder.gradesApplied(4, 0),
      pendingBlocksSend: MessageBuilder.pendingBlocksSend(3),
      resumed: MessageBuilder.resumed(session),
      testEnded: MessageBuilder.testEnded(session),
      joinedSession: MessageBuilder.joinedSession(session),
      submissionResult: MessageBuilder.submissionResult(student, session),
      submissionEcho: MessageBuilder.submissionEcho(student, session),
      detailedStudentResult: MessageBuilder.detailedStudentResult(student, session),
      teacherHelp: MessageBuilder.teacherHelp(),
      studentHelp: MessageBuilder.studentHelp(),
      teacherWelcome: MessageBuilder.teacherWelcome('A. Karimov'),
      breakdown: MessageBuilder.teacherDetailedBreakdown(session).join(''),
    };

    for (const [name, text] of Object.entries(messages)) {
      expect({ name, bad: unescaped(text) }).toEqual({ name, bad: [] });
    }
  });

  it('ko\'p talabali natijalarni sahifalarga bo\'ladi', () => {
    const sid = sessions.createSession(TEACHER, 'Katta test').sessionId;
    sessions.setQuestions(TEACHER, MIXED);
    for (let i = 1; i <= 60; i++) {
      sessions.submitAnswers(sid, i, `Talaba Familiya ${i}`, `u${i}`, '1-A 2-C 3-18/60 4-20x');
    }

    const pages = MessageBuilder.teacherDetailedBreakdown(sessions.getSessionById(sid)!);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page) => expect(page.length).toBeLessThan(4096));
  });
});
