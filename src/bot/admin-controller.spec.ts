import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HttpException } from '@nestjs/common';
import { TestSessionService } from '../session/session.service';
import { TeacherService } from '../teacher/teacher.service';
import { StatsService } from '../stats/stats.service';
import { AdminService } from '../admin/admin.service';
import { AdminController } from './admin.controller';

const TOKEN = '123456:TEST-TOKEN';
const TEACHER = 100;
const STRANGER = 777;

let dir: string;
let controller: AdminController;
let sessions: TestSessionService;

const config = (base: string): any => ({
  get: (key: string, def?: any) =>
    key === 'app.sessionDataPath' ? path.join(base, 'sessions')
    : key === 'app.adminsFilePath' ? path.join(base, 'admins.json')
    : key === 'app.statsFilePath' ? path.join(base, 'stats.json')
    : key === 'app.telegram.token' ? TOKEN
    : key === 'app.sessionTtlMinutes' ? 0
    : key === 'app.superAdminIds' ? []
    : def,
});

/** Telegram yuboradigan initData */
const sign = (userId: number) => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testbot-ctrl-'));
  const cfg = config(dir);

  const stats = new StatsService(cfg);
  stats.onModuleInit();
  sessions = new TestSessionService(cfg, stats);
  sessions.onModuleInit();

  const teachers = new TeacherService(cfg);
  teachers.onModuleInit();
  teachers.addTeacher(TEACHER, 'A. Karimov');

  const admin = new AdminService(cfg, sessions, teachers, stats);
  const botStub: any = { announceToSession: jest.fn(), notifyUser: jest.fn() };

  controller = new AdminController(cfg, admin, sessions, botStub);
});

afterEach(() => {
  sessions.onModuleDestroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Mini App sahifasi', () => {
  it('panel.html ni yuboradi', () => {
    const sent: string[] = [];
    controller.page({ send: (html: string) => sent.push(html) } as any);

    expect(sent[0]).toContain('Boshqaruv paneli');
    expect(sent[0]).toContain('telegram-web-app.js');
    expect(sent[0]).toContain('/panel/api/');
  });
});

describe('Mini App API ruxsati', () => {
  it('imzosiz so\'rovni rad etadi', () => {
    expect(() => controller.state({ initData: '' })).toThrow(HttpException);
  });

  it('soxta imzoni rad etadi', () => {
    const fake = sign(TEACHER).replace(/hash=[0-9a-f]+/, 'hash=' + 'a'.repeat(64));
    expect(() => controller.state({ initData: fake })).toThrow(HttpException);
  });

  it('o\'qituvchi bo\'lmaganni rad etadi', () => {
    // Imzo to'g'ri, lekin bu odam o'qituvchi emas
    expect(() => controller.state({ initData: sign(STRANGER) })).toThrow(/o'qituvchilar/);
  });

  it('o\'qituvchiga holatni beradi', () => {
    const sid = sessions.createSession(TEACHER, 'Kimyo').sessionId;
    sessions.setQuestions(TEACHER, [
      { number: 1, type: 'variant', answer: 'A' },
      { number: 2, type: 'open', answer: '18/60' },
    ]);
    sessions.submitAnswers(sid, 11, 'Ali Valiyev', 'ali', '1-A 2-18/60');

    const state = controller.state({ initData: sign(TEACHER) });

    expect(state.role).toBe('teacher');
    expect(state.dashboard.session).toMatchObject({ sessionId: sid, students: 1 });
    expect(state.standings).toHaveLength(1);
    expect(state.key).toHaveLength(2);
    expect(state.pending).toHaveLength(1);
    expect(state.superAdmin).toBeNull();
  });
});

describe('Mini App amallari', () => {
  const seed = () => {
    const sid = sessions.createSession(TEACHER, 'Kimyo').sessionId;
    sessions.setQuestions(TEACHER, [
      { number: 1, type: 'variant', answer: 'A' },
      { number: 2, type: 'open', answer: '18/60' },
    ]);
    sessions.submitAnswers(sid, 11, 'Ali Valiyev', 'ali', '1-A 2-18/60');
    return sid;
  };

  it('ochiq javobga baho qo\'yadi va yangi holatni qaytaradi', async () => {
    seed();
    const state = await controller.action({
      initData: sign(TEACHER),
      action: 'grade',
      studentId: 11,
      question: 2,
      correct: true,
    });

    expect(state.pending).toHaveLength(0);
    expect(state.standings[0].score).toBe(2);
  });

  it('super admin amalini oddiy o\'qituvchiga bermaydi', async () => {
    seed();
    await expect(
      controller.action({
        initData: sign(TEACHER),
        action: 'forceStop',
        sessionId: 'YOQ123',
      }),
    ).rejects.toThrow(/super admin/i);
  });

  it('noma\'lum amalni rad etadi', async () => {
    seed();
    await expect(
      controller.action({ initData: sign(TEACHER), action: 'yolgon' }),
    ).rejects.toThrow(/Noma'lum amal/);
  });
});
