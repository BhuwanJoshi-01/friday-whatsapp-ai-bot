# Friday — AI Personal Operator for WhatsApp

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

An intelligent WhatsApp assistant powered by Groq AI that acts as your personal operator — managing conversations, tracking follow-ups, scheduling reminders, and learning from your communication style.

## Privacy Note

This bot does not store personal data beyond what's needed for functionality. Messages are processed in real-time and stored temporarily for context (auto-deleted after summarization). No user data is shared externally without explicit configuration.

## Features

- **Human-like Conversations** — Context-aware AI replies with memory of past interactions
- **Offline Auto-Assistant** — Replies on your behalf when you're away, pauses when you take over
- **Smart Summaries** — Periodic briefings of all conversations (text + voice note)
- **Follow-up Tracking** — Detects promises in replies and reminds you to follow through
- **Scheduling** — Natural language scheduling via WhatsApp messages
- **VIP Contact Tiers** — Different response styles (instant/priority/standard/minimal) per contact
- **Learning Engine** — Studies your reply style and mirrors it over time
- **Knowledge Base** — Store facts the bot can reference in conversations
- **Mood Detection** — Alerts you when contacts are upset, angry, or anxious
- **Loop/Bot Protection** — Detects conversation loops and automated senders
- **Admin Commands** — Full control via WhatsApp `!commands`
- **REST API** — HTTP endpoints for external integration (n8n, etc.)
- **Dual Transport** — Supports both `whatsapp-web.js` and `@whiskeysockets/baileys`

## Architecture

```
src/
├── config/         # Zod-validated configuration from .env
├── core/           # Event bus, logger (pino), graceful lifecycle
├── database/       # SQLite (better-sqlite3), migrations, 6 repositories
├── transport/      # WhatsApp adapters (webjs / baileys) + unified manager
├── ai/             # Gemini client, chat sessions, prompt builder, intent/mood detection
├── safety/         # Message filter, rate limiter, loop detector, bot detector
├── services/       # Business logic (routing, contacts, memory, offline, follow-ups, etc.)
├── api/            # Express REST API (health, messages, contacts, admin, gemini)
└── index.js        # Boot orchestrator
```

## Prerequisites

- **Node.js** >= 18
- **Groq API key** (get one at [console.groq.com](https://console.groq.com))
- **ffmpeg** (bundled via `ffmpeg-static`)

## Setup

1. **Clone and install:**
   ```bash
   git clone <repo-url>
   cd WhatsAppBot
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your settings. At minimum:
   ```
   GROQ_API_KEY=your-key-here
   OWNER_JID=your-number@c.us
   OWNER_NAME=YourName
   ```

3. **Start the bot:**
   ```bash
   npm start
   ```

4. **Scan QR code** in terminal to authenticate WhatsApp.

## Configuration

All settings are in `.env`. See `.env.example` for the full list. Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `WHATSAPP_LIB` | `baileys` | Transport: `webjs` or `baileys` |
| `GROQ_API_KEY` | — | Groq API key (required) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | AI model to use |
| `OWNER_JID` | — | Your WhatsApp JID (required) |
| `BOT_NAME` | `Friday` | Bot's display name |
| `AUTO_REPLY_ENABLED` | `true` | Global auto-reply toggle |
| `RATE_LIMIT_MAX` | `10` | Max messages per window per contact |
| `SUMMARY_INTERVAL_HOURS` | `6` | Periodic summary frequency |
| `SUMMARY_VOICE_ENABLED` | `false` | Send voice note summaries |
| `HTTP_PORT` | `3000` | REST API port |

## Admin Commands

Send these via WhatsApp (owner only):

| Command | Description |
|---------|-------------|
| `!help` | List all commands |
| `!status` | Bot status & stats |
| `!vip <jid> <tier>` | Set VIP tier (instant/priority/standard/minimal) |
| `!disable <jid>` | Disable auto-reply for a contact |
| `!enable <jid>` | Re-enable auto-reply |
| `!followups` | List pending follow-ups |
| `!schedules` | List upcoming schedules |
| `!kb add <topic> \| <content>` | Add to knowledge base |
| `!kb search <query>` | Search knowledge base |
| `!learning` | View learning stats |
| `!reset <jid>` | Reset chat session for contact |
| `!unhalt <jid>` | Un-halt a loop-halted contact |
| `!resume` | Force-resume auto-reply (override offline suppression) |
| `!contacts` | List active contacts and their tiers |
| `!summary` | Generate summary now |

## Usage Examples

### Basic Conversation
- User: "Hey, what's up?"
- Bot: "Not much! Just chilling. How about you? 😊"

### Scheduling
- User: "Remind me about the meeting tomorrow at 3pm"
- Bot: "Got it! I've scheduled 'meeting' for tomorrow at 3:00 PM. I'll remind Bhuwan 30 minutes before. 📅"

### Learning from Owner
- When you manually reply, the bot observes and learns your style.
- Over time, it adapts to respond more like you.

### Admin Control
- Send `!vip 1234567890@c.us 2` to set a contact as high priority.
- Send `!summary` to get an immediate briefing of all conversations.

## Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository** on GitHub.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/BhuwanJoshi-01/friday-whatsapp-ai-bot.git
   cd friday-whatsapp-ai-bot
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
5. **Make your changes** and test them.
6. **Commit and push**:
   ```bash
   git commit -m "Add your feature"
   git push origin feature/your-feature-name
   ```
7. **Open a Pull Request** on GitHub with a clear description of your changes.

### Guidelines
- Follow the existing code style (ES6+, async/await).
- Add tests for new features.
- Update documentation (this README) if needed.
- Respect the MIT license.

## Issues and Labels

- **Bug reports**: Use the "bug" label, include steps to reproduce.
- **Feature requests**: Use the "enhancement" label, describe the use case.
- **Questions**: Use the "question" label for general inquiries.


## Announcing

Share your project on:
- Reddit: r/opensource, r/programming, r/node
- Hacker News
- Dev communities like DEV.to or Indie Hackers
- Twitter/X with #OpenSource #WhatsAppBot

## REST API

Base URL: `http://localhost:3000`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + status |
| POST | `/api/messages/send` | Send a message `{ jid, text }` |
| GET | `/api/messages/recent?jid=` | Recent messages |
| GET | `/api/messages/search?q=` | Search messages |
| GET | `/api/contacts` | List contacts |
| GET | `/api/contacts/vip` | List VIP contacts |
| PUT | `/api/contacts/:jid` | Update contact |
| POST | `/api/admin/summary` | Trigger summary generation |
| POST | `/api/admin/memory/compress` | Trigger memory compression |
| GET | `/api/gemini/models` | List available Gemini models |
| POST | `/api/gemini/generate` | One-shot generation `{ prompt }` |


## License

MIT
