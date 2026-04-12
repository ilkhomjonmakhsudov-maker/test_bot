import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { UserSessionService, UserState } from './user-session.service';
import { TeacherService } from '../teacher/teacher.service';
import { TestSessionService } from '../session/session.service';
import { ExcelService } from '../excel/excel.service';
import { MessageBuilder } from './message-builder';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly bot: Telegraf;
  private readonly botMode: 'polling' | 'webhook';
  private readonly webhookUrl: string;
  private readonly superAdminIds: Set<number>;

  constructor(
    private readonly config: ConfigService,
    private readonly userSession: UserSessionService,
    private readonly teacherService: TeacherService,
    private readonly testSession: TestSessionService,
    private readonly excelService: ExcelService,
  ) {
    const token = this.config.get<string>('app.telegram.token');
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN .env faylida belgilanmagan');
    this.bot = new Telegraf(token);
    this.botMode = this.config.get<'polling' | 'webhook'>('app.telegram.botMode', 'polling');
    this.webhookUrl = this.config.get<string>('app.telegram.webhookUrl', '');
    this.superAdminIds = new Set(
      this.config.get<number[]>('app.superAdminIds', []),
    );
  }

  async onModuleInit() {
    this.registerHandlers();
    if (this.botMode === 'webhook' && this.webhookUrl) {
      await this.bot.telegram.setWebhook(`${this.webhookUrl}/telegram-webhook`);
      this.logger.log(`Webhook o'rnatildi → ${this.webhookUrl}/telegram-webhook`);
    } else {
      this.bot.launch({ dropPendingUpdates: true });
      this.logger.log('Bot polling rejimida ishga tushdi');
    }
  }

  async onModuleDestroy() {
    this.bot.stop('SIGTERM');
  }

  getBot(): Telegraf {
    return this.bot;
  }

  // ─── Buyruqlarni ro'yxatdan o'tkazish ────────────────────────────────────────

  private registerHandlers() {
    // Umumiy buyruqlar
    this.bot.start((ctx) => this.handleStart(ctx));
    this.bot.command('yordam', (ctx) => this.handleHelp(ctx));
    this.bot.command('bekor', (ctx) => this.handleCancel(ctx));

    // Super admin buyruqlari
    this.bot.command('oqituvchi_qosh', (ctx) => this.handleAddTeacher(ctx));
    this.bot.command('oqituvchi_ochir', (ctx) => this.handleRemoveTeacher(ctx));
    this.bot.command('oqituvchilar', (ctx) => this.handleListTeachers(ctx));

    // O'qituvchi buyruqlari
    this.bot.command('yangitest', (ctx) => this.handleNewTest(ctx));
    this.bot.command('javoblar', (ctx) => this.handleSetAnswers(ctx));
    this.bot.command('ball', (ctx) => this.handleSetBall(ctx));
    this.bot.command('natijalar', (ctx) => this.handleResults(ctx));
    this.bot.command('yakunla', (ctx) => this.handleEndTest(ctx));
    this.bot.command('holat', (ctx) => this.handleStatus(ctx));

    // Talaba buyruqlari
    this.bot.command('qoshil', (ctx) => this.handleJoin(ctx));
    this.bot.command('yuborish', (ctx) => this.handleSubmit(ctx));

    // Matnli xabarlar uchun holatlar mashina
    this.bot.on('text', (ctx) => this.handleText(ctx));

    this.bot.catch((err, ctx) => {
      this.logger.error(`Xato update ${ctx.update.update_id}:`, err);
    });
  }

  // ─── Yordamchi metodlar ───────────────────────────────────────────────────────

  private isSuperAdmin(userId: number): boolean {
    return this.superAdminIds.has(userId);
  }

  /** Super adminlar o'qituvchi sifatida ham barcha buyruqlardan foydalana oladi */
  private isTeacher(userId: number): boolean {
    return this.teacherService.isTeacher(userId) || this.isSuperAdmin(userId);
  }

  private md(ctx: Context, text: string) {
    return ctx.replyWithMarkdownV2(text);
  }

  /** Buyruq argumentlarini ajratib oladi: "/yangitest Biologiya" → "Biologiya" */
  private getArgs(ctx: Context): string {
    const text: string = (ctx.message as any)?.text ?? '';
    return text.replace(/^\/\S+\s*/, '').trim();
  }

  // ─── /start ───────────────────────────────────────────────────────────────────

  private async handleStart(ctx: Context) {
    const userId = ctx.from!.id;
    const rawUsername = ctx.from!.username ?? '';
    const telegramName = [ctx.from!.first_name, ctx.from!.last_name]
      .filter(Boolean)
      .join(' ');

    this.logger.log(
      `/start — Telegram ID: ${userId} | ism: "${telegramName}" | ${rawUsername ? '@' + rawUsername : 'username yo\'q'}`,
    );

    // Foydalanuvchini ro'yxatga qo'shish (super admin @username orqali topishi uchun)
    this.userSession.registerUser(userId, rawUsername, telegramName);

    if (this.isSuperAdmin(userId)) {
      await this.md(ctx, MessageBuilder.superAdminWelcome(telegramName));
      return;
    }

    if (this.isTeacher(userId)) {
      const teacher = this.teacherService.getTeacher(userId)!;
      await this.md(ctx, MessageBuilder.teacherWelcome(teacher.name));
      return;
    }

    // Talaba: to'liq ismini so'rash
    this.userSession.setState(userId, UserState.AWAITING_NAME);
    await this.md(ctx, MessageBuilder.studentWelcome());
  }

  // ─── /yordam ─────────────────────────────────────────────────────────────────

  private async handleHelp(ctx: Context) {
    const userId = ctx.from!.id;
    if (this.isSuperAdmin(userId)) {
      await this.md(ctx, MessageBuilder.superAdminHelp());
    } else if (this.isTeacher(userId)) {
      await this.md(ctx, MessageBuilder.teacherHelp());
    } else {
      await this.md(ctx, MessageBuilder.studentHelp());
    }
  }

  // ─── /bekor ──────────────────────────────────────────────────────────────────

  private async handleCancel(ctx: Context) {
    this.userSession.resetState(ctx.from!.id);
    await this.md(ctx, MessageBuilder.cancelled());
  }

  // ─── Super admin: /oqituvchi_qosh ────────────────────────────────────────────

  private async handleAddTeacher(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isSuperAdmin(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat super adminlar uchun.');
      return;
    }

    const arg = this.getArgs(ctx);
    if (!arg) {
      await ctx.reply(
        'Foydalanish:\n`/oqituvchi_qosh @username` — bot bilan muloqot qilgan bo\'lsa\n`/oqituvchi_qosh 123456789` — Telegram ID orqali',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    let targetId: number;
    let displayName: string;

    if (arg.startsWith('@')) {
      const username = arg.slice(1);
      const resolved = this.userSession.resolveUsername(username);
      if (!resolved) {
        await ctx.reply(
          `❌ @${username} hali bu botga /start yubormagan.\n\n` +
          `Avval /start yuborishini so'rang yoki Telegram ID orqali qo'shing:\n\`/oqituvchi_qosh <id>\``,
          { parse_mode: 'Markdown' },
        );
        return;
      }
      targetId = resolved;
      const info = this.userSession.getUserInfo(resolved);
      displayName = info?.name || `@${username}`;
    } else {
      targetId = parseInt(arg, 10);
      if (isNaN(targetId)) {
        await ctx.reply('❌ Noto\'g\'ri argument. @username yoki raqamli Telegram ID kiriting.');
        return;
      }
      const info = this.userSession.getUserInfo(targetId);
      displayName = info?.name || `ID ${targetId}`;
    }

    if (this.isSuperAdmin(targetId)) {
      await ctx.reply('⚠️ Bu foydalanuvchi allaqachon super admin.');
      return;
    }

    const added = this.teacherService.addTeacher(targetId, displayName);
    if (!added) {
      await ctx.reply(`⚠️ ${displayName} allaqachon o'qituvchilar ro'yxatida.`);
      return;
    }

    await this.md(ctx, MessageBuilder.teacherAdded(displayName, targetId));
  }

  // ─── Super admin: /oqituvchi_ochir ───────────────────────────────────────────

  private async handleRemoveTeacher(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isSuperAdmin(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat super adminlar uchun.');
      return;
    }

    const arg = this.getArgs(ctx);
    if (!arg) {
      await ctx.reply(
        'Foydalanish:\n`/oqituvchi_ochir @username`\n`/oqituvchi_ochir 123456789`',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    let targetId: number;
    let displayName: string;

    if (arg.startsWith('@')) {
      const username = arg.slice(1);
      const resolved = this.userSession.resolveUsername(username);
      if (!resolved) {
        await ctx.reply(`❌ @${username} ro'yxatdan topilmadi. Telegram ID orqali urining.`);
        return;
      }
      targetId = resolved;
      displayName = `@${username}`;
    } else {
      targetId = parseInt(arg, 10);
      if (isNaN(targetId)) {
        await ctx.reply('❌ Noto\'g\'ri argument. @username yoki raqamli Telegram ID kiriting.');
        return;
      }
      displayName = `ID ${targetId}`;
    }

    const removed = this.teacherService.removeTeacher(targetId);
    if (!removed) {
      await ctx.reply(`❌ ${displayName} o'qituvchilar ro'yxatida topilmadi.`);
      return;
    }

    await this.md(ctx, MessageBuilder.teacherRemoved(displayName, targetId));
  }

  // ─── Super admin: /oqituvchilar ───────────────────────────────────────────────

  private async handleListTeachers(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isSuperAdmin(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat super adminlar uchun.');
      return;
    }
    const teachers = this.teacherService.getAllTeachers();
    await this.md(ctx, MessageBuilder.teacherList(teachers));
  }

  // ─── O'qituvchi: /yangitest ───────────────────────────────────────────────────

  private async handleNewTest(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }

    const args = this.getArgs(ctx);
    if (args) {
      await this.createTestSession(ctx, args);
    } else {
      this.userSession.setState(userId, UserState.TEACHER_AWAITING_TEST_NAME);
      await ctx.reply('📝 Test nomini kiriting:');
    }
  }

  private async createTestSession(ctx: Context, testName: string) {
    const userId = ctx.from!.id;
    try {
      const session = this.testSession.createSession(userId, testName.trim());
      await this.md(ctx, MessageBuilder.sessionCreated(session));
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  // ─── O'qituvchi: /javoblar ────────────────────────────────────────────────────

  private async handleSetAnswers(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }

    const args = this.getArgs(ctx);
    if (args) {
      await this.processSetAnswers(ctx, args);
    } else {
      this.userSession.setState(userId, UserState.TEACHER_AWAITING_ANSWERS);
      await ctx.reply(
        '📋 To\'g\'ri javoblarni kiriting:\nMisol: `1-A 2-C 3-B 4-D`\nVariantlar: A B C D E',
        { parse_mode: 'Markdown' },
      );
    }
  }

  private async processSetAnswers(ctx: Context, raw: string) {
    const userId = ctx.from!.id;
    try {
      const answers = this.testSession.setAnswers(userId, raw);
      const count = Object.keys(answers).length;
      const preview = Object.entries(answers)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([q, a]) => `${q}-${a}`)
        .join(' ');
      this.userSession.resetState(userId);
      await this.md(ctx, MessageBuilder.answersSet(count, preview));
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  // ─── O'qituvchi: /ball ────────────────────────────────────────────────────────

  private async handleSetBall(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }

    const args = this.getArgs(ctx);
    if (args) {
      await this.processSetScoring(ctx, args);
    } else {
      this.userSession.setState(userId, UserState.TEACHER_AWAITING_SCORING);
      await ctx.reply(
        '⚙️ Baholash tizimini kiriting:\n' +
        '`1` → 1 ball to\'g\'ri, jarima yo\'q\n' +
        '`1 0.25` → 1 ball to\'g\'ri, noto\'g\'ri uchun -0.25\n' +
        '`2 1` → 2 ball to\'g\'ri, noto\'g\'ri uchun -1',
        { parse_mode: 'Markdown' },
      );
    }
  }

  private async processSetScoring(ctx: Context, raw: string) {
    const userId = ctx.from!.id;
    try {
      const rule = this.parseScoringString(raw);
      this.testSession.setScoring(userId, rule);
      this.userSession.resetState(userId);
      await this.md(ctx, MessageBuilder.scoringSet(rule.pointsPerCorrect, rule.pointsPerWrong));
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  private parseScoringString(raw: string): { pointsPerCorrect: number; pointsPerWrong: number } {
    const parts = raw.trim().split(/[\s/]+/);
    const pointsPerCorrect = parseFloat(parts[0]);
    const pointsPerWrong = parts[1] ? Math.abs(parseFloat(parts[1])) : 0;

    if (isNaN(pointsPerCorrect) || pointsPerCorrect < 0) {
      throw new Error('Noto\'g\'ri format. Misol: "1" yoki "1 0.25" yoki "2 1"');
    }

    return { pointsPerCorrect, pointsPerWrong };
  }

  // ─── O'qituvchi: /holat ───────────────────────────────────────────────────────

  private async handleStatus(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }

    const session = this.testSession.getSessionByTeacher(userId);
    if (!session) {
      await ctx.reply('Faol test sessiyasi yo\'q. /yangitest buyrug\'i bilan yangi test yarating.');
      return;
    }

    await this.md(ctx, MessageBuilder.sessionStatus(session));
  }

  // ─── O'qituvchi: /natijalar ───────────────────────────────────────────────────

  private async handleResults(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }

    const session = this.testSession.getSessionByTeacher(userId);
    if (!session) {
      await ctx.reply('Faol test sessiyasi yo\'q. /yangitest buyrug\'i bilan yangi test yarating.');
      return;
    }

    await this.md(ctx, MessageBuilder.resultsSummary(session));
  }

  // ─── O'qituvchi: /yakunla ────────────────────────────────────────────────────

  private async handleEndTest(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }

    try {
      const session = this.testSession.getSessionByTeacher(userId);
      if (!session) {
        await ctx.reply('Faol test sessiyasi yo\'q. /yangitest buyrug\'i bilan yangi test yarating.');
        return;
      }

      if (session.students.size === 0) {
        await ctx.reply('⚠️ Hali hech kim javob topshirmagan. Test baribir yakunlanadi.');
      }

      // Barcha talabalar ro'yxatini olish (sessiya o'chirilishidan oldin)
      const students = [...session.students.values()];

      // Excel generatsiya qilish (ma'lumotlar o'chirilishidan oldin)
      let excelBuffer: Buffer | null = null;
      if (students.length > 0) {
        excelBuffer = await this.excelService.generateResultsBuffer(session);
      }

      // Sessiyani xotira va fayldan o'chirish
      this.testSession.endSession(userId);

      // Excel faylini o'qituvchiga yuborish
      if (excelBuffer) {
        const safeName = session.testName.replace(/[^a-zA-Z0-9_\-]/g, '_');
        await ctx.replyWithDocument(
          { source: excelBuffer, filename: `${safeName}_natijalari.xlsx` },
          { caption: `📊 "${session.testName}" test natijalari` },
        );
      }

      // O'qituvchiga umumiy xulosa yuborish
      await this.md(ctx, MessageBuilder.testEnded(session));

      // O'qituvchiga har bir talabaning batafsil javobi (sahifalangan)
      if (students.length > 0) {
        const pages = MessageBuilder.teacherDetailedBreakdown(session);
        for (const page of pages) {
          await this.md(ctx, page);
        }
      }

      // Har bir talabaga shaxsiy, to'liq natija xabari yuborish
      if (students.length > 0) {
        await ctx.reply(`📨 ${students.length} ta talabaga shaxsiy natija yuborilmoqda...`);

        let sent = 0;
        for (const student of students) {
          try {
            const msg = MessageBuilder.detailedStudentResult(student, session);
            await ctx.telegram.sendMessage(student.userId, msg, {
              parse_mode: 'MarkdownV2',
            });
            sent++;
          } catch (err) {
            // Student may have blocked the bot — log and continue
            this.logger.warn(
              `Talabaga xabar yuborib bo'lmadi (userId=${student.userId}, ism="${student.fullName}"): ${(err as Error).message}`,
            );
          }
        }

        if (sent < students.length) {
          await ctx.reply(
            `⚠️ ${sent}/${students.length} talabaga yuborildi. ` +
            `${students.length - sent} ta talaba botni bloklagan bo'lishi mumkin.`,
          );
        } else {
          await ctx.reply(`✅ Barcha ${sent} ta talabaga shaxsiy natija yuborildi.`);
        }
      }
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  // ─── Talaba: /qoshil ─────────────────────────────────────────────────────────

  private async handleJoin(ctx: Context) {
    const userId = ctx.from!.id;

    if (this.isTeacher(userId)) {
      await ctx.reply('O\'qituvchilar test sessiyasiga qo\'shilmaydi.');
      return;
    }

    const us = this.userSession.get(userId);
    if (!us.fullName) {
      await ctx.reply('Avval ismingizni kiriting. /start buyrug\'ini yuboring.');
      return;
    }

    const sessionId = this.getArgs(ctx).toUpperCase();
    if (!sessionId) {
      await ctx.reply(
        'Foydalanish: `/qoshil <sessiya_id>`\nMisol: `/qoshil K8X2MA`',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const session = this.testSession.getSessionById(sessionId);
    if (!session) {
      await ctx.reply(
        `❌ "${sessionId}" sessiyasi topilmadi yoki yakunlangan. ID ni tekshirib qayta urining.`,
      );
      return;
    }

    this.userSession.patch(userId, { joinedSessionId: session.sessionId });
    await this.md(ctx, MessageBuilder.joinedSession(session));
  }

  // ─── Talaba: /yuborish ────────────────────────────────────────────────────────

  private async handleSubmit(ctx: Context) {
    const userId = ctx.from!.id;

    if (this.isTeacher(userId)) {
      await ctx.reply('O\'qituvchilar javob topshirmaydi.');
      return;
    }

    const us = this.userSession.get(userId);

    if (!us.fullName) {
      await ctx.reply('Avval ismingizni kiriting. /start buyrug\'ini yuboring.');
      return;
    }

    if (!us.joinedSessionId) {
      await ctx.reply(
        'Siz hali testga qo\'shilmagansiz. Avval `/qoshil <sessiya_id>` buyrug\'ini yuboring.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const raw = this.getArgs(ctx);
    if (!raw) {
      await ctx.reply(
        'Foydalanish: `/yuborish 1-A 2-B 3-C ...`\nBarcha javoblarni bitta xabarda yuboring.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    await this.processSubmit(ctx, us.joinedSessionId, raw);
  }

  private async processSubmit(ctx: Context, sessionId: string, raw: string) {
    const userId = ctx.from!.id;
    const us = this.userSession.get(userId);
    const username = ctx.from!.username ?? '';

    try {
      const result = this.testSession.submitAnswers(
        sessionId,
        userId,
        us.fullName!,
        username,
        raw,
      );
      await this.md(ctx, MessageBuilder.submissionResult(result));
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  // ─── Matnli xabarlar uchun holat mashina ─────────────────────────────────────

  private async handleText(ctx: Context) {
    const userId = ctx.from!.id;
    const text: string = (ctx.message as any)?.text ?? '';
    const us = this.userSession.get(userId);

    switch (us.state) {
      case UserState.AWAITING_NAME:
        return this.handleNameEntry(ctx, text);

      case UserState.TEACHER_AWAITING_TEST_NAME:
        return this.createTestSession(ctx, text);

      case UserState.TEACHER_AWAITING_ANSWERS:
        return this.processSetAnswers(ctx, text);

      case UserState.TEACHER_AWAITING_SCORING:
        return this.processSetScoring(ctx, text);

      default: {
        if (this.isSuperAdmin(userId)) {
          await ctx.reply('Buyruqlar ro\'yxati uchun /yordam yuboring.');
        } else if (this.isTeacher(userId)) {
          await ctx.reply('Buyruqlar ro\'yxati uchun /yordam yuboring.');
        } else if (!us.fullName) {
          await ctx.reply('Ismingizni ro\'yxatdan o\'tkazish uchun /start yuboring.');
        } else if (us.joinedSessionId) {
          // Talaba sessiyaga qo'shilgan — javob formatiga o'xshash matn bo'lsa
          if (/^\d+-[A-Ea-e]/i.test(text.trim())) {
            await this.processSubmit(ctx, us.joinedSessionId, text);
          } else {
            await ctx.reply(
              'Javoblarni yuborish uchun `/yuborish 1-A 2-B ...` buyrug\'ini ishlating.',
              { parse_mode: 'Markdown' },
            );
          }
        } else {
          await ctx.reply(
            'Testga qo\'shilish uchun `/qoshil <sessiya_id>` buyrug\'ini yuboring.',
            { parse_mode: 'Markdown' },
          );
        }
      }
    }
  }

  private async handleNameEntry(ctx: Context, name: string) {
    const userId = ctx.from!.id;
    const trimmed = name.trim();

    if (trimmed.split(/\s+/).length < 2 || trimmed.length < 4) {
      await ctx.reply(
        '❌ Iltimos, *to\'liq ismingizni* kiriting (Ism va Familiya).\nMisol: `Abdullayev Jasur`',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    this.userSession.patch(userId, {
      fullName: trimmed,
      state: UserState.IDLE,
    });

    await this.md(ctx, MessageBuilder.nameSet(trimmed));
  }
}
