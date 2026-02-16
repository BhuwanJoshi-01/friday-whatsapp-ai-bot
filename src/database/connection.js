'use strict';

/**
 * SQLite connection singleton via better-sqlite3.
 * Opens the database, enables WAL mode, returns the instance.
 */

const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../core/logger');

let db = null;

function getDb() {
  if (db) return db;

  const dbPath = path.resolve(config.database.path);
  const dir = path.dirname(dbPath);

  // Ensure the data directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info({ dir }, 'Created database directory');
  }

  const Database = require('better-sqlite3');
  db = new Database(dbPath);

  // WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  logger.info({ path: dbPath }, 'SQLite database connected');
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}

module.exports = { getDb, closeDb };
