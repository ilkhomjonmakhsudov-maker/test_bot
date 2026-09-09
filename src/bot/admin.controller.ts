import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AdminService } from '../admin/admin.service';
import { TestSessionService } from '../session/session.service';
import { BotService } from './bot.service';
import { InitDataError, verifyInitData, WebAppUser } from './webapp-auth';

interface ActionBody {
  initData: string;
  action: string;
  /** Amalga qarab: savol raqami, talaba ID si, sessiya ID si va h.k. */
  question?: number;
  studentId?: number;
  sessionId?: string;
  answer?: string;
  correct?: boolean;
  pointsPerCorrect?: number;
  pointsPerWrong?: number;
}

/**
 * Telegram Mini App — "veb panel".
 *
 * Login yo'q: har bir so'rov Telegram imzolagan `initData` bilan keladi,
 * imzo bot tokeni orqali tekshiriladi (webapp-auth.ts).
 */
@Controller('panel')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  private readonly botToken: string;
  private html: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly admin: AdminService,
    private readonly sessions: TestSessionService,
    private readonly bot: BotService,
  ) {
    this.botToken = this.config.get<string>('app.telegram.token', '');
  }

  // ─── Sahifa ─────────────────────────────────────────────────────────────────

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(@Res() res: Response) {
    if (this.html === null) {
      const file = path.join(__dirname, '..', 'public', 'panel.html');
      const fallback = path.join(process.cwd(), 'src', 'public', 'panel.html');
      const source = fs.existsSync(file) ? file : fallback;
      this.html = fs.existsSync(source)
        ? fs.readFileSync(source, 'utf-8')
        : '<h1>panel.html topilmadi</h1>';
    }
    res.send(this.html);
  }

  // ─── API ────────────────────────────────────────────────────────────────────

  /** Panelning butun holati — bitta so'rovda */
  @Post('api/state')
  state(@Body() body: { initData: string }) {
    const user = this.auth(body?.initData);
    const role = this.admin.roleOf(user.id);

    const dashboard = this.admin.dashboard(user.id);
    const hasSession = dashboard.session !== null;

    return {
      role,
      user: { id: user.id, name: this.admin.teacherName(user.id) },
      dashboard,
      standings: hasSession ? this.admin.standings(user.id) : [],
      key: hasSession ? this.admin.keyListing(user.id) : [],
      pending: hasSession ? this.admin.pendingQueue(user.id) : [],
      superAdmin:
        role === 'super'
          ? {
              sessions: this.admin.allSessions(),
              teachers: this.admin.teacherList(),
              stats: this.admin.statistics(),
              activeSessions: this.admin.activeSessionCount(),
            }
          : null,
    };
  }

  /** Barcha o'zgartirishlar shu yerdan o'tadi */
  @Post('api/action')
  async action(@Body() body: ActionBody) {
    const user = this.auth(body?.initData);
    const userId = user.id;

    try {
      switch (body.action) {
        case 'grade':
          this.require(body.studentId !== undefined && body.question !== undefined, 'studentId va question kerak');
          this.admin.gradeOne(userId, body.studentId!, body.question!, body.correct === true);
          break;

        case 'gradeAll':
          this.admin.gradeAllRemaining(userId, body.correct === true);
          break;

        case 'acceptGuesses':
          this.admin.acceptGuesses(userId);
          break;

        case 'toggleType':
          this.require(body.question !== undefined, 'question kerak');
          this.admin.toggleQuestionType(userId, body.question!);
          break;

        case 'setAnswer':
          this.require(body.question !== undefined && !!body.answer, 'question va answer kerak');
          this.admin.setQuestionAnswer(userId, body.question!, body.answer!);
          break;

        case 'setScoring':
          this.admin.setScoring(
            userId,
            Number(body.pointsPerCorrect),
            Number(body.pointsPerWrong),
          );
          break;

        case 'stop': {
          const session = this.admin.stopTest(userId);
          await this.bot.announceToSession(
            session,
            `⏹ *"${this.esc(session.testName)}" testi yakunlandi\\.*\n\n` +
            `Javoblaringiz qabul qilindi\\. Natijalar o'qituvchi tekshiruvidan so'ng yuboriladi\\.`,
          );
          break;
        }

        case 'resume': {
          const session = this.admin.resume(userId);
          await this.bot.announceToSession(
            session,
            `🟢 *"${this.esc(session.testName)}" testi qayta ochildi\\.*\n\n` +
            `Javoblaringizni qayta yuborishingiz mumkin\\.`,
          );
          break;
        }

        // ── Super admin ─────────────────────────────────────────────────
        case 'forceStop':
        case 'forceResume': {
          this.admin.assertSuperAdmin(userId);
          this.require(!!body.sessionId, 'sessionId kerak');
          const stopping = body.action === 'forceStop';
          const overview = stopping
            ? this.admin.forceStop(body.sessionId!)
            : this.admin.forceResume(body.sessionId!);

          const session = this.sessions.getSessionById(body.sessionId!);
          if (session) {
            const notice = stopping
              ? `⏹ *"${this.esc(session.testName)}" testi administrator tomonidan to'xtatildi\\.*`
              : `🟢 *"${this.esc(session.testName)}" testi administrator tomonidan qayta ochildi\\.*`;
            await this.bot.announceToSession(session, notice);
            await this.bot.notifyUser(overview.teacherId, notice);
          }
          break;
        }

        default:
          throw new HttpException(
            `Noma'lum amal: ${body.action}`,
            HttpStatus.BAD_REQUEST,
          );
      }
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }

    // Amaldan keyingi yangi holat — mijoz qayta so'ramaydi
    return this.state({ initData: body.initData });
  }

  // ─── Yordamchi ──────────────────────────────────────────────────────────────

  private auth(initData: string): WebAppUser {
    let user: WebAppUser;
    try {
      user = verifyInitData(initData, this.botToken);
    } catch (e: any) {
      if (e instanceof InitDataError) {
        throw new HttpException(e.message, HttpStatus.UNAUTHORIZED);
      }
      throw e;
    }

    if (!this.admin.isTeacher(user.id)) {
      this.logger.warn(`Panelga ruxsatsiz urinish: ${user.id}`);
      throw new HttpException(
        "Bu panel faqat o'qituvchilar va adminlar uchun.",
        HttpStatus.FORBIDDEN,
      );
    }

    return user;
  }

  private require(condition: boolean, message: string): void {
    if (!condition) throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }

  /** MarkdownV2 uchun — xabarlar Telegramga boradi */
  private esc(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }
}
