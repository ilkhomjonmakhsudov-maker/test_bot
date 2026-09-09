import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { UserSessionService, UserState } from './user-session.service';
import { PanelService, PanelView } from './panel.service';
import { AdminService } from '../admin/admin.service';
import {
  Lang,
  detectLang,
  normalizeLang,
  keyFormatHelp,
  submitFormatHelp,
  languagePrompt,
  languageSet,
  languageUnknown,
} from './i18n';
import { TeacherService } from '../teacher/teacher.service';
import { TestSessionService } from '../session/session.service';
import { Session } from '../session/interfaces/session.interface';
import { ExcelService } from '../excel/excel.service';
import { MessageBuilder } from './message-builder';

/** Telegram orqali qabul qilinadigan maksimal Excel hajmi */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Telegram MarkdownV2 uchun maxsus belgilarni ekranlaydi */
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

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
    private readonly panel: PanelService,
    private readonly admin: AdminService,
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
    try {
      this.bot.stop('SIGTERM');
    } catch (err) {
      // Bot ishga tushmagan bo'lsa (masalan token noto'g'ri) — stop() xato
      // beradi; bu o'chirishni to'xtatmasligi kerak.
      this.logger.warn(`Botni to'xtatishda xato: ${(err as Error).message}`);
    }
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
    this.bot.command('til', (ctx) => this.handleLanguage(ctx));
    this.bot.command('panel', (ctx) => this.handlePanel(ctx));
    this.bot.command('javob_format', (ctx) => this.handleSubmitFormat(ctx));

    // Super admin buyruqlari
    this.bot.command('oqituvchi_qosh', (ctx) => this.handleAddTeacher(ctx));
    this.bot.command('oqituvchi_ochir', (ctx) => this.handleRemoveTeacher(ctx));
    this.bot.command('oqituvchilar', (ctx) => this.handleListTeachers(ctx));

    // O'qituvchi buyruqlari
    this.bot.command('yangitest', (ctx) => this.handleNewTest(ctx));
    this.bot.command('javoblar', (ctx) => this.handleSetAnswers(ctx));
    this.bot.command('ball', (ctx) => this.handleSetBall(ctx));
    this.bot.command('namuna', (ctx) => this.handleTemplate(ctx));
    this.bot.command('kalit_format', (ctx) => this.handleKeyFormat(ctx));
    this.bot.command('natijalar', (ctx) => this.handleResults(ctx));
    this.bot.command('yakunla', (ctx) => this.handleStopTest(ctx));
    this.bot.command('davom', (ctx) => this.handleResume(ctx));
    this.bot.command('natijalarni_yubor', (ctx) => this.handleSendResults(ctx));
    this.bot.command('holat', (ctx) => this.handleStatus(ctx));

    // Talaba buyruqlari
    this.bot.command('qoshil', (ctx) => this.handleJoin(ctx));
    this.bot.command('yuborish', (ctx) => this.handleSubmit(ctx));

    // Panel tugmalari
    this.bot.on('callback_query', (ctx) => this.handleCallback(ctx));

    // Excel fayllar: kalit yoki baholangan natijalar
    this.bot.on('document', (ctx) => this.handleDocument(ctx));

    // Matnli xabarlar uchun holatlar mashina
    this.bot.on('text', (ctx) => this.handleText(ctx));

    this.bot.catch((err, ctx) => {
      this.logger.error(`Xato update ${ctx.update.update_id}:`, err);
    });
  }

  // ─── Veb panel uchun xabarlar (ctx bo'lmaganda) ──────────────────────────────

  /**
   * Sessiyadagi barcha talabalarga xabar. Mini App HTTP so'rovidan
   * chaqiriladi — u yerda Telegraf konteksti yo'q, shuning uchun bot
   * to'g'ridan-to'g'ri ishlatiladi.
   */
  async announceToSession(session: Session, message: string): Promise<void> {
    for (const student of session.students.values()) {
      await this.notifyUser(student.userId, message);
    }
  }

  /** Bitta foydalanuvchiga xabar; bloklagan bo'lsa jim o'tkazib yuboriladi */
  async notifyUser(userId: number, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(userId, message, {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.warn(
        `Xabar yuborib bo'lmadi (userId=${userId}): ${(err as Error).message}`,
      );
    }
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

  /**
   * Yordam matnlari tili: buyruq argumenti → tanlangan til →
   * Telegram profilidagi til → o'zbekcha.
   */
  private langOf(ctx: Context, arg?: string): Lang {
    const requested = arg ? normalizeLang(arg) : null;
    if (requested) return requested;

    const stored = this.userSession.getLang(ctx.from!.id);
    if (stored) return stored;

    return detectLang(ctx.from?.language_code);
  }

  // ─── /til ─────────────────────────────────────────────────────────────────────

  /** Yordam matnlari tilini tanlaydi: /til uz | ru | en */
  private async handleLanguage(ctx: Context) {
    const userId = ctx.from!.id;
    const arg = this.getArgs(ctx);
    const current = this.langOf(ctx);

    if (!arg) {
      await ctx.reply(languagePrompt(current));
      return;
    }

    const chosen = normalizeLang(arg);
    if (!chosen) {
      await ctx.reply(languageUnknown(current, arg));
      return;
    }

    this.userSession.setLang(userId, chosen);
    await ctx.reply(languageSet(chosen));
  }

  // ─── /kalit_format (o'qituvchi) ───────────────────────────────────────────────

  /** Kalit yozuv formatlari. Til: /kalit_format ru */
  private async handleKeyFormat(ctx: Context) {
    if (!this.isTeacher(ctx.from!.id)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }
    await this.md(ctx, keyFormatHelp(this.langOf(ctx, this.getArgs(ctx))));
  }

  // ─── /javob_format (talaba) ───────────────────────────────────────────────────

  /** Javob yuborish formatlari. Til: /javob_format en */
  private async handleSubmitFormat(ctx: Context) {
    await this.md(ctx, submitFormatHelp(this.langOf(ctx, this.getArgs(ctx))));
  }

  // ─── /panel ───────────────────────────────────────────────────────────────────

  /** Inline tugmali boshqaruv paneli */
  private async handlePanel(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.admin.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar va adminlar uchun.');
      return;
    }
    await this.showPanel(ctx, this.panel.home(this.admin.dashboard(userId)));
  }

  /** Yangi xabar sifatida yuboradi */
  private async showPanel(ctx: Context, view: PanelView) {
    await ctx.reply(view.text, {
      parse_mode: 'MarkdownV2',
      reply_markup: view.keyboard,
    });
  }

  /**
   * Mavjud xabarni almashtiradi — panel bitta xabar ichida "yashaydi",
   * chatni tugmali xabarlar bilan to'ldirmaydi.
   */
  private async editPanel(ctx: Context, view: PanelView) {
    try {
      await ctx.editMessageText(view.text, {
        parse_mode: 'MarkdownV2',
        reply_markup: view.keyboard,
      });
    } catch (err) {
      // "message is not modified" — foydalanuvchi bir tugmani ikki marta bosgan
      const message = (err as Error).message ?? '';
      if (!/not modified/i.test(message)) {
        this.logger.warn(`Panelni yangilab bo'lmadi: ${message}`);
        await this.showPanel(ctx, view);
      }
    }
  }

  // ─── Panel tugmalari ──────────────────────────────────────────────────────────

  private async handleCallback(ctx: Context) {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    const userId = ctx.from!.id;

    if (!data || !data.startsWith('p:')) {
      await ctx.answerCbQuery();
      return;
    }

    if (!this.admin.isTeacher(userId)) {
      await ctx.answerCbQuery('⛔ Ruxsat yo\'q', { show_alert: true });
      return;
    }

    try {
      await this.routeCallback(ctx, userId, data.slice(2));
    } catch (e: any) {
      this.logger.warn(`Panel amali xato (${data}): ${e.message}`);
      await ctx.answerCbQuery(e.message.slice(0, 190), { show_alert: true });
    }
  }

  /** `data` — "p:" prefiksisiz */
  private async routeCallback(ctx: Context, userId: number, data: string) {
    const parts = data.split(':');

    switch (parts[0]) {
      // ── Bosh sahifa ──────────────────────────────────────────────────────
      case 'home':
        await ctx.answerCbQuery();
        return this.editPanel(ctx, this.panel.home(this.admin.dashboard(userId)));

      case 'res': {
        await ctx.answerCbQuery();
        const session = this.admin.requireSession(userId);
        return this.editPanel(
          ctx,
          this.panel.results(this.admin.standings(userId), this.admin.overview(session)),
        );
      }

      case 'key': {
        await ctx.answerCbQuery();
        const session = this.admin.requireSession(userId);
        return this.editPanel(
          ctx,
          this.panel.keyView(this.admin.keyListing(userId), this.admin.overview(session)),
        );
      }

      // ── Savol turini almashtirish ────────────────────────────────────────
      case 'kt': {
        const question = parseInt(parts[1], 10);
        const updated = this.admin.toggleQuestionType(userId, question);
        await ctx.answerCbQuery(
          `${question}-savol: ${updated.type === 'open' ? 'ochiq' : 'variantli'}`,
        );
        const session = this.admin.requireSession(userId);
        return this.editPanel(
          ctx,
          this.panel.keyView(this.admin.keyListing(userId), this.admin.overview(session)),
        );
      }

      // ── Ochiq javoblarni baholash ────────────────────────────────────────
      case 'grade':
        await ctx.answerCbQuery();
        return this.showNextPending(ctx, userId);

      case 'g': {
        const studentId = parseInt(parts[1], 10);
        const question = parseInt(parts[2], 10);
        const correct = parts[3] === '1';
        this.admin.gradeOne(userId, studentId, question, correct);
        await ctx.answerCbQuery(correct ? '✅ To\'g\'ri' : '❌ Xato');
        return this.showNextPending(ctx, userId);
      }

      case 'ga': {
        const correct = parts[1] === '1';
        const count = this.admin.gradeAllRemaining(userId, correct);
        await ctx.answerCbQuery(`${count} ta javob belgilandi`);
        return this.showNextPending(ctx, userId);
      }

      case 'gq': {
        const count = this.admin.acceptGuesses(userId);
        await ctx.answerCbQuery(`🤖 ${count} ta javob bot taxmini bo'yicha belgilandi`);
        return this.showNextPending(ctx, userId);
      }

      // ── Sessiya hayoti ───────────────────────────────────────────────────
      case 'stop':
        await ctx.answerCbQuery('Yakunlanmoqda...');
        await this.stopTest(ctx, userId);
        return this.showPanel(ctx, this.panel.home(this.admin.dashboard(userId)));

      case 'resume':
        await ctx.answerCbQuery('Qayta ochilmoqda...');
        await this.resumeTest(ctx, userId);
        return this.showPanel(ctx, this.panel.home(this.admin.dashboard(userId)));

      case 'send': {
        const session = this.admin.requireSession(userId);
        const pending = this.testSession.countPending(session);
        if (pending > 0) {
          await ctx.answerCbQuery(
            `⏳ ${pending} ta javob tekshirilmagan. Avval ularni baholang.`,
            { show_alert: true },
          );
          return this.showNextPending(ctx, userId);
        }
        await ctx.answerCbQuery('Yuborilmoqda...');
        return this.sendResults(ctx, userId, false);
      }

      case 'ball':
        await ctx.answerCbQuery();
        this.userSession.setState(userId, UserState.TEACHER_AWAITING_SCORING);
        return ctx.reply(
          '⚙️ Yangi baholash tizimini yuboring.\n' +
          'Misol: `1` yoki `1 0.25` (to\'g\'ri ball, xato uchun jarima)',
          { parse_mode: 'Markdown' },
        );

      // ── Super admin ──────────────────────────────────────────────────────
      case 'sa':
        return this.routeSuperAdmin(ctx, userId, parts.slice(1));

      default:
        await ctx.answerCbQuery();
        return;
    }
  }

  private async routeSuperAdmin(ctx: Context, userId: number, parts: string[]) {
    this.admin.assertSuperAdmin(userId);

    switch (parts[0]) {
      case undefined:
        await ctx.answerCbQuery();
        return this.editPanel(
          ctx,
          this.panel.superHome(
            this.admin.activeSessionCount(),
            this.admin.teacherList().length,
          ),
        );

      case 's':
        await ctx.answerCbQuery();
        return this.editPanel(ctx, this.panel.allSessions(this.admin.allSessions()));

      case 't':
        await ctx.answerCbQuery();
        return this.editPanel(ctx, this.panel.teacherList(this.admin.teacherList()));

      case 'st':
        await ctx.answerCbQuery();
        return this.editPanel(
          ctx,
          this.panel.statistics(this.admin.statistics(), this.admin.activeSessionCount()),
        );

      // Boshqa o'qituvchining sessiyasini to'xtatish / ochish
      case 'x':
      case 'o': {
        const sessionId = parts[1];
        const overview =
          parts[0] === 'x'
            ? this.admin.forceStop(sessionId)
            : this.admin.forceResume(sessionId);

        await ctx.answerCbQuery(
          parts[0] === 'x' ? `⏹ ${sessionId} to'xtatildi` : `▶️ ${sessionId} ochildi`,
        );

        // Egasiga va talabalarga xabar berish
        const session = this.testSession.getSessionById(sessionId);
        if (session) {
          const notice =
            parts[0] === 'x'
              ? `⏹ *"${escapeMd(session.testName)}" testi administrator tomonidan to'xtatildi\.*`
              : `🟢 *"${escapeMd(session.testName)}" testi administrator tomonidan qayta ochildi\.*`;
          await this.notifyStudents(ctx, session, notice);
          try {
            await ctx.telegram.sendMessage(overview.teacherId, notice, {
              parse_mode: 'MarkdownV2',
            });
          } catch {
            // O'qituvchi botni bloklagan bo'lishi mumkin
          }
        }

        return this.editPanel(ctx, this.panel.allSessions(this.admin.allSessions()));
      }

      default:
        await ctx.answerCbQuery();
        return;
    }
  }

  /** Navbatdagi tekshirilmagan javobni ko'rsatadi, tugagach — bosh sahifa */
  private async showNextPending(ctx: Context, userId: number) {
    const queue = this.admin.pendingQueue(userId);
    const session = this.admin.requireSession(userId);

    if (queue.length === 0) {
      return this.editPanel(ctx, this.panel.gradingDone(this.admin.overview(session)));
    }

    return this.editPanel(ctx, this.panel.gradeCard(queue[0], queue.length));
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
        '📋 To\'g\'ri javoblarni kiriting.\n\n' +
        'Faqat variantli savollar bo\'lsa:\n' +
        '`1-A 2-C 3-B 4-D` (variantlar A–E)\n\n' +
        'Ochiq javobli savollar ham bo\'lsa, har bir savolni alohida qatorda:\n' +
        '`1 | variant | A`\n' +
        '`2 | ochiq | 18/60 | Savol matni`\n' +
        'Ustunlar: savol | turi | javob | savol matni (ixtiyoriy)\n\n' +
        '📊 Excel orqali ham yuklash mumkin — namuna: /namuna',
        { parse_mode: 'Markdown' },
      );
    }
  }

  private async processSetAnswers(ctx: Context, raw: string) {
    const userId = ctx.from!.id;
    try {
      const questions = this.testSession.setAnswers(userId, raw);
      this.userSession.resetState(userId);
      await this.md(
        ctx,
        MessageBuilder.answersSet(
          Object.values(questions).sort((a, b) => a.number - b.number),
          false,
        ),
      );
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

    await this.md(ctx, MessageBuilder.sessionStatus(session, this.testSession.countPending(session)));
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

  // ─── O'qituvchi: /namuna ─────────────────────────────────────────────────────

  /** Excel kalit namunasini yuboradi */
  private async handleTemplate(ctx: Context) {
    if (!this.isTeacher(ctx.from!.id)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }

    try {
      const buffer = await this.excelService.generateKeyTemplate();
      await ctx.replyWithDocument(
        { source: buffer, filename: 'kalit_namuna.xlsx' },
        {
          caption:
            '📄 Kalit namunasi.\n\n' +
            'Ustunlar: savol | turi (variant / ochiq) | to\'g\'ri javob\n' +
            'To\'ldirib, shu chatga qaytaring — bot kalitni o\'zi o\'qiydi.',
        },
      );
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  // ─── O'qituvchi: /yakunla (1-qadam — topshirishni to'xtatish) ────────────────

  /**
   * Testni to'xtatadi va baholash faylini yuboradi.
   * Sessiya O'CHIRILMAYDI — natijalar /natijalarni_yubor bilan yuboriladi.
   */
  private async handleStopTest(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }
    await this.stopTest(ctx, userId);
  }

  /** /yakunla va panel tugmasi uchun umumiy amal */
  private async stopTest(ctx: Context, userId: number) {
    try {
      const session = this.testSession.getSessionByTeacher(userId);
      if (!session) {
        await ctx.reply('Faol test sessiyasi yo\'q. /yangitest buyrug\'i bilan yangi test yarating.');
        return;
      }

      if (Object.keys(session.questions).length === 0) {
        await ctx.reply(
          '⚠️ Kalit kiritilmagan — testni yakunlab bo\'lmaydi.\n' +
          'Avval /javoblar buyrug\'i bilan yoki Excel orqali kalitni kiriting.',
        );
        return;
      }

      // Holatni GRADING ga o'tkazish: talabalar javob topshira olmaydi
      this.testSession.startGrading(userId);

      if (session.students.size === 0) {
        await ctx.reply('⚠️ Hali hech kim javob topshirmagan.');
      }

      // Baholash faylini yuborish (ochiq javoblar bo'lmasa ham — natijalar ichida)
      const buffer = await this.excelService.generateGradingWorkbook(session);
      const safeName = this.safeFileName(session.testName);
      const pending = this.testSession.countPending(session);

      await ctx.replyWithDocument(
        { source: buffer, filename: `${safeName}_baholash.xlsx` },
        {
          caption:
            pending > 0
              ? `📊 "${session.testName}" — baholash fayli. ${pending} ta ochiq javob tekshirishingizni kutmoqda.`
              : `📊 "${session.testName}" — joriy natijalar.`,
        },
      );

      await this.md(ctx, MessageBuilder.gradingStarted(session, pending));

      // Talabalarga test to'xtaganini bildirish
      await this.notifyStudents(
        ctx,
        session,
        `⏹ *"${escapeMd(session.testName)}" testi yakunlandi\\.*\n\n` +
        `Javoblaringiz qabul qilindi\\. Natijalar o\'qituvchi tekshiruvidan so\'ng yuboriladi\\.`,
      );
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  // ─── O'qituvchi: /davom ──────────────────────────────────────────────────────

  /** Baholash bosqichidan qaytish — talabalar yana javob topshira oladi */
  private async handleResume(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }
    await this.resumeTest(ctx, userId);
  }

  /** /davom va panel tugmasi uchun umumiy amal */
  private async resumeTest(ctx: Context, userId: number) {
    try {
      const session = this.testSession.resumeSubmissions(userId);
      await this.md(ctx, MessageBuilder.resumed(session));

      await this.notifyStudents(
        ctx,
        session,
        `🟢 *"${escapeMd(session.testName)}" testi qayta ochildi\\.*\n\n` +
        `Javoblaringizni qayta yuborishingiz mumkin\\.`,
      );
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  // ─── O'qituvchi: /natijalarni_yubor (oxirgi qadam) ──────────────────────────

  /**
   * Natijalarni talabalarga yuboradi, yakuniy Excelni beradi va sessiyani yopadi.
   * "majburiy" argumenti bilan tekshirilmagan ochiq javoblar xato deb hisoblanadi.
   */
  private async handleSendResults(ctx: Context) {
    const userId = ctx.from!.id;
    if (!this.isTeacher(userId)) {
      await ctx.reply('⛔ Bu buyruq faqat o\'qituvchilar uchun.');
      return;
    }
    await this.sendResults(ctx, userId, /^majburiy$/i.test(this.getArgs(ctx)));
  }

  /** /natijalarni_yubor va panel tugmasi uchun umumiy amal */
  private async sendResults(ctx: Context, userId: number, force: boolean) {
    try {
      const session = this.testSession.getSessionByTeacher(userId);
      if (!session) {
        await ctx.reply('Faol test sessiyasi yo\'q. /yangitest buyrug\'i bilan yangi test yarating.');
        return;
      }

      if (session.status !== 'GRADING') {
        await ctx.reply(
          '⚠️ Test hali to\'xtatilmagan.\n' +
          'Avval /yakunla buyrug\'i bilan topshirishni to\'xtating.',
        );
        return;
      }

      // Tekshirilmagan ochiq javoblar bormi?
      const pending = this.testSession.countPending(session);
      if (pending > 0 && !force) {
        await this.md(ctx, MessageBuilder.pendingBlocksSend(pending));
        return;
      }
      if (pending > 0 && force) {
        const resolved = this.testSession.forceResolvePending(userId);
        await ctx.reply(`⚠️ ${resolved} ta tekshirilmagan javob xato deb belgilandi.`);
      }

      const students = [...session.students.values()];

      // Yakuniy Excel (ma'lumotlar o'chirilishidan oldin)
      let excelBuffer: Buffer | null = null;
      if (students.length > 0) {
        excelBuffer = await this.excelService.generateResultsBuffer(session);
      }

      // Sessiyani xotira va fayldan o'chirish
      this.testSession.finishSession(userId);

      if (excelBuffer) {
        const safeName = this.safeFileName(session.testName);
        await ctx.replyWithDocument(
          { source: excelBuffer, filename: `${safeName}_natijalari.xlsx` },
          { caption: `📊 "${session.testName}" test natijalari` },
        );
      }

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
          // Talabani sessiyadan chiqarish
          this.userSession.clearSession(student.userId);
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

  // ─── Excel fayl qabul qilish ─────────────────────────────────────────────────

  /**
   * O'qituvchi yuborgan .xlsx fayl ikki xil bo'lishi mumkin:
   * • sessiya ACTIVE  → kalit fayli (savol | turi | javob)
   * • sessiya GRADING → baholangan fayl (ochiq javoblar 1/0)
   */
  private async handleDocument(ctx: Context) {
    const userId = ctx.from!.id;
    const doc: any = (ctx.message as any)?.document;
    if (!doc) return;

    if (!this.isTeacher(userId)) {
      await ctx.reply('📎 Fayl qabul qilinmaydi. Javoblarni matn ko\'rinishida yuboring: /yuborish');
      return;
    }

    const fileName: string = doc.file_name ?? '';
    if (!/\.xlsx$/i.test(fileName)) {
      if (/\.xls$/i.test(fileName)) {
        await ctx.reply(
          '❌ Eski .xls formati qo\'llab-quvvatlanmaydi.\n' +
          'Excelda "Farqli saqlash → .xlsx" ni tanlab, qayta yuboring.',
        );
      } else {
        await ctx.reply('❌ Faqat .xlsx fayllar qabul qilinadi.');
      }
      return;
    }

    if (doc.file_size && doc.file_size > MAX_FILE_BYTES) {
      await ctx.reply(`❌ Fayl juda katta (maksimal ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
      return;
    }

    const session = this.testSession.getSessionByTeacher(userId);
    if (!session) {
      await ctx.reply(
        'Faol test sessiyasi yo\'q. Avval /yangitest buyrug\'i bilan test yarating, ' +
        'so\'ng kalit faylini yuboring.',
      );
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await this.downloadFile(ctx, doc.file_id);
    } catch (err) {
      this.logger.error(`Fayl yuklab olishda xato: ${(err as Error).message}`);
      await ctx.reply('❌ Faylni yuklab olishda xato yuz berdi. Qayta urinib ko\'ring.');
      return;
    }

    if (session.status === 'GRADING') {
      await this.processGradedFile(ctx, buffer);
    } else {
      await this.processKeyFile(ctx, buffer);
    }
  }

  /** Kalit faylini o'qib, sessiyaga yozadi */
  private async processKeyFile(ctx: Context, buffer: Buffer) {
    const userId = ctx.from!.id;
    try {
      const questions = await this.excelService.parseAnswerKey(buffer);
      this.testSession.setQuestions(userId, questions);
      this.userSession.resetState(userId);
      await this.md(ctx, MessageBuilder.answersSet(questions, true));
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  /** Baholangan faylni o'qib, ochiq javoblarga baho qo'yadi */
  private async processGradedFile(ctx: Context, buffer: Buffer) {
    const userId = ctx.from!.id;
    try {
      const grades = await this.excelService.parseGradedWorkbook(buffer);
      const applied = this.testSession.applyManualGrades(userId, grades);
      const session = this.testSession.getSessionByTeacher(userId)!;
      await this.md(
        ctx,
        MessageBuilder.gradesApplied(applied, this.testSession.countPending(session)),
      );
    } catch (e: any) {
      await ctx.reply(MessageBuilder.error(e.message));
    }
  }

  /** Telegramdan faylni yuklab oladi */
  private async downloadFile(ctx: Context, fileId: string): Promise<Buffer> {
    const link = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(link.toString());
    if (!response.ok) {
      throw new Error(`Telegram javobi: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // ─── Umumiy yordamchilar ─────────────────────────────────────────────────────

  /** Sessiyadagi barcha talabalarga xabar yuboradi (MarkdownV2) */
  private async notifyStudents(ctx: Context, session: Session, message: string) {
    for (const student of session.students.values()) {
      try {
        await ctx.telegram.sendMessage(student.userId, message, {
          parse_mode: 'MarkdownV2',
        });
      } catch (err) {
        this.logger.warn(
          `Talabaga xabar yuborib bo'lmadi (userId=${student.userId}): ${(err as Error).message}`,
        );
      }
    }
  }

  private safeFileName(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
    return safe.replace(/^_|_$/g, '') || 'test';
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
        'Foydalanish: `/yuborish 1-A 2-B 3-18/60 ...`\n' +
        'Barcha javoblarni bitta xabarda yuboring.\n' +
        'Javob ichida bo\'shliq bo\'lsa: `/yuborish 1-A | 2-18 / 60`',
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
      const session = this.testSession.getSessionById(sessionId)!;
      await this.md(ctx, MessageBuilder.submissionResult(result, session));
      await this.md(ctx, MessageBuilder.submissionEcho(result, session));
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
          // (ochiq javoblar ham: "1-18/60", "2. 20x")
          if (/^\s*\d+\s*[-–—.):]/.test(text)) {
            await this.processSubmit(ctx, us.joinedSessionId, text);
          } else {
            await ctx.reply(
              'Javoblarni yuborish uchun `/yuborish 1-A 2-18/60 ...` buyrug\'ini ishlating.\n' +
              'Javob ichida bo\'shliq bo\'lsa: `1-A | 2-18 / 60`',
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
