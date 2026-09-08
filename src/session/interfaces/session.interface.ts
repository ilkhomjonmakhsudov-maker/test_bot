export interface ScoringRule {
  pointsPerCorrect: number;
  pointsPerWrong: number;
}

/**
 * `variant` — javob A–E harflaridan biri, bot avtomatik tekshiradi.
 * `open`    — ochiq javob (masalan "18/60", "20x"), o'qituvchi tasdiqlaydi.
 */
export type QuestionType = 'variant' | 'open';

export interface QuestionKey {
  /** Savol raqami (1 dan boshlanadi) */
  number: number;
  type: QuestionType;
  /** To'g'ri javob: variant uchun "A"–"E", ochiq uchun erkin matn */
  answer: string;
  /** Ixtiyoriy savol matni (Excel orqali kiritilganda) */
  text?: string;
}

/**
 * `pending` — ochiq savol, o'qituvchi hali baholamagan.
 */
export type Verdict = 'correct' | 'wrong' | 'missing' | 'pending';

export interface StudentResult {
  userId: number;
  fullName: string;
  username: string;
  /** Talaba yuborgan xom matn (audit uchun) */
  rawAnswers: string;
  /** savol raqami → talaba javobi */
  answers: Record<number, string>;
  /** savol raqami → baho */
  verdicts: Record<number, Verdict>;
  correctCount: number;
  wrongCount: number;
  missingCount: number;
  /** O'qituvchi tekshiruvini kutayotgan ochiq savollar soni */
  pendingCount: number;
  score: number;
  maxScore: number;
  submittedAt: Date;
}

/**
 * ACTIVE  — talabalar javob topshira oladi.
 * GRADING — /yakunla yuborilgan: topshirish to'xtatilgan, Excel o'qituvchida,
 *           ochiq savollar bahosi kutilmoqda. Sessiya hali o'chirilmagan.
 */
export type SessionStatus = 'ACTIVE' | 'GRADING';

export interface Session {
  sessionId: string;
  teacherId: number;
  testName: string;
  status: SessionStatus;
  /** Savol raqami → kalit (tur + to'g'ri javob) */
  questions: Record<number, QuestionKey>;
  scoring: ScoringRule;
  /** userId → StudentResult; Map preserves insertion order */
  students: Map<number, StudentResult>;
  createdAt: Date;
  /** /yakunla yuborilgan vaqt */
  gradingStartedAt?: Date;
  /** NodeJS timer handle for TTL auto-expiry */
  ttlTimer?: ReturnType<typeof setTimeout>;
}

/** O'qituvchi Exceldan qaytargan qo'lda baho: userId + savol → to'g'rimi */
export interface ManualGrade {
  userId: number;
  question: number;
  correct: boolean;
}
