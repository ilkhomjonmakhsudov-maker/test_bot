import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Session,
  ScoringRule,
  StudentResult,
  QuestionKey,
  SessionStatus,
  ManualGrade,
  Verdict,
} from './interfaces/session.interface';

/** Plain JSON-serialisable shape of a session (Map → array, Date → string) */
interface PersistedSession {
  sessionId: string;
  teacherId: number;
  testName: string;
  status?: SessionStatus;
  questions?: Record<number, QuestionKey>;
  /** Eski format (faqat variantli savollar) — migratsiya uchun */
  answers?: Record<number, string>;
  scoring: ScoringRule;
  students: StudentResult[];
  createdAt: string;
  gradingStartedAt?: string;
}

@Injectable()
export class TestSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TestSessionService.name);

  /** Primary store: teacherId → active Session */
  private readonly sessions = new Map<number, Session>();

  /** Reverse index: sessionId → teacherId (fast student join lookup) */
  private readonly sessionIndex = new Map<string, number>();

  private readonly ttlMs: number;
  private readonly dataDir: string;

  constructor(private readonly config: ConfigService) {
    const ttlMinutes = this.config.get<number>('app.sessionTtlMinutes', 0);
    this.ttlMs = ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : 0;
    this.dataDir = path.resolve(
      this.config.get<string>('app.sessionDataPath', './data/sessions'),
    );
  }

  // ─── Lifecycle hooks ──────────────────────────────────────────────────────────

  onModuleInit() {
    this.ensureDataDir();
    this.loadPersistedSessions();
  }

  onModuleDestroy() {
    for (const session of this.sessions.values()) {
      if (session.ttlTimer) clearTimeout(session.ttlTimer);
    }
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────────

  createSession(teacherId: number, testName: string): Session {
    if (this.sessions.has(teacherId)) {
      throw new Error(
        "Sizda allaqachon faol test sessiyasi mavjud. Avval /yakunla va /natijalarni_yubor buyruqlari bilan yakunlang.",
      );
    }

    const sessionId = this.generateId();
    const session: Session = {
      sessionId,
      teacherId,
      testName,
      status: 'ACTIVE',
      questions: {},
      scoring: { pointsPerCorrect: 1, pointsPerWrong: 0 },
      students: new Map(),
      createdAt: new Date(),
    };

    this.sessions.set(teacherId, session);
    this.sessionIndex.set(sessionId, teacherId);
    this.scheduleTtl(session);
    this.persistSession(session);

    this.logger.log(`Sessiya yaratildi: ${sessionId} — "${testName}" (o'qituvchi: ${teacherId})`);
    return session;
  }

  /**
   * Telegram matni orqali kalit: "1-A 2-B 3-C" — faqat variantli savollar.
   * Ochiq savollar uchun Excel yuklash kerak (setQuestions).
   */
  setAnswers(teacherId: number, raw: string): Record<number, QuestionKey> {
    const session = this.requireSession(teacherId);
    this.assertEditable(session);

    const questions: Record<number, QuestionKey> = {};
    for (const pair of raw.trim().split(/[\s|]+/).filter(Boolean)) {
      const match = pair.match(/^(\d+)\s*[-–—]\s*([A-Ea-e])$/);
      if (!match) {
        throw new Error(
          `Noto'g'ri format: "${pair}".\n\n` +
          `Matn orqali faqat variantli savollar kiritiladi: 1-A 2-B 3-C (A–E).\n` +
          `Ochiq javobli savollar uchun Excel yuklang — namuna uchun /namuna buyrug'ini yuboring.`,
        );
      }
      const number = parseInt(match[1], 10);
      questions[number] = { number, type: 'variant', answer: match[2].toUpperCase() };
    }

    if (Object.keys(questions).length === 0) {
      throw new Error("Hech qanday javob topilmadi. Misol: 1-A 2-B 3-C");
    }

    session.questions = questions;
    this.regradeAll(session);
    this.persistSession(session);
    this.logger.log(`${session.sessionId} — ${Object.keys(questions).length} ta javob belgilandi (matn).`);
    return questions;
  }

  /** Excel orqali kalit: variantli va ochiq savollar aralash bo'lishi mumkin. */
  setQuestions(teacherId: number, list: QuestionKey[]): Record<number, QuestionKey> {
    const session = this.requireSession(teacherId);
    this.assertEditable(session);

    if (list.length === 0) {
      throw new Error("Excel faylida savollar topilmadi.");
    }

    const questions: Record<number, QuestionKey> = {};
    for (const q of list) questions[q.number] = q;

    session.questions = questions;
    this.regradeAll(session);
    this.persistSession(session);
    this.logger.log(`${session.sessionId} — ${list.length} ta savol Excel orqali belgilandi.`);
    return questions;
  }

  setScoring(teacherId: number, rule: ScoringRule): void {
    const session = this.requireSession(teacherId);
    session.scoring = rule;
    this.regradeAll(session);
    this.persistSession(session);
  }

  /**
   * /yakunla — oraliq qadam: javob topshirish to'xtatiladi, lekin sessiya
   * o'chirilmaydi. O'qituvchi ochiq javoblarni baholab, Excelni qaytaradi.
   */
  startGrading(teacherId: number): Session {
    const session = this.requireSession(teacherId);
    if (session.status === 'GRADING') {
      throw new Error(
        "Test allaqachon to'xtatilgan. Baholangan Excelni yuklang yoki /natijalarni_yubor buyrug'ini yuboring.",
      );
    }
    session.status = 'GRADING';
    session.gradingStartedAt = new Date();
    this.persistSession(session);
    this.logger.log(
      `Sessiya baholash bosqichiga o'tdi: ${session.sessionId} — ${session.students.size} ta talaba.`,
    );
    return session;
  }

  /** Baholash bosqichidan qaytish — talabalar yana javob topshira oladi. */
  resumeSubmissions(teacherId: number): Session {
    const session = this.requireSession(teacherId);
    if (session.status === 'ACTIVE') {
      throw new Error('Test allaqachon ochiq — talabalar javob topshirmoqda.');
    }
    session.status = 'ACTIVE';
    session.gradingStartedAt = undefined;
    this.persistSession(session);
    this.logger.log(`Sessiya qayta ochildi: ${session.sessionId}`);
    return session;
  }

  /**
   * O'qituvchi Exceldan qaytargan ochiq javob baholarini qo'llaydi.
   * Returns: qo'llangan baholar soni.
   */
  applyManualGrades(teacherId: number, grades: ManualGrade[]): number {
    const session = this.requireSession(teacherId);
    let applied = 0;

    for (const g of grades) {
      const student = session.students.get(g.userId);
      const question = session.questions[g.question];
      if (!student || !question || question.type !== 'open') continue;

      // Javob bermagan talabaga baho qo'yilmaydi
      const given = student.answers[g.question];
      if (given === undefined || given === '') continue;

      student.verdicts[g.question] = g.correct ? 'correct' : 'wrong';
      applied++;
    }

    for (const student of session.students.values()) {
      this.recount(student, session);
    }

    this.persistSession(session);
    this.logger.log(`${session.sessionId} — ${applied} ta qo'lda baho qo'llandi.`);
    return applied;
  }

  /**
   * Tekshirilmagan ochiq javoblarni xato deb belgilaydi.
   * O'qituvchi baholashni o'tkazib yuborishni tanlaganda ishlatiladi.
   * Returns: belgilangan javoblar soni.
   */
  forceResolvePending(teacherId: number): number {
    const session = this.requireSession(teacherId);
    let resolved = 0;

    for (const student of session.students.values()) {
      for (const [key, verdict] of Object.entries(student.verdicts)) {
        if (verdict === 'pending') {
          student.verdicts[Number(key)] = 'wrong';
          resolved++;
        }
      }
      this.recount(student, session);
    }

    this.persistSession(session);
    this.logger.log(`${session.sessionId} — ${resolved} ta tekshirilmagan javob xato deb belgilandi.`);
    return resolved;
  }

  /** Hali baholanmagan ochiq javoblar soni (barcha talabalar bo'yicha) */
  countPending(session: Session): number {
    let total = 0;
    for (const student of session.students.values()) total += student.pendingCount;
    return total;
  }

  /** Sessiyada ochiq javobli savol bormi */
  hasOpenQuestions(session: Session): boolean {
    return Object.values(session.questions).some((q) => q.type === 'open');
  }

  /**
   * Yakuniy qadam: natijalar yuborilgandan keyin sessiya butunlay o'chiriladi.
   * Returns the final session snapshot (for Excel generation).
   */
  finishSession(teacherId: number): Session {
    const session = this.requireSession(teacherId);

    this.deleteSessionFile(session.sessionId);
    this.deleteSession(teacherId);

    this.logger.log(
      `Sessiya yakunlandi: ${session.sessionId} — ${session.students.size} ta talaba.`,
    );
    return session;
  }

  // ─── Student operations ───────────────────────────────────────────────────────

  submitAnswers(
    sessionId: string,
    userId: number,
    fullName: string,
    username: string,
    rawAnswers: string,
  ): StudentResult {
    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Test sessiyasi topilmadi yoki allaqachon yakunlangan.');
    if (session.status !== 'ACTIVE') {
      throw new Error(
        "⏹ Test yakunlangan — javob topshirish to'xtatilgan. Natijalarni kuting.",
      );
    }
    if (Object.keys(session.questions).length === 0) {
      throw new Error("O'qituvchi hali javoblarni kiritmagan. Kuting va qayta urinib ko'ring.");
    }

    const answers = this.parseStudentAnswers(rawAnswers, session);

    const result: StudentResult = {
      userId,
      fullName,
      username,
      rawAnswers: rawAnswers.trim(),
      answers,
      verdicts: {},
      correctCount: 0,
      wrongCount: 0,
      missingCount: 0,
      pendingCount: 0,
      score: 0,
      maxScore: 0,
      submittedAt: new Date(),
    };

    this.gradeStudent(result, session);
    session.students.set(userId, result);

    // Persist after every submission so no data is lost on crash
    this.persistSession(session);

    return result;
  }

  // ─── Lookups ──────────────────────────────────────────────────────────────────

  getSessionByTeacher(teacherId: number): Session | null {
    return this.sessions.get(teacherId) ?? null;
  }

  getSessionById(sessionId: string): Session | null {
    const teacherId = this.sessionIndex.get(sessionId.toUpperCase());
    if (teacherId === undefined) return null;
    return this.sessions.get(teacherId) ?? null;
  }

  sessionExists(sessionId: string): boolean {
    return this.sessionIndex.has(sessionId.toUpperCase());
  }

  getAllSessions(): Session[] {
    return [...this.sessions.values()];
  }

  /** Savollar ro'yxati, raqam bo'yicha tartiblangan */
  static sortedQuestions(session: Session): QuestionKey[] {
    return Object.values(session.questions).sort((a, b) => a.number - b.number);
  }

  /**
   * Ochiq javob uchun botning taxmini — Excelda oldindan to'ldirish uchun.
   * O'qituvchi bu qiymatni o'zgartira oladi.
   */
  static guessOpen(given: string, expected: string): boolean {
    return TestSessionService.normalizeOpen(given) === TestSessionService.normalizeOpen(expected);
  }

  /** Ochiq javoblarni taqqoslash uchun normallashtirish */
  static normalizeOpen(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[‐-―]/g, '-')   // unicode tirelar → oddiy tire
      .replace(/\s+/g, '')                 // barcha bo'shliqlarni olib tashlash
      .replace(/[.,;]+$/, '');             // oxirgi tinish belgilari
  }

  // ─── Grading ──────────────────────────────────────────────────────────────────

  /**
   * Talaba javoblarini tekshiradi:
   * • variant savollar — avtomatik
   * • ochiq savollar   — 'pending' (o'qituvchi tasdiqlaydi), javob yo'q bo'lsa 'missing'
   */
  private gradeStudent(result: StudentResult, session: Session): void {
    const verdicts: Record<number, Verdict> = {};

    for (const q of TestSessionService.sortedQuestions(session)) {
      const given = result.answers[q.number];

      if (given === undefined || given === '') {
        verdicts[q.number] = 'missing';
        continue;
      }

      if (q.type === 'variant') {
        verdicts[q.number] = given.toUpperCase() === q.answer.toUpperCase() ? 'correct' : 'wrong';
      } else {
        // Oldingi baho saqlanadi (qayta baholashda o'qituvchi ishini yo'qotmaslik uchun)
        const previous = result.verdicts?.[q.number];
        verdicts[q.number] =
          previous === 'correct' || previous === 'wrong' ? previous : 'pending';
      }
    }

    result.verdicts = verdicts;
    this.recount(result, session);
  }

  /** Verdictlar asosida sanoq va ballni qayta hisoblaydi */
  private recount(result: StudentResult, session: Session): void {
    let correctCount = 0;
    let wrongCount = 0;
    let missingCount = 0;
    let pendingCount = 0;

    for (const verdict of Object.values(result.verdicts)) {
      if (verdict === 'correct') correctCount++;
      else if (verdict === 'wrong') wrongCount++;
      else if (verdict === 'missing') missingCount++;
      else pendingCount++;
    }

    const rawScore =
      correctCount * session.scoring.pointsPerCorrect -
      wrongCount * session.scoring.pointsPerWrong;

    result.correctCount = correctCount;
    result.wrongCount = wrongCount;
    result.missingCount = missingCount;
    result.pendingCount = pendingCount;
    result.score = Math.max(0, rawScore);
    result.maxScore =
      Object.keys(session.questions).length * session.scoring.pointsPerCorrect;
  }

  /** Kalit yoki baholash o'zgarganda barcha talabalarni qayta tekshiradi */
  private regradeAll(session: Session): void {
    for (const student of session.students.values()) {
      // Xom matndan javoblarni qayta ajratish — yangi kalitda savol turi
      // o'zgargan bo'lishi mumkin (variant → ochiq)
      try {
        student.answers = this.parseStudentAnswers(student.rawAnswers, session);
      } catch {
        // Xom matn yangi kalitga mos kelmasa, mavjud javoblar saqlanadi
      }
      this.gradeStudent(student, session);
    }
  }

  /**
   * Talaba javobini ajratadi. Qo'llab-quvvatlanadigan formatlar:
   *   "1-A 2-C 3-18/60"          — bir qatorda
   *   "1-A | 2-C | 3-18 / 60"    — "|" bilan ajratilgan
   *   "1-A\n2-C\n3-18 / 60"       — har bir javob alohida qatorda
   *   "1-A2-B3-C"                — bo'shliqsiz (faqat variantli savollarda)
   *
   * Matn avval "|" va qator ko'chirish bo'yicha bo'laklarga bo'linadi, so'ng har
   * bir bo'lak savol raqami markerlari ("3-", "3.", "3)") bo'yicha ajratiladi.
   * Shu sababli ochiq javob ichida bo'shliq bo'lishi mumkin: "3-18 / 60".
   */
  private parseStudentAnswers(raw: string, session: Session): Record<number, string> {
    const text = raw.trim();
    if (!text) throw new Error("Javob matni bo'sh.");

    // "|" va yangi qator — aniq ajratgichlar: ular orasidagi matn bitta javob
    const segments = text.split(/[|\n\r]+/).map((part) => part.trim()).filter(Boolean);

    const map: Record<number, string> = {};
    const unknown: number[] = [];
    const empty: number[] = [];
    const invalidVariant: number[] = [];
    let leading = '';

    for (const segment of segments) {
      const parsed = this.parseSegment(segment, session);
      Object.assign(map, parsed.map);
      unknown.push(...parsed.unknown.filter((n) => !unknown.includes(n)));
      empty.push(...parsed.empty);
      invalidVariant.push(...parsed.invalidVariant);
      if (!leading) leading = parsed.leading;
    }

    if (unknown.length > 0) {
      throw new Error(
        `Bunday savol yo'q: ${unknown.join(', ')}.\n\n` +
        `Testda ${Object.keys(session.questions).length} ta savol bor. ` +
        `Savol raqamlarini tekshirib qayta yuboring.`,
      );
    }

    if (empty.length > 0) {
      throw new Error(
        `Quyidagi savollarga javob yozilmagan: ${empty.join(', ')}.\n\n` +
        `Javob ichida bo'shliq bo'lsa, javoblarni "|" bilan ajrating:\n` +
        `\`1-A | 2-C | 3-18 / 60\``,
      );
    }

    if (invalidVariant.length > 0) {
      throw new Error(
        `Quyidagi savollar variantli — javob faqat bitta harf (A–E) bo'lishi kerak: ` +
        `${invalidVariant.join(', ')}.\n\n` +
        `Javoblarni bo'shliq yoki "|" bilan ajrating. Misol: \`1-A | 2-C | 3-18/60\``,
      );
    }

    if (Object.keys(map).length === 0) {
      throw new Error(
        `Javoblar tushunilmadi.\n\n` +
        `To'g'ri format:\n` +
        `• Variantli savol: \`1-A\`\n` +
        `• Ochiq savol: \`2-18/60\`\n\n` +
        `Misol: \`1-A 2-18/60 3-20x\`\n` +
        `Javob ichida bo'shliq bo'lsa: \`1-A | 2-18 / 60\``,
      );
    }

    if (leading) {
      throw new Error(
        `Javoblar oldidagi matn tushunilmadi: "${leading}".\n\n` +
        `Faqat javoblarni yuboring. Misol: \`1-A 2-18/60 3-20x\``,
      );
    }

    return map;
  }

  /** Bitta bo'lakni ("1-A 2-C" yoki "3-18 / 60") ajratadi */
  private parseSegment(segment: string, session: Session) {
    const parsed = this.extractAnswers(segment, session, true);

    // "1-A2-B3-C" — bo'shliqsiz yozilgan bo'lsa chegara talabini yumshatamiz.
    // Faqat hamma savol variantli bo'lganda xavfsiz: ochiq javob ichidagi raqam
    // ("18/60") savol raqami bilan chalkashib ketishi mumkin.
    const allVariant = Object.values(session.questions).every((q) => q.type === 'variant');
    if (allVariant && !/\s/.test(segment) && Object.keys(parsed.map).length <= 1) {
      const loose = this.extractAnswers(segment, session, false);
      if (Object.keys(loose.map).length > Object.keys(parsed.map).length) return loose;
    }

    return parsed;
  }

  /**
   * Matndan "savol raqami → javob" juftliklarini ajratadi.
   * @param requireBoundary marker faqat qator boshida yoki bo'shliqdan keyin
   *                        kelishi shart (odatiy holat)
   */
  private extractAnswers(
    text: string,
    session: Session,
    requireBoundary: boolean,
  ): {
    map: Record<number, string>;
    leading: string;
    unknown: number[];
    empty: number[];
    invalidVariant: number[];
  } {
    // Diqqat: ajratgichdan keyin \s* YO'Q — aks holda "2- 3-y" da keyingi savol
    // markeri ("3-") oldidagi bo'shliq yutilib, javob "3-y" bo'lib qolardi.
    const pattern = requireBoundary
      ? /(?:^|\s)(\d+)\s*[-–—.):]/g
      : /(\d+)\s*[-–—.):]/g;

    const markers: { number: number; start: number; end: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      markers.push({
        number: parseInt(match[1], 10),
        start: match.index,
        end: pattern.lastIndex,
      });
    }

    const map: Record<number, string> = {};
    const unknown: number[] = [];
    const empty: number[] = [];
    const invalidVariant: number[] = [];

    markers.forEach((marker, i) => {
      const question = session.questions[marker.number];
      if (!question) {
        if (!unknown.includes(marker.number)) unknown.push(marker.number);
        return;
      }

      const next = markers[i + 1];
      const value = text.slice(marker.end, next ? next.start : text.length).trim();

      if (!value) {
        empty.push(marker.number);
        return;
      }

      if (question.type === 'variant') {
        if (!/^[A-Ea-e]$/.test(value)) {
          invalidVariant.push(marker.number);
          return;
        }
        map[marker.number] = value.toUpperCase();
      } else {
        map[marker.number] = value;
      }
    });

    const leading = markers.length > 0 ? text.slice(0, markers[0].start).trim() : '';

    return { map, leading, unknown, empty, invalidVariant };
  }

  // ─── JSON persistence ─────────────────────────────────────────────────────────

  /** Writes the session snapshot to ./data/sessions/<sessionId>.json */
  private persistSession(session: Session): void {
    try {
      const payload: PersistedSession = {
        sessionId: session.sessionId,
        teacherId: session.teacherId,
        testName: session.testName,
        status: session.status,
        questions: session.questions,
        scoring: session.scoring,
        students: [...session.students.values()],
        createdAt: session.createdAt.toISOString(),
        gradingStartedAt: session.gradingStartedAt?.toISOString(),
      };
      const filePath = this.sessionFilePath(session.sessionId);
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`Sessiyani saqlashda xato (${session.sessionId}): ${(err as Error).message}`);
    }
  }

  /** Deletes the JSON file for a given sessionId */
  private deleteSessionFile(sessionId: string): void {
    try {
      const filePath = this.sessionFilePath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.log(`Sessiya fayli o'chirildi: ${filePath}`);
      }
    } catch (err) {
      this.logger.error(`Fayl o'chirishda xato (${sessionId}): ${(err as Error).message}`);
    }
  }

  /**
   * On startup: reads every .json file in the data directory and rebuilds
   * the in-memory Maps. This ensures active sessions survive bot restarts.
   */
  private loadPersistedSessions(): void {
    const files = fs.readdirSync(this.dataDir).filter((f) => f.endsWith('.json'));

    if (files.length === 0) {
      this.logger.log('Saqlangan faol sessiyalar topilmadi.');
      return;
    }

    let loaded = 0;
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.dataDir, file), 'utf-8');
        const data: PersistedSession = JSON.parse(raw);

        const session: Session = {
          sessionId: data.sessionId,
          teacherId: data.teacherId,
          testName: data.testName,
          status: data.status ?? 'ACTIVE',
          questions: data.questions ?? this.migrateAnswers(data.answers),
          scoring: data.scoring,
          students: new Map(
            data.students.map((s) => [s.userId, this.migrateStudent(s)]),
          ),
          createdAt: new Date(data.createdAt),
          gradingStartedAt: data.gradingStartedAt
            ? new Date(data.gradingStartedAt)
            : undefined,
        };

        this.sessions.set(session.teacherId, session);
        this.sessionIndex.set(session.sessionId, session.teacherId);

        // Resume TTL timer, accounting for already-elapsed time
        if (this.ttlMs > 0) {
          const elapsed = Date.now() - session.createdAt.getTime();
          const remaining = this.ttlMs - elapsed;
          if (remaining <= 0) {
            // Already expired — clean up silently
            this.deleteSessionFile(session.sessionId);
            this.sessions.delete(session.teacherId);
            this.sessionIndex.delete(session.sessionId);
            this.logger.warn(`Muddati o'tgan sessiya o'chirildi: ${session.sessionId}`);
          } else {
            this.scheduleTtl(session, remaining);
          }
        }

        loaded++;
      } catch (err) {
        this.logger.error(`Sessiya faylini o'qishda xato (${file}): ${(err as Error).message}`);
      }
    }

    this.logger.log(`${loaded} ta faol sessiya tiklandi.`);
  }

  /** Eski format: answers: {1:"A"} → questions: {1:{number:1,type:'variant',answer:'A'}} */
  private migrateAnswers(answers?: Record<number, string>): Record<number, QuestionKey> {
    const questions: Record<number, QuestionKey> = {};
    for (const [key, value] of Object.entries(answers ?? {})) {
      const number = parseInt(key, 10);
      questions[number] = { number, type: 'variant', answer: value };
    }
    return questions;
  }

  /** Eski talaba yozuvida answers/verdicts bo'lmagan — rawAnswers dan tiklaymiz */
  private migrateStudent(s: StudentResult): StudentResult {
    const student: StudentResult = {
      ...s,
      submittedAt: new Date(s.submittedAt),
      answers: s.answers ?? {},
      verdicts: s.verdicts ?? {},
      pendingCount: s.pendingCount ?? 0,
    };

    if (Object.keys(student.answers).length === 0 && s.rawAnswers) {
      for (const pair of s.rawAnswers.trim().split(/\s+/)) {
        const match = pair.match(/^(\d+)\s*[-–—]\s*(.+)$/);
        if (match) student.answers[parseInt(match[1], 10)] = match[2].trim();
      }
    }

    return student;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private requireSession(teacherId: number): Session {
    const session = this.sessions.get(teacherId);
    if (!session) {
      throw new Error("Faol test sessiyasi yo'q. /yangitest buyrug'i bilan yangi test yarating.");
    }
    return session;
  }

  /** Baholash bosqichida kalitni o'zgartirishga yo'l qo'ymaydi */
  private assertEditable(session: Session): void {
    if (session.status === 'GRADING') {
      throw new Error(
        "Test baholash bosqichida — kalitni o'zgartirib bo'lmaydi.\n" +
        "Qayta ochish uchun /davom buyrug'ini yuboring.",
      );
    }
  }

  private deleteSession(teacherId: number): void {
    const session = this.sessions.get(teacherId);
    if (!session) return;
    if (session.ttlTimer) clearTimeout(session.ttlTimer);
    this.sessionIndex.delete(session.sessionId);
    this.sessions.delete(teacherId);
  }

  private scheduleTtl(session: Session, overrideMs?: number): void {
    const ms = overrideMs ?? this.ttlMs;
    if (ms <= 0) return;
    session.ttlTimer = setTimeout(() => {
      this.logger.warn(`Sessiya muddati tugadi: ${session.sessionId}`);
      this.deleteSessionFile(session.sessionId);
      this.deleteSession(session.teacherId);
    }, ms);
  }

  private generateId(): string {
    let id: string;
    do {
      id = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (this.sessionIndex.has(id));
    return id;
  }

  private sessionFilePath(sessionId: string): string {
    return path.join(this.dataDir, `${sessionId}.json`);
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      this.logger.log(`Ma'lumotlar papkasi yaratildi: ${this.dataDir}`);
    }
  }
}
