import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Session, ScoringRule, StudentResult } from './interfaces/session.interface';

/** Plain JSON-serialisable shape of a session (Map → array, Date → string) */
interface PersistedSession {
  sessionId: string;
  teacherId: number;
  testName: string;
  answers: Record<number, string>;
  scoring: ScoringRule;
  students: StudentResult[];
  createdAt: string;
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
        "Sizda allaqachon faol test sessiyasi mavjud. Avval /yakunla buyrug'i bilan yakunlang.",
      );
    }

    const sessionId = this.generateId();
    const session: Session = {
      sessionId,
      teacherId,
      testName,
      answers: {},
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

  setAnswers(teacherId: number, raw: string): Record<number, string> {
    const session = this.getSessionByTeacher(teacherId);
    if (!session) {
      throw new Error("Faol sessiya yo'q. /yangitest buyrug'i bilan yangi test yarating.");
    }

    const answers: Record<number, string> = {};
    for (const pair of raw.trim().split(/\s+/)) {
      const match = pair.match(/^(\d+)-([A-Ea-e])$/);
      if (!match) {
        throw new Error(
          `Noto'g'ri format: "${pair}". To'g'ri format: 1-A 2-B 3-C (variantlar A–E)`,
        );
      }
      answers[parseInt(match[1], 10)] = match[2].toUpperCase();
    }

    session.answers = answers;
    this.persistSession(session);
    this.logger.log(`${session.sessionId} — ${Object.keys(answers).length} ta javob belgilandi.`);
    return answers;
  }

  setScoring(teacherId: number, rule: ScoringRule): void {
    const session = this.getSessionByTeacher(teacherId);
    if (!session) {
      throw new Error("Faol sessiya yo'q. Avval /yangitest buyrug'ini yuboring.");
    }
    session.scoring = rule;
    this.persistSession(session);
  }

  /**
   * Ends the session: persisted JSON file is deleted, memory is cleared.
   * Returns the final session snapshot (for Excel generation).
   */
  endSession(teacherId: number): Session {
    const session = this.sessions.get(teacherId);
    if (!session) {
      throw new Error("Faol test sessiyasi yo'q. /yangitest buyrug'i bilan yangi test yarating.");
    }

    // Delete the JSON file — test is over
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
    if (Object.keys(session.answers).length === 0) {
      throw new Error("O'qituvchi hali javoblarni kiritmagan. Kuting va qayta urinib ko'ring.");
    }

    const studentAnswers = this.parseAnswers(rawAnswers);
    const graded = this.grade(studentAnswers, session);

    const result: StudentResult = {
      userId,
      fullName,
      username,
      rawAnswers: rawAnswers.trim().toUpperCase(),
      ...graded,
      submittedAt: new Date(),
    };

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

  // ─── JSON persistence ─────────────────────────────────────────────────────────

  /** Writes the session snapshot to ./data/sessions/<sessionId>.json */
  private persistSession(session: Session): void {
    try {
      const payload: PersistedSession = {
        sessionId: session.sessionId,
        teacherId: session.teacherId,
        testName: session.testName,
        answers: session.answers,
        scoring: session.scoring,
        students: [...session.students.values()],
        createdAt: session.createdAt.toISOString(),
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
          answers: data.answers,
          scoring: data.scoring,
          students: new Map(data.students.map((s) => [s.userId, {
            ...s,
            submittedAt: new Date(s.submittedAt),
          }])),
          createdAt: new Date(data.createdAt),
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

  // ─── Private helpers ──────────────────────────────────────────────────────────

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

  private parseAnswers(raw: string): Record<number, string> {
    const map: Record<number, string> = {};
    for (const pair of raw.trim().split(/\s+/)) {
      const match = pair.match(/^(\d+)-([A-Ea-e])$/);
      if (!match) {
        throw new Error(
          `Noto'g'ri javob formati: "${pair}".\n\nTo'g'ri format: 1-A 2-B 3-C\nRuxsat etilgan variantlar: A B C D E`,
        );
      }
      map[parseInt(match[1], 10)] = match[2].toUpperCase();
    }
    return map;
  }

  private grade(
    studentAnswers: Record<number, string>,
    session: Session,
  ): Pick<StudentResult, 'correctCount' | 'wrongCount' | 'missingCount' | 'score' | 'maxScore'> {
    const correct = session.answers;
    let correctCount = 0;
    let wrongCount = 0;
    let missingCount = 0;

    for (const [qStr, expectedAnswer] of Object.entries(correct)) {
      const given = studentAnswers[parseInt(qStr, 10)];
      if (!given) missingCount++;
      else if (given === expectedAnswer) correctCount++;
      else wrongCount++;
    }

    const rawScore =
      correctCount * session.scoring.pointsPerCorrect -
      wrongCount * session.scoring.pointsPerWrong;
    const score = Math.max(0, rawScore);
    const maxScore = Object.keys(correct).length * session.scoring.pointsPerCorrect;

    return { correctCount, wrongCount, missingCount, score, maxScore };
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
