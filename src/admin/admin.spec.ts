import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestSessionService } from '../session/session.service';
import { TeacherService } from '../teacher/teacher.service';
import { StatsService } from '../stats/stats.service';
import { AdminService } from './admin.service';
import { verifyInitData, InitDataError } from '../bot/webapp-auth';
import { QuestionKey } from '../session/interfaces/session.interface';

const SUPER = 1;
const TEACHER = 100;
const OTHER_TEACHER = 200;

let dir: string;
let sessions: TestSessionService;
let teachers: TeacherService;
let stats: StatsService;
let admin: AdminService;

const configFor = (base: string): any => ({
  get: (key: string, def?: any) =>
    key === 'app.sessionDataPath' ? path.join(base, 'sessions')
    : key === 'app.adminsFilePath' ? path.join(base, 'admins.json')
    : key === 'app.statsFilePath' ? path.join(base, 'stats.json')
    : key === 'app.sessionTtlMinutes' ? 0
    : key === 'app.superAdminIds' ? [SUPER]
    : def,
});

const MIXED: QuestionKey[] = [
  { number: 1, type: 'variant', answer: 'A' },
  { number: 2, type: 'open', answer: '18/60' },
  { number: 3, type: 'open', answer: '20x' },
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testbot-admin-'));
  const config = configFor(dir);

  stats = new StatsService(config);
  stats.onModuleInit();

  sessions = new TestSessionService(config, stats);
  sessions.onModuleInit();

  teachers = new TeacherService(config);
  teachers.onModuleInit();
  teachers.addTeacher(TEACHER, 'A. Karimov');
  teachers.addTeacher(OTHER_TEACHER, 'B. Salimov');

  admin = new AdminService(config, sessions, teachers, stats);
});

