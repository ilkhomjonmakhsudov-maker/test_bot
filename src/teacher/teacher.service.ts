import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Admin, AdminsFile } from './interfaces/admin.interface';

@Injectable()
export class TeacherService implements OnModuleInit {
  private readonly logger = new Logger(TeacherService.name);
  private readonly filePath: string;

  private adminIds = new Set<number>();
  private adminMap = new Map<number, Admin>();

  constructor(private readonly config: ConfigService) {
    this.filePath = path.resolve(
      this.config.get<string>('app.adminsFilePath', './admins.json'),
    );
  }

  onModuleInit() {
    this.load();
  }

  // ─── Read API ─────────────────────────────────────────────────────────────────

  isTeacher(telegramId: number): boolean {
    return this.adminIds.has(telegramId);
  }

  getTeacher(telegramId: number): Admin | undefined {
    return this.adminMap.get(telegramId);
  }

  getAllTeachers(): Admin[] {
    return [...this.adminMap.values()];
  }

  // ─── Write API (called by super admin commands) ───────────────────────────────

  /**
   * Adds a teacher in-memory and persists to admins.json immediately.
   * Returns false if the teacher was already registered.
   */
  addTeacher(telegramId: number, name: string): boolean {
    if (this.adminIds.has(telegramId)) return false;

    const admin: Admin = { telegramId, name };
    this.adminIds.add(telegramId);
    this.adminMap.set(telegramId, admin);
    this.persist();

    this.logger.log(`Teacher added: ${name} (${telegramId})`);
    return true;
  }

  /**
   * Removes a teacher in-memory and persists to admins.json immediately.
   * Returns false if the teacher was not found.
   */
  removeTeacher(telegramId: number): boolean {
    if (!this.adminIds.has(telegramId)) return false;

    const name = this.adminMap.get(telegramId)?.name ?? String(telegramId);
    this.adminIds.delete(telegramId);
    this.adminMap.delete(telegramId);
    this.persist();

    this.logger.log(`Teacher removed: ${name} (${telegramId})`);
    return true;
  }

  // ─── File I/O ─────────────────────────────────────────────────────────────────

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      this.logger.warn(
        `admins.json not found at "${this.filePath}". Starting with no teachers. ` +
        'Use /addteacher to add teachers via Telegram.',
      );
      this.ensureFileExists();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data: AdminsFile = JSON.parse(raw);

      this.adminIds.clear();
      this.adminMap.clear();

      for (const admin of data.admins ?? []) {
        this.adminIds.add(admin.telegramId);
        this.adminMap.set(admin.telegramId, admin);
      }

      this.logger.log(`Loaded ${this.adminIds.size} teacher(s) from ${this.filePath}`);
    } catch (err) {
      this.logger.error(`Failed to parse admins.json: ${(err as Error).message}`);
    }
  }

  /** Writes current in-memory state back to admins.json */
  private persist(): void {
    try {
      this.ensureFileExists();
      const data: AdminsFile = { admins: [...this.adminMap.values()] };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to write admins.json: ${(err as Error).message}`);
    }
  }

  private ensureFileExists(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ admins: [] }, null, 2), 'utf-8');
    }
  }
}
