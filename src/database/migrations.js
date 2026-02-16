'use strict';

/**
 * Database migrations — creates all tables with versioning.
 */

const logger = require('../core/logger');

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version     INTEGER PRIMARY KEY,
          applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS contacts (
          jid                 TEXT PRIMARY KEY,
          phone_number        TEXT,
          display_name        TEXT,
          relationship_type   TEXT DEFAULT 'unknown',
          vip_tier            INTEGER DEFAULT 0,
          custom_tone         TEXT,
          preferred_language  TEXT DEFAULT 'en',
          auto_reply_enabled  INTEGER DEFAULT 1,
          notes               TEXT,
          message_count       INTEGER DEFAULT 0,
          first_seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
          last_mood           TEXT,
          is_bot              INTEGER DEFAULT 0,
          metadata            TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_vip ON contacts(vip_tier DESC);
        CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen_at);

        CREATE TABLE IF NOT EXISTS messages (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          jid             TEXT NOT NULL,
          direction       TEXT NOT NULL CHECK(direction IN ('inbound','outbound','owner_manual')),
          content         TEXT NOT NULL,
          content_type    TEXT DEFAULT 'text',
          intent          TEXT,
          mood            TEXT,
          is_ai_generated INTEGER DEFAULT 0,
          source_lib      TEXT,
          wa_message_id   TEXT,
          reply_to_id     INTEGER,
          token_count     INTEGER,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (jid) REFERENCES contacts(jid)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages(jid, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_intent ON messages(intent);
        CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

        CREATE TABLE IF NOT EXISTS conversation_summaries (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          jid             TEXT NOT NULL,
          summary_text    TEXT NOT NULL,
          message_range   TEXT NOT NULL,
          token_count     INTEGER,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (jid) REFERENCES contacts(jid)
        );
        CREATE INDEX IF NOT EXISTS idx_summaries_jid ON conversation_summaries(jid, created_at);

        CREATE TABLE IF NOT EXISTS follow_ups (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          jid                 TEXT NOT NULL,
          trigger_message_id  INTEGER,
          description         TEXT NOT NULL,
          status              TEXT DEFAULT 'pending' CHECK(status IN ('pending','reminded','resolved','expired')),
          priority            INTEGER DEFAULT 1,
          due_at              TEXT,
          reminded_count      INTEGER DEFAULT 0,
          resolved_at         TEXT,
          created_at          TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (jid) REFERENCES contacts(jid)
        );
        CREATE INDEX IF NOT EXISTS idx_followups_status ON follow_ups(status, due_at);
        CREATE INDEX IF NOT EXISTS idx_followups_jid ON follow_ups(jid);

        CREATE TABLE IF NOT EXISTS schedules (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          jid                 TEXT,
          title               TEXT NOT NULL,
          description         TEXT,
          event_at            TEXT NOT NULL,
          remind_at           TEXT,
          recurrence          TEXT,
          status              TEXT DEFAULT 'active' CHECK(status IN ('active','completed','cancelled','snoozed')),
          source_message_id   INTEGER,
          created_at          TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (jid) REFERENCES contacts(jid)
        );
        CREATE INDEX IF NOT EXISTS idx_schedules_event ON schedules(event_at);
        CREATE INDEX IF NOT EXISTS idx_schedules_remind ON schedules(remind_at);
        CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);

        CREATE TABLE IF NOT EXISTS knowledge_base (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          category        TEXT NOT NULL,
          topic           TEXT NOT NULL,
          question        TEXT,
          answer          TEXT NOT NULL,
          keywords        TEXT,
          priority        INTEGER DEFAULT 1,
          is_active       INTEGER DEFAULT 1,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_base(category);
        CREATE INDEX IF NOT EXISTS idx_kb_topic ON knowledge_base(topic);

        CREATE TABLE IF NOT EXISTS learning_data (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          jid                 TEXT,
          pattern_type        TEXT NOT NULL,
          context_intent      TEXT,
          incoming_sample     TEXT,
          owner_response      TEXT NOT NULL,
          extracted_pattern   TEXT,
          confidence          REAL DEFAULT 0.5,
          times_reinforced    INTEGER DEFAULT 1,
          created_at          TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_learning_jid ON learning_data(jid);
        CREATE INDEX IF NOT EXISTS idx_learning_type ON learning_data(pattern_type);

        CREATE TABLE IF NOT EXISTS owner_summaries (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          summary_text    TEXT NOT NULL,
          period_start    TEXT NOT NULL,
          period_end      TEXT NOT NULL,
          message_count   INTEGER,
          contacts_active INTEGER,
          priority_items  TEXT,
          delivered       INTEGER DEFAULT 0,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS rate_limit_log (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          jid             TEXT NOT NULL,
          action          TEXT NOT NULL CHECK(action IN ('blocked','warned')),
          window_count    INTEGER,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ratelimit_jid ON rate_limit_log(jid, created_at);
      `);
    },
  },
];

/**
 * Run all pending migrations.
 */
function runMigrations(db) {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version     INTEGER PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  const current = (currentVersion && currentVersion.v) || 0;

  const pending = MIGRATIONS.filter(m => m.version > current);
  if (pending.length === 0) {
    logger.info({ currentVersion: current }, 'Database schema is up to date');
    return;
  }

  for (const migration of pending) {
    logger.info({ version: migration.version, description: migration.description }, 'Running migration');
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
    });
    run();
    logger.info({ version: migration.version }, 'Migration complete');
  }
}

module.exports = { runMigrations };
