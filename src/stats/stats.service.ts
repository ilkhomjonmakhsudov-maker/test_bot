import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Session } from '../session/interfaces/session.interface';

/**
 * Yakunlangan testlar bo'yicha hisob.
 *
 * Sessiya /natijalarni_yubor dan keyin butunlay o'chiriladi — shu sababli
 * umumiy statistika alohida faylda yig'iladi, aks holda hech qanday iz
 * qolmaydi.
 */
export interface TeacherStats {
  teacherId: number;
  name: string;
  sessions: number;
  students: number;
  lastAt?: string;
}

export interface StatsSnapshot {
  totalSessions: number;
  totalStudents: number;
  totalQuestions: number;
  createdSessions: number;
  since: string;
  lastSessionAt?: string;
  teachers: TeacherStats[];
}

interface StatsFile {
  since: string;
  createdSessions: number;
  totalSessions: number;
  totalStudents: number;
  totalQuestions: number;
  lastSessionAt?: string;
  byTeacher: Record<string, Omit<TeacherStats, 'teacherId'>>;
}

@Injectable()
export class StatsService implements OnModuleInit {
  private readonly logger = new Logger(StatsService.name);
  private readonly filePath: string;

  private data: StatsFile = {
    since: new Date().toISOString(),
    createdSessions: 0,
    totalSessions: 0,
    totalStudents: 0,
    totalQuestions: 0,
    byTeacher: {},
  };

  constructor(private readonly config: ConfigService) {
    this.filePath = path.resolve(
      this.config.get<string>('app.statsFilePath', './data/stats.json'),
    );
  }

  onModuleInit() {
    this.load();
  }

  // ─── Yozish ─────────────────────────────────────────────────────────────────

  /** Yangi sessiya yaratilganda */
  recordCreated(): void {
    this.data.createdSessions++;
    this.persist();
  }

  /** Sessiya yakunlanganda (o'chirilishidan oldin chaqiriladi) */
  recordCompleted(session: Session, teacherName = ''): void {
    const students = session.students.size;
    const questions = Object.keys(session.questions).length;

    this.data.totalSessions++;
    this.data.totalStudents += students;
    this.data.totalQuestions += questions;
    this.data.lastSessionAt = new Date().toISOString();

    const key = String(session.teacherId);
    const current = this.data.byTeacher[key] ?? { name: teacherName, sessions: 0, students: 0 };
    current.name = teacherName || current.name;
    current.sessions++;
    current.students += students;
    current.lastAt = this.data.lastSessionAt;
    this.data.byTeacher[key] = current;

    this.persist();
    this.logger.log(
      `Statistika: ${session.sessionId} — ${students} ta talaba, ${questions} ta savol.`,
    );
  }

  // ─── O'qish ─────────────────────────────────────────────────────────────────

  snapshot(): StatsSnapshot {
    const teachers: TeacherStats[] = Object.entries(this.data.byTeacher)
      .map(([id, t]) => ({ teacherId: Number(id), ...t }))
      .sort((a, b) => b.sessions - a.sessions);

    return {
      totalSessions: this.data.totalSessions,
      totalStudents: this.data.totalStudents,
      totalQuestions: this.data.totalQuestions,
      createdSessions: this.data.createdSessions,
      since: this.data.since,
      lastSessionAt: this.data.lastSessionAt,
      teachers,
    };
  }

  // ─── Saqlash ────────────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<StatsFile>;
      this.data = {
        since: parsed.since ?? this.data.since,
        createdSessions: parsed.createdSessions ?? 0,
        totalSessions: parsed.totalSessions ?? 0,
        totalStudents: parsed.totalStudents ?? 0,
        totalQuestions: parsed.totalQuestions ?? 0,
        lastSessionAt: parsed.lastSessionAt,
        byTeacher: parsed.byTeacher ?? {},
      };
      this.logger.log(`Statistika o'qildi: ${this.data.totalSessions} ta yakunlangan test.`);
    } catch (e: any) {
      this.logger.error(`Statistika faylini o'qib bo'lmadi: ${e.message}`);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e: any) {
      this.logger.error(`Statistikani saqlab bo'lmadi: ${e.message}`);
    }
  }
}
