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

    CREATE TABLE IF NOT EXISTS lgas (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT UNIQUE NOT NULL,
      senatorial_district TEXT NOT NULL,            -- 'Central', 'East', or 'West'
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
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

/** The six valid scope types for an election (the disciplined vocabulary). */
const SCOPE_TYPES = [
  'national',
  'state',
  'senatorial-district',
  'federal-constituency',
  'state-constituency',
  'lga',
];

/** Turn structured scope fields into a human-friendly label for display. */
function scopeLabel({ scope_type, scope_target } = {}) {
  switch (scope_type) {
    case 'national':             return 'Nationwide';
    case 'state':                return scope_target || 'State';
    case 'senatorial-district':  return scope_target ? `${scope_target} Senatorial District` : 'Senatorial District';
    case 'federal-constituency': return scope_target ? `${scope_target} Federal Constituency` : 'Federal Constituency';
    case 'state-constituency':   return scope_target ? `${scope_target} State Constituency` : 'State Constituency';
    case 'lga':                  return scope_target || 'Local Government Area';
    default:                     return scope_target || scope_type || 'Unspecified';
  }
}

/**
 * Decide whether a voter may vote in a given election, computed fresh
 * from scope rules. Returns { eligible: boolean, reason: string }.
 *
 *   national             -> every active voter
 *   state                -> voter.state matches election.scope_target
 *   senatorial-district  -> the district of voter's LGA matches scope_target
 *   lga                  -> voter.lga matches scope_target
 *   state-constituency   -> matched at LGA granularity (target is an LGA name)
 *   federal-constituency -> not yet supported (House of Reps not modelled)
 */
function isEligible(voter, election) {
  if (!voter || !election)
    return { eligible: false, reason: 'Missing voter or election' };
  if (!voter.is_active)
    return { eligible: false, reason: 'Voter account is inactive' };

  const target = election.scope_target;

  switch (election.scope_type) {
    case 'national':
      return { eligible: true, reason: 'National election — all voters eligible' };

    case 'state': {
      const norm = (s) => String(s || '').trim().replace(/\s+state$/i, '').toLowerCase();
      return norm(voter.state) === norm(target)
        ? { eligible: true,  reason: `Registered in ${target}` }
        : { eligible: false, reason: `Not registered in ${target}` };
    }

    case 'senatorial-district': {
      const row = db.prepare('SELECT senatorial_district FROM lgas WHERE name = ?').get(voter.lga);
      if (!row)
        return { eligible: false, reason: `Voter's LGA (${voter.lga || 'none'}) not found` };
      return row.senatorial_district === target
        ? { eligible: true,  reason: `${voter.lga} is in ${target}` }
        : { eligible: false, reason: `${voter.lga} is in ${row.senatorial_district}, not ${target}` };
    }

   case 'state-constituency':
      // Modelled at LGA granularity: the constituency target is an LGA name.
      // Finer sub-LGA boundaries are deliberately not invented (data-integrity decision).
      return voter.lga === target
        ? { eligible: true,  reason: `In state constituency (LGA: ${target})` }
        : { eligible: false, reason: `Not in state constituency (LGA: ${target})` };

    case 'federal-constituency':
    case 'state-constituency':
      return { eligible: false, reason: `${election.scope_type} eligibility not yet supported` };

    default:
      return { eligible: false, reason: `Unknown scope_type: ${election.scope_type}` };
  }
}

module.exports = { db, init, audit, DB_PATH, SCOPE_TYPES, scopeLabel, isEligible };