afterEach(() => {
  sessions.onModuleDestroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Kalit + ikkita talaba javobi bilan sessiya */
const seed = () => {
  const sid = sessions.createSession(TEACHER, 'Kimyo').sessionId;
  sessions.setQuestions(TEACHER, MIXED);
  sessions.submitAnswers(sid, 11, 'Ali Valiyev', 'ali', '1-A 2-18/60 3-notogri');
  sessions.submitAnswers(sid, 12, 'Vali Aliyev', 'vali', '1-B 2-xato 3-20x');
  return sid;
};

// ─────────────────────────────────────────────────────────────────────────────

describe('Ruxsatlar', () => {
  it('rollarni ajratadi', () => {
    expect(admin.roleOf(SUPER)).toBe('super');
    expect(admin.roleOf(TEACHER)).toBe('teacher');
    expect(admin.roleOf(999)).toBe('none');
  });

  it('super admin o\'qituvchi amallarini ham bajara oladi', () => {
    expect(admin.isTeacher(SUPER)).toBe(true);
    expect(admin.isSuperAdmin(TEACHER)).toBe(false);
  });

  it('begonani rad etadi', () => {
    expect(() => admin.assertTeacher(999)).toThrow();
    expect(() => admin.assertSuperAdmin(TEACHER)).toThrow(/super admin/i);
  });
});

describe('Panel ma\'lumotlari', () => {
  it('sessiyasiz o\'qituvchiga bo\'sh panel beradi', () => {
    const dash = admin.dashboard(TEACHER);
    expect(dash.session).toBeNull();
    expect(dash.role).toBe('teacher');
  });

  it('sessiya xulosasini beradi', () => {
    seed();
    const dash = admin.dashboard(TEACHER);
    expect(dash.session).toMatchObject({
      testName: 'Kimyo',
      status: 'ACTIVE',
      students: 2,
      questions: 3,
      openQuestions: 2,
    });
    // Har bir talabada 2 ta ochiq javob tekshirilmagan
    expect(dash.session!.pending).toBe(4);
  });

  it('natijalarni ball bo\'yicha tartiblaydi', () => {
    seed();
    const rows = admin.standings(TEACHER);
    expect(rows).toHaveLength(2);
    expect(rows[0].score).toBeGreaterThanOrEqual(rows[1].score);
  });

  it('tekshirilmagan javoblar navbatini yig\'adi', () => {
    seed();
    const queue = admin.pendingQueue(TEACHER);
    expect(queue).toHaveLength(4);

    const exact = queue.find((q) => q.studentId === 11 && q.question === 2);
    expect(exact).toMatchObject({ given: '18/60', expected: '18/60', guess: true });

    const wrong = queue.find((q) => q.studentId === 12 && q.question === 2);
    expect(wrong).toMatchObject({ given: 'xato', guess: false });
  });
});

describe('Ochiq javoblarni baholash', () => {
  it('bitta javobga baho qo\'yadi va qolganini sanaydi', () => {
    seed();
    const remaining = admin.gradeOne(TEACHER, 11, 2, true);
    expect(remaining).toBe(3);
    expect(admin.pendingQueue(TEACHER)).toHaveLength(3);
  });

  it('qolganlarini bir vaqtda belgilaydi', () => {
    seed();
    expect(admin.gradeAllRemaining(TEACHER, false)).toBe(4);
    expect(admin.pendingQueue(TEACHER)).toHaveLength(0);
    expect(admin.dashboard(TEACHER).session!.pending).toBe(0);
  });

  it('bot taxminini qabul qiladi — mos kelganlar to\'g\'ri bo\'ladi', () => {
    seed();
    expect(admin.acceptGuesses(TEACHER)).toBe(4);
    expect(admin.pendingQueue(TEACHER)).toHaveLength(0);

    const rows = admin.standings(TEACHER);
    const ali = rows.find((r) => r.userId === 11)!;
    // 1-A to'g'ri, 2-18/60 mos keladi, 3-notogri mos kelmaydi
    expect(ali.correctCount).toBe(2);
    expect(ali.wrongCount).toBe(1);
  });

  it('baho qo\'yilgach ball qayta hisoblanadi', () => {
    seed();
    admin.gradeAllRemaining(TEACHER, true);
    const ali = admin.standings(TEACHER).find((r) => r.userId === 11)!;
    expect(ali.score).toBe(3);
    expect(ali.pendingCount).toBe(0);
  });
});

describe('Kalitni tahrirlash', () => {
  it('savol turini almashtiradi', () => {
    seed();
    // 1-savol variantli, javobi "A" — ochiqqa o'tishi mumkin
    expect(admin.toggleQuestionType(TEACHER, 1).type).toBe('open');
    expect(admin.keyListing(TEACHER)[0].type).toBe('open');

    // Va qaytib variantli bo'ladi
    expect(admin.toggleQuestionType(TEACHER, 1).type).toBe('variant');
  });

  it('javobi harf bo\'lmagan savolni variantli qila olmaydi', () => {
    seed();
    // 3-savolning javobi "20x" — variantli bo'la olmaydi
    expect(() => admin.toggleQuestionType(TEACHER, 3)).toThrow(/A–E/);
  });

  it('to\'g\'ri javobni almashtiradi va qayta baholaydi', () => {
    seed();
    admin.setQuestionAnswer(TEACHER, 1, 'B');
    expect(admin.keyListing(TEACHER)[0].answer).toBe('B');

    // Endi 1-savolga "B" javob bergan talaba to'g'ri bo'ladi
    const vali = admin.standings(TEACHER).find((r) => r.userId === 12)!;
    expect(vali.correctCount).toBe(1);
  });

  it('variantli savolga harf bo\'lmagan javobni rad etadi', () => {
    seed();
    expect(() => admin.setQuestionAnswer(TEACHER, 1, '18/60')).toThrow(/A–E/);
  });

  it('mavjud bo\'lmagan savolni rad etadi', () => {
    seed();
    expect(() => admin.toggleQuestionType(TEACHER, 9)).toThrow(/topilmadi/);
  });
});

describe('Super admin amallari', () => {
  it('barcha faol sessiyalarni ko\'radi', () => {
    seed();
    sessions.createSession(OTHER_TEACHER, 'Fizika');

    const all = admin.allSessions();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.teacherName)).toContain('B. Salimov');
  });

  it('boshqa o\'qituvchining sessiyasini to\'xtatadi va ochadi', () => {
    const sid = seed();

    admin.forceStop(sid);
    expect(sessions.getSessionById(sid)!.status).toBe('GRADING');

    admin.forceResume(sid);
    expect(sessions.getSessionById(sid)!.status).toBe('ACTIVE');
  });

  it('mavjud bo\'lmagan sessiyani rad etadi', () => {
    expect(() => admin.forceStop('YOQ123')).toThrow(/topilmadi/);
  });

  it('allaqachon to\'xtatilgan sessiyani ikki marta to\'xtatmaydi', () => {
    const sid = seed();
    admin.forceStop(sid);
    expect(() => admin.forceStop(sid)).toThrow(/baholash bosqichida/);
  });

  it('o\'qituvchilar ro\'yxatida sessiya holatini ko\'rsatadi', () => {
    seed();
    const list = admin.teacherList();
    expect(list.find((t) => t.telegramId === TEACHER)!.hasSession).toBe(true);
    expect(list.find((t) => t.telegramId === OTHER_TEACHER)!.hasSession).toBe(false);
  });
});

