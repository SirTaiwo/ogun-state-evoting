/**
 * db.js — Database layer for the Nigeria E-Voting System
 * Uses better-sqlite3 (file-based SQL database, no server required).
 *
 * Security / integrity notes:
 *  - Passwords are never stored in plaintext (bcrypt hashes only).
 *  - Ballot secrecy: a vote row stores a salted hash of the voter's identity
 *    (voter_hash) instead of the voter id, so the choice cannot be trivially
 *    traced back to a person, while still enforcing one-vote-per-election.
 *  - Tamper evidence: every vote is linked into a SHA-256 hash chain
 *    (prev_hash -> vote_hash) like a lightweight blockchain. Any edit to a
 *    historical vote breaks the chain and is detected by /api/admin/integrity.
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'evoting.db');
const db = new Database(DB_PATH);

// Recommended pragmas for reliability + speed.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name     TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS voters (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vin           TEXT UNIQUE NOT NULL,          -- Voter Identification Number
      password_hash TEXT NOT NULL,
      full_name     TEXT NOT NULL,
      state         TEXT,
      lga           TEXT,                          -- Local Government Area
      dob           TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS elections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      description TEXT,
      scope       TEXT,                            -- e.g. "Presidential", "Lagos State"
      status      TEXT NOT NULL DEFAULT 'draft',   -- draft | open | closed
      starts_at   TEXT,
      ends_at     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      election_id   INTEGER NOT NULL,
      full_name     TEXT NOT NULL,
      party         TEXT,
      party_acronym TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      election_id  INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      voter_hash   TEXT NOT NULL,                  -- salted hash of (voterId+electionId)
      receipt      TEXT UNIQUE NOT NULL,           -- given to voter to verify their vote
      prev_hash    TEXT NOT NULL,                  -- previous vote_hash in the chain
      vote_hash    TEXT NOT NULL,                  -- this vote's chain hash
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (election_id)  REFERENCES elections(id)  ON DELETE CASCADE,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
      UNIQUE (election_id, voter_hash)             -- enforces ONE vote per voter per election
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT,                             -- admin | voter | system
      actor_id   TEXT,
      action     TEXT NOT NULL,
      details    TEXT,
      ip         TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates(election_id);
    CREATE INDEX IF NOT EXISTS idx_votes_election      ON votes(election_id);
  `);
}

/** Append an entry to the audit log. */
function audit({ actorType = 'system', actorId = null, action, details = null, ip = null }) {
  db.prepare(
    `INSERT INTO audit_log (actor_type, actor_id, action, details, ip)
     VALUES (?, ?, ?, ?, ?)`
  ).run(actorType, actorId == null ? null : String(actorId), action, details, ip);
}

module.exports = { db, init, audit, DB_PATH };
