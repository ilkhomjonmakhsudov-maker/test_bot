import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TestSessionService } from '../session/session.service';
import { TeacherService } from '../teacher/teacher.service';
import { StatsService, StatsSnapshot } from '../stats/stats.service';
import {
  Session,
  QuestionKey,
  QuestionType,
} from '../session/interfaces/session.interface';

/**
 * Admin panelining "miyasi": ma'lumot o'qish va amallar.
 *
 * Bu yerda Telegram ham, veb ham yo'q — inline tugmalar paneli va Telegram
 * Mini App ikkalasi ham shu xizmatni chaqiradi, shu sababli mantiq bir joyda
 * yozilgan.
 */

export type Role = 'super' | 'teacher' | 'none';

export interface PendingItem {
  studentId: number;
  studentName: string;
  question: number;
  questionText?: string;
  given: string;
  expected: string;
  /** Botning taxmini — oldindan belgilash uchun */
  guess: boolean;
}

export interface SessionOverview {
  sessionId: string;
  testName: string;
  status: Session['status'];
  teacherId: number;
  teacherName: string;
  students: number;
  submitted: number;
  questions: number;
  openQuestions: number;
  pending: number;
  createdAt: string;
  scoring: { pointsPerCorrect: number; pointsPerWrong: number };
}

export interface Dashboard {
  role: Role;
  userId: number;
  name: string;
  session: SessionOverview | null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly superAdminIds: Set<number>;

  constructor(
    private readonly config: ConfigService,
    private readonly sessions: TestSessionService,
    private readonly teachers: TeacherService,
    private readonly stats: StatsService,
  ) {
    this.superAdminIds = new Set(
      this.config.get<number[]>('app.superAdminIds', []),
    );
  }

  // ─── Ruxsatlar ──────────────────────────────────────────────────────────────

  roleOf(userId: number): Role {
    if (this.superAdminIds.has(userId)) return 'super';
    if (this.teachers.isTeacher(userId)) return 'teacher';
    return 'none';
  }

  /** Super admin ham o'qituvchi amallarini bajara oladi */
  isTeacher(userId: number): boolean {
    return this.roleOf(userId) !== 'none';
  }

  isSuperAdmin(userId: number): boolean {
    return this.roleOf(userId) === 'super';
  }

  assertTeacher(userId: number): void {
    if (!this.isTeacher(userId)) {
      throw new Error("Bu amal faqat o'qituvchilar uchun.");
    }
  }

  assertSuperAdmin(userId: number): void {
    if (!this.isSuperAdmin(userId)) {
      throw new Error('Bu amal faqat super admin uchun.');
    }
  }

  teacherName(teacherId: number): string {
    if (this.superAdminIds.has(teacherId) && !this.teachers.isTeacher(teacherId)) {
      return 'Super admin';
    }
    return this.teachers.getTeacher(teacherId)?.name ?? `ID ${teacherId}`;
  }

  // ─── O'qish ─────────────────────────────────────────────────────────────────

  dashboard(userId: number): Dashboard {
    const session = this.sessions.getSessionByTeacher(userId);
    return {
      role: this.roleOf(userId),
      userId,
      name: this.teacherName(userId),
      session: session ? this.overview(session) : null,
    };
  }

  overview(session: Session): SessionOverview {
    const questions = Object.values(session.questions);
    const students = [...session.students.values()];

    return {
      sessionId: session.sessionId,
      testName: session.testName,
      status: session.status,
      teacherId: session.teacherId,
      teacherName: this.teacherName(session.teacherId),
      students: session.students.size,
      submitted: students.filter((s) => s.rawAnswers.length > 0).length,
      questions: questions.length,
      openQuestions: questions.filter((q) => q.type === 'open').length,
      pending: this.sessions.countPending(session),
      createdAt: session.createdAt.toISOString(),
      scoring: { ...session.scoring },
    };
  }

  requireSession(teacherId: number): Session {
    const session = this.sessions.getSessionByTeacher(teacherId);
    if (!session) {
      throw new Error("Faol test sessiyasi yo'q. Avval yangi test yarating.");
    }
    return session;
  }

  /** Kalit — savol bo'yicha ro'yxat */
  keyListing(teacherId: number): QuestionKey[] {
    return TestSessionService.sortedQuestions(this.requireSession(teacherId));
  }

