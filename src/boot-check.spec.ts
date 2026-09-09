import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { BotService } from './bot/bot.service';
import { AdminController } from './bot/admin.controller';
import { AdminService } from './admin/admin.service';
import { PanelService } from './bot/panel.service';

/**
 * DI grafi tekshiruvi: modullar bir-biriga bog'lanadimi va controller
 * o'ziga kerakli xizmatlarni topa oladimi.
 *
 * `compile()` ishlatiladi, `init()` emas — shu sababli onModuleInit
 * chaqirilmaydi va bot Telegramga ulanmaydi.
 */
describe('Ilova moduli', () => {
  it('barcha bog\'lanishlar hal bo\'ladi', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456:TEST';
    process.env.SUPER_ADMIN_IDS = '1';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(BotService)).toBeDefined();
    expect(moduleRef.get(AdminService)).toBeDefined();
    expect(moduleRef.get(PanelService)).toBeDefined();
    expect(moduleRef.get(AdminController)).toBeDefined();

    await moduleRef.close();
  });
});