describe('Statistika', () => {
  it('yakunlangan testlarni sanaydi', () => {
    const sid = seed();
    expect(admin.statistics().totalSessions).toBe(0);

    admin.gradeAllRemaining(TEACHER, true);
    sessions.finishSession(TEACHER);

    const snapshot = admin.statistics();
    expect(snapshot.totalSessions).toBe(1);
    expect(snapshot.totalStudents).toBe(2);
    expect(snapshot.createdSessions).toBe(1);
    expect(sessions.getSessionById(sid)).toBeNull();
  });

  it('o\'qituvchi nomini joriy ro\'yxatdan to\'ldiradi', () => {
    seed();
    sessions.finishSession(TEACHER);
    const snapshot = admin.statistics();
    expect(snapshot.teachers[0]).toMatchObject({
      teacherId: TEACHER,
      name: 'A. Karimov',
      sessions: 1,
    });
  });

  it('qayta ishga tushgach hisob saqlanadi', () => {
    seed();
    sessions.finishSession(TEACHER);

    const reloaded = new StatsService(configFor(dir));
    reloaded.onModuleInit();
    expect(reloaded.snapshot().totalSessions).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Mini App imzosi (initData)', () => {
  const TOKEN = '123456:TEST-TOKEN';

  /** Telegram yuboradigan initData ni yasaydi */
  const sign = (user: object, authDate = Math.floor(Date.now() / 1000)) => {
    const params = new URLSearchParams({
      auth_date: String(authDate),
      query_id: 'AAEt',
      user: JSON.stringify(user),
    });
    const checkString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
    params.set('hash', hash);
    return params.toString();
  };

  it('to\'g\'ri imzolangan ma\'lumotni qabul qiladi', () => {
    const user = verifyInitData(sign({ id: 42, first_name: 'Ali' }), TOKEN);
    expect(user.id).toBe(42);
    expect(user.first_name).toBe('Ali');
  });

  it('o\'zgartirilgan ma\'lumotni rad etadi', () => {
    // Foydalanuvchi ID sini almashtirib ko'ramiz — imzo mos kelmasligi kerak
    const tampered = sign({ id: 42 }).replace('%3A42%7D', '%3A999%7D');
    expect(tampered).toContain('999');
    expect(() => verifyInitData(tampered, TOKEN)).toThrow(InitDataError);
  });

  it('boshqa token bilan imzolanganini rad etadi', () => {
    expect(() => verifyInitData(sign({ id: 42 }), 'boshqa:TOKEN')).toThrow(InitDataError);
  });

  it('imzosiz ma\'lumotni rad etadi', () => {
    expect(() => verifyInitData('user=%7B%22id%22%3A42%7D', TOKEN)).toThrow(/imzosi yo'q/);
  });

  it('eskirgan imzoni rad etadi', () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60 * 48;
    expect(() => verifyInitData(sign({ id: 42 }, old), TOKEN)).toThrow(/eskirgan/);
  });

  it('muddat tekshiruvi o\'chirilganda eski imzoni qabul qiladi', () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60 * 48;
    expect(verifyInitData(sign({ id: 42 }, old), TOKEN, 0).id).toBe(42);
  });

  it('bo\'sh initData va tokensiz holatni rad etadi', () => {
    expect(() => verifyInitData('', TOKEN)).toThrow(InitDataError);
    expect(() => verifyInitData(sign({ id: 42 }), '')).toThrow(/token/i);
  });
});