  /** Talabalar ro'yxati, ball bo'yicha */
  standings(teacherId: number) {
    const session = this.requireSession(teacherId);
    return [...session.students.values()]
      .sort((a, b) => b.score - a.score)
      .map((s) => ({
        userId: s.userId,
        fullName: s.fullName,
        username: s.username,
        score: s.score,
        maxScore: s.maxScore,
        correctCount: s.correctCount,
        wrongCount: s.wrongCount,
        missingCount: s.missingCount,
        pendingCount: s.pendingCount,
        submittedAt: s.submittedAt,
      }));
  }

  /**
   * Tekshirilmagan ochiq javoblar navbati — panelda birma-bir baholash uchun.
   * Excel yo'li ochiq qoladi, bu unga qo'shimcha.
   */
  pendingQueue(teacherId: number): PendingItem[] {
    const session = this.requireSession(teacherId);
    const items: PendingItem[] = [];

    for (const student of session.students.values()) {
      for (const q of TestSessionService.sortedQuestions(session)) {
        if (q.type !== 'open') continue;
        if (student.verdicts[q.number] !== 'pending') continue;

        const given = student.answers[q.number];
        if (given === undefined || given === '') continue;

        items.push({
          studentId: student.userId,
          studentName: student.fullName,
          question: q.number,
          questionText: q.text,
          given,
          expected: q.answer,
          guess: TestSessionService.guessOpen(given, q.answer),
        });
      }
    }

    return items;
  }

  // ─── Amallar: o'qituvchi ────────────────────────────────────────────────────

  /** Bitta ochiq javobga baho qo'yadi. Returns: qolgan tekshirilmaganlar soni */
  gradeOne(
    teacherId: number,
    studentId: number,
    question: number,
    correct: boolean,
  ): number {
    const session = this.requireSession(teacherId);
    this.sessions.applyManualGrades(teacherId, [
      { userId: studentId, question, correct },
    ]);
    return this.sessions.countPending(session);
  }

  /** Qolgan barcha tekshirilmagan javoblarni bir xil baho bilan belgilaydi */
  gradeAllRemaining(teacherId: number, correct: boolean): number {
    const pending = this.pendingQueue(teacherId);
    if (pending.length === 0) return 0;

    this.sessions.applyManualGrades(
      teacherId,
      pending.map((p) => ({ userId: p.studentId, question: p.question, correct })),
    );
    return pending.length;
  }

  /** Botning taxminini qabul qiladi — mos kelganini to'g'ri deb belgilaydi */
  acceptGuesses(teacherId: number): number {
    const pending = this.pendingQueue(teacherId);
    if (pending.length === 0) return 0;

    this.sessions.applyManualGrades(
      teacherId,
      pending.map((p) => ({
        userId: p.studentId,
        question: p.question,
        correct: p.guess,
      })),
    );
    return pending.length;
  }

  /** Bitta savolning turini almashtiradi (variant ↔ ochiq) */
  toggleQuestionType(teacherId: number, question: number): QuestionKey {
    const session = this.requireSession(teacherId);
    const current = session.questions[question];
    if (!current) throw new Error(`${question}-savol topilmadi.`);

    const next: QuestionType = current.type === 'variant' ? 'open' : 'variant';
    if (next === 'variant' && !/^[A-Ea-e]$/.test(current.answer.trim())) {
      throw new Error(
        `${question}-savolning javobi "${current.answer}" — variantli savolda ` +
        `javob A–E harflaridan biri bo'lishi kerak. Avval javobni o'zgartiring.`,
      );
    }

    const updated = this.replaceQuestion(session, { ...current, type: next });
    this.logger.log(
      `${session.sessionId} — ${question}-savol turi "${next}" ga o'zgartirildi.`,
    );
    return updated;
  }

  /** Bitta savolning to'g'ri javobini almashtiradi */
  setQuestionAnswer(teacherId: number, question: number, answer: string): QuestionKey {
    const session = this.requireSession(teacherId);
    const current = session.questions[question];
    if (!current) throw new Error(`${question}-savol topilmadi.`);

    const value = answer.trim();
    if (!value) throw new Error('Javob bo\'sh bo\'lishi mumkin emas.');

    const type = current.type;
    if (type === 'variant' && !/^[A-Ea-e]$/.test(value)) {
      throw new Error(
        `${question}-savol variantli — javob A–E harflaridan biri bo'lishi kerak, ` +
        `yoki avval savol turini "ochiq" ga o'zgartiring.`,
      );
    }

    return this.replaceQuestion(session, {
      ...current,
      answer: type === 'variant' ? value.toUpperCase() : value,
    });
  }

