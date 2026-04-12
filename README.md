# 📚 Telegram Test Bot

A production-ready Telegram bot built with **NestJS + TypeScript** that lets teachers manage multiple-choice tests and students submit answers to receive instant graded results.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Student flow** | Name → Answers → Instant result |
| **Admin panel** | Create/manage/close tests via Telegram commands |
| **Flexible storage** | JSON (default) · Excel (`.xlsx`) · Google Sheets |
| **Scoring rules** | Custom points per correct answer + optional negative marking |
| **Duplicate prevention** | Each student can submit once per test |
| **Deployment ready** | Docker · Railway · Render · VPS |

---

## 🏗️ Architecture

```
src/
├── main.ts                   # Entry point
├── app.module.ts             # Root module
├── config/
│   └── app.config.ts         # Typed configuration
├── bot/
│   ├── bot.module.ts
│   ├── bot.service.ts        # Telegraf bot + all command handlers
│   ├── bot.controller.ts     # Webhook endpoint
│   ├── session.service.ts    # In-memory user state machine
│   └── message-builder.ts   # All Telegram message templates
├── test/
│   ├── test.module.ts
│   ├── test.service.ts       # Test lifecycle + grading engine
│   ├── dto/                  # Validated DTOs
│   └── interfaces/           # TypeScript interfaces
├── results/
│   ├── results.module.ts     # Dynamic repository injection
│   ├── results.service.ts    # Business logic
│   ├── interfaces/           # Repository contract
│   └── repositories/
│       ├── json-results.repository.ts
│       ├── excel-results.repository.ts
│       └── google-sheets-results.repository.ts
└── common/
    ├── guards/admin.guard.ts
    ├── filters/all-exceptions.filter.ts
    └── decorators/admin.decorator.ts
```

---

## 🚀 Quick Start

### 1. Prerequisites

- Node.js 18+
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- Your Telegram user ID (get it from [@userinfobot](https://t.me/userinfobot))

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_token_here
ADMIN_IDS=123456789          # your Telegram ID
BOT_MODE=polling             # or webhook
STORAGE_BACKEND=json         # json | excel | google_sheets
```

### 4. Run in development

```bash
npm run start:dev
```

### 5. Build & run in production

```bash
npm run build
npm run start:prod
```

---

## 👩‍🏫 Admin Flow (Teacher)

### Step 1 — Create a test
```
/newtest Biology Midterm Exam
```
Or just `/newtest` and the bot will ask for the title.

### Step 2 — Set correct answers
```
/setanswers 1-A 2-C 3-B 4-D 5-E 6-A 7-B 8-C 9-D 10-A
```
Supports answers A–E for any number of questions.

### Step 3 — Configure scoring (optional)
```
/setball 1 0.25
```
Format: `[points per correct] [penalty per wrong]`
- `1` — 1 point per correct, no penalty
- `1 0.25` — 1 point correct, minus 0.25 per wrong
- `2 1` — 2 points correct, minus 1 per wrong

Default: 1 point per correct, 0 penalty.

### Step 4 — Open the test
```
/opentest
```

### Step 5 — Close when done
```
/endtest
```

### Step 6 — View results
```
/results
```

---

## 👨‍🎓 Student Flow

1. Send `/start`
2. Bot asks for your **Full Name** (First + Last)
3. Enter your name: `John Smith`
4. Submit answers: `1-A 2-C 3-B 4-D 5-E`
5. Instantly receive your score:

```
📊 Test Results: Biology Midterm Exam
👤 John Smith

✅ Correct: 8 / 10
❌ Wrong: 1
⬜ Missing: 1

🎯 Score: 8 / 10 (80%)
✨ Good job!

📝 Incorrect answers:
Q3: you answered B, correct is C
```

---

## 🗄️ Storage Backends

### JSON (default)

No setup needed. Results stored in `./data/results.json`.

```env
STORAGE_BACKEND=json
STORAGE_FILE_PATH=./data/results
```

### Excel

Results stored in `./data/results.xlsx`.

```env
STORAGE_BACKEND=excel
STORAGE_FILE_PATH=./data/results
```

### Google Sheets

1. Create a Google Cloud project
2. Enable **Google Sheets API**
3. Create a **Service Account** and download the JSON key
4. Share your spreadsheet with the service account email
5. Configure:

```env
STORAGE_BACKEND=google_sheets
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./google-credentials.json
```

---

## 🐳 Docker

```bash
# Build
docker build -t telegram-test-bot .

# Run
docker run -d \
  --name telegram-test-bot \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e ADMIN_IDS=123456789 \
  -e BOT_MODE=polling \
  -e STORAGE_BACKEND=json \
  -v $(pwd)/data:/app/data \
  telegram-test-bot
```

---

## ☁️ Deploy to Railway

1. Push code to GitHub
2. Create new project on [railway.app](https://railway.app)
3. Connect your repository
4. Add environment variables in Railway dashboard
5. Railway auto-detects `railway.json` and deploys via Docker

---

## ☁️ Deploy to Render

1. Push code to GitHub
2. Create new "Web Service" on [render.com](https://render.com)
3. Select "Docker" as runtime
4. Add environment variables from `.env.example`
5. Deploy

---

## ☁️ Deploy to VPS (Ubuntu)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repo
git clone https://github.com/your-repo/telegram-test-bot.git
cd telegram-test-bot

# Setup
cp .env.example .env
nano .env  # fill in your values
npm install
npm run build

# Run with PM2
npm install -g pm2
pm2 start dist/main.js --name telegram-test-bot
pm2 startup
pm2 save
```

---

## 🔗 Webhook Setup

For webhook mode (recommended for production):

```env
BOT_MODE=webhook
WEBHOOK_URL=https://your-domain.com
WEBHOOK_PORT=3000
```

The bot will automatically register the webhook at `https://your-domain.com/telegram-webhook`.

> ⚠️ Webhook requires a valid HTTPS URL. Use a reverse proxy (nginx/caddy) on VPS.

---

## ⚙️ All Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Bot token from @BotFather |
| `ADMIN_IDS` | ✅ | — | Comma-separated admin Telegram IDs |
| `BOT_MODE` | — | `polling` | `polling` or `webhook` |
| `WEBHOOK_URL` | webhook only | — | Your public HTTPS URL |
| `WEBHOOK_PORT` | — | `3000` | HTTP port |
| `STORAGE_BACKEND` | — | `json` | `json`, `excel`, or `google_sheets` |
| `STORAGE_FILE_PATH` | — | `./data/results` | Base path for JSON/Excel file |
| `GOOGLE_SPREADSHEET_ID` | Sheets only | — | Google Spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Sheets only | `./google-credentials.json` | Path to credentials JSON |
| `PORT` | — | `3000` | HTTP server port |
| `NODE_ENV` | — | `development` | `development` or `production` |

---

## 📋 Admin Commands Reference

| Command | Description |
|---|---|
| `/newtest [title]` | Create a new test (optionally with title inline) |
| `/setanswers [1-A 2-B...]` | Set correct answers |
| `/setball [pts] [penalty]` | Set scoring rules |
| `/opentest` | Open the test for student submissions |
| `/endtest` | Close the test |
| `/results` | View all submitted results (sorted by score) |
| `/status` | Show current test status |
| `/cancel` | Cancel current operation |
| `/help` | Show command list |

---

## 🛡️ Security Notes

- Admin access is restricted by Telegram user ID (configured in `ADMIN_IDS`)
- Never commit your `.env` or `google-credentials.json` to version control
- Use webhook + HTTPS in production for better security
- The bot validates all student input strictly before processing

---

## 📄 License

MIT
