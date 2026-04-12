export interface Admin {
  telegramId: number;
  name: string;
}

export interface AdminsFile {
  admins: Admin[];
}