  /**
   * Savolni almashtirib, butun kalitni qayta o'rnatadi — shu orqali barcha
   * talabalar javoblari qayta tekshiriladi (o'qituvchi qo'ygan baholar
   * saqlanadi).
   */
  private replaceQuestion(session: Session, question: QuestionKey): QuestionKey {
    const list = TestSessionService.sortedQuestions(session).map((q) =>
      q.number === question.number ? question : q,
    );
    this.sessions.setQuestions(session.teacherId, list);
    return question;
  }

  // ─── Amallar: sessiya hayoti ────────────────────────────────────────────────

  stopTest(teacherId: number): Session {
    const session = this.requireSession(teacherId);
    if (Object.keys(session.questions).length === 0) {
      throw new Error('Kalit kiritilmagan — testni yakunlab bo\'lmaydi.');
    }
    return this.sessions.startGrading(teacherId);
  }

  resume(teacherId: number): Session {
    return this.sessions.resumeSubmissions(teacherId);
  }

  setScoring(teacherId: number, pointsPerCorrect: number, pointsPerWrong: number): void {
    if (!(pointsPerCorrect > 0)) throw new Error('To\'g\'ri javob balli 0 dan katta bo\'lishi kerak.');
    if (pointsPerWrong < 0) throw new Error('Jarima manfiy bo\'lishi mumkin emas.');
    this.sessions.setScoring(teacherId, { pointsPerCorrect, pointsPerWrong });
  }

  // ─── Amallar: super admin ───────────────────────────────────────────────────

  allSessions(): SessionOverview[] {
    return this.sessions
      .getAllSessions()
      .map((s) => this.overview(s))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Boshqa o'qituvchining sessiyasini majburan baholash bosqichiga o'tkazadi */
  forceStop(sessionId: string): SessionOverview {
    const session = this.sessions.getSessionById(sessionId);
    if (!session) throw new Error(`"${sessionId}" sessiyasi topilmadi.`);
    if (session.status === 'GRADING') {
      throw new Error(`"${sessionId}" allaqachon baholash bosqichida.`);
    }
    this.sessions.startGrading(session.teacherId);
    this.logger.warn(`Super admin ${sessionId} sessiyasini to'xtatdi.`);
    return this.overview(session);
  }

  /** Boshqa o'qituvchining sessiyasini qayta ochadi */
  forceResume(sessionId: string): SessionOverview {
    const session = this.sessions.getSessionById(sessionId);
    if (!session) throw new Error(`"${sessionId}" sessiyasi topilmadi.`);
    if (session.status === 'ACTIVE') {
      throw new Error(`"${sessionId}" allaqachon ochiq.`);
    }
    this.sessions.resumeSubmissions(session.teacherId);
    this.logger.warn(`Super admin ${sessionId} sessiyasini qayta ochdi.`);
    return this.overview(session);
  }

  teacherList() {
    return this.teachers.getAllTeachers().map((t) => ({
      telegramId: t.telegramId,
      name: t.name,
      hasSession: this.sessions.getSessionByTeacher(t.telegramId) !== null,
    }));
  }

  addTeacher(telegramId: number, name: string): boolean {
    return this.teachers.addTeacher(telegramId, name);
  }

  removeTeacher(telegramId: number): boolean {
    return this.teachers.removeTeacher(telegramId);
  }

  /** Statistika; o'qituvchi nomlari joriy ro'yxatdan to'ldiriladi */
  statistics(): StatsSnapshot {
    const snapshot = this.stats.snapshot();
    return {
      ...snapshot,
      teachers: snapshot.teachers.map((t) => ({
        ...t,
        name: t.name || this.teacherName(t.teacherId),
      })),
      // Joriy faol sessiyalar statistikaga hali kirmagan
    };
  }

  activeSessionCount(): number {
    return this.sessions.getAllSessions().length;
  }
}
