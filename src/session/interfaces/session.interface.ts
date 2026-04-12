export interface ScoringRule {
  pointsPerCorrect: number;
  pointsPerWrong: number;
}

export interface StudentResult {
  userId: number;
  fullName: string;
  username: string;
  rawAnswers: string;
  correctCount: number;
  wrongCount: number;
  missingCount: number;
  score: number;
  maxScore: number;
  submittedAt: Date;
}

export interface Session {
  sessionId: string;
  teacherId: number;
  testName: string;
  /** Map from question number → correct letter (uppercase A–E) */
  answers: Record<number, string>;
  scoring: ScoringRule;
  /** userId → StudentResult; Map preserves insertion order */
  students: Map<number, StudentResult>;
  createdAt: Date;
  /** NodeJS timer handle for TTL auto-expiry */
  ttlTimer?: ReturnType<typeof setTimeout>;
}
