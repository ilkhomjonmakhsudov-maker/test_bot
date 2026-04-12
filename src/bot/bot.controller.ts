import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { BotService } from './bot.service';

/**
 * Handles incoming Telegram webhook POST requests.
 * Only active when BOT_MODE=webhook.
 */
@Controller('telegram-webhook')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(private readonly botService: BotService) {}

  @Post()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      await this.botService.getBot().handleUpdate(req.body, res);
    } catch (err) {
      this.logger.error('Webhook error', err);
      res.status(500).send('Internal Server Error');
    }
  }
}
