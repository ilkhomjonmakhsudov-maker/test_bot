import { Injectable } from '@nestjs/common';
import { Lang } from './i18n';

export enum UserState {
  IDLE = 'IDLE',

  // ── Student ──────────────────────────────────────────────────────────────────
  /** After /start: waiting for the student to type their full name */
  AWAITING_NAME = 'AWAITING_NAME',

  // ── Teacher ──────────────────────────────────────────────────────────────────
  /** After /newtest (no inline arg): waiting for test title */
  TEACHER_AWAITING_TEST_NAME = 'TEACHER_AWAITING_TEST_NAME',
  /** After /setanswers (no inline arg): waiting for answer key */
  TEACHER_AWAITING_ANSWERS = 'TEACHER_AWAITING_ANSWERS',
  /** After /setball (no inline arg): waiting for scoring rule */
  TEACHER_AWAITING_SCORING = 'TEACHER_AWAITING_SCORING',
}

export interface UserSession {
  state: UserState;
  /** Student's registered full name (persists across test sessions) */
  fullName?: string;
  /** The sessionId the student has joined (cleared after test ends) */
  joinedSessionId?: string;
  /** Yordam matnlari tili; tanlanmagan bo'lsa Telegram profilidan olinadi */
  lang?: Lang;
}

export interface KnownUser {
  userId: number;
  username: string;
  name: string;
}

@Injectable()
export class UserSessionService {
  private readonly store = new Map<number, UserSession>();

  /**
   * Registry of every user who has ever messaged the bot.
   * Used by super admin to resolve @username → Telegram ID.
   */
  private readonly usernameIndex = new Map<string, number>(); // lowercase username → userId
  private readonly userInfoMap = new Map<number, KnownUser>(); // userId → info

  // ─── Session management ───────────────────────────────────────────────────────

  get(userId: number): UserSession {
    if (!this.store.has(userId)) {
      this.store.set(userId, { state: UserState.IDLE });
    }
    return this.store.get(userId)!;
  }

  patch(userId: number, patch: Partial<UserSession>): void {
    const current = this.get(userId);
    this.store.set(userId, { ...current, ...patch });
  }

  setState(userId: number, state: UserState): void {
    this.patch(userId, { state });
  }

  /** Clears only the bot-flow state, keeps fullName, joinedSessionId and lang */
  resetState(userId: number): void {
    const current = this.get(userId);
    this.store.set(userId, {
      state: UserState.IDLE,
      fullName: current.fullName,
      joinedSessionId: current.joinedSessionId,
      lang: current.lang,
    });
  }

  clearSession(userId: number): void {
    this.patch(userId, { joinedSessionId: undefined });
  }

  reset(userId: number): void {
    this.store.set(userId, { state: UserState.IDLE });
  }

  // ─── Til ──────────────────────────────────────────────────────────────────────

  /**
   * Tanlangan til. Xotirada saqlanadi — bot qayta ishga tushsa, til
   * yana Telegram profilidan aniqlanadi.
   */
  setLang(userId: number, lang: Lang): void {
    this.patch(userId, { lang });
  }

  getLang(userId: number): Lang | undefined {
    return this.get(userId).lang;
  }

  // ─── User registry (for @username → ID resolution) ────────────────────────────

  /**
   * Called on every /start so the bot learns who each username belongs to.
   */
  registerUser(userId: number, username: string, name: string): void {
    const info: KnownUser = { userId, username, name };
    this.userInfoMap.set(userId, info);
    if (username) {
      this.usernameIndex.set(username.toLowerCase(), userId);
    }
  }

  /**
   * Resolves a Telegram @username to a numeric user ID.
   * Returns undefined if the user has never messaged the bot.
   */
  resolveUsername(username: string): number | undefined {
    return this.usernameIndex.get(username.toLowerCase());
  }

  getUserInfo(userId: number): KnownUser | undefined {
    return this.userInfoMap.get(userId);
  }
}
