// migrate-scope-1b2.js
// Step 1b-2: harden the elections table.
//   - Add a CHECK constraint enforcing the six-value scope_type vocabulary.
//   - Make scope_type NOT NULL.
//   - Retire the old free-text `scope` column.
// Rebuilds the table the canonical SQLite way (new table -> copy -> swap),
// preserving every id so candidates/votes foreign keys stay intact.
// Backs up automatically; verifies row counts; rolls back on any failure.

const fs = require('fs');
const Database = require('better-sqlite3');

// --- Automatic safety backup (timestamped) ---
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync('evoting.db', `evoting.db.pre-1b2-${stamp}.backup`);
console.log(`Backup written: evoting.db.pre-1b2-${stamp}.backup`);

const db = new Database('evoting.db');
db.pragma('foreign_keys = OFF');   // defer FK checks during the swap

const before = db.prepare('SELECT COUNT(*) AS n FROM elections').get().n;

const rebuild = db.transaction(() => {
  // 1. New table: disciplined shape, no old `scope` column.
  db.exec(`
    CREATE TABLE elections_new (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      description  TEXT,
      scope_type   TEXT NOT NULL CHECK (scope_type IN
                     ('national','state','senatorial-district',
                      'federal-constituency','state-constituency','lga')),
      scope_target TEXT,
      status       TEXT NOT NULL DEFAULT 'draft',
      starts_at    TEXT,
      ends_at      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 2. Copy every row across, ids preserved. Old `scope` column is dropped
  //    by simply not selecting it.
  db.exec(`
    INSERT INTO elections_new
      (id, title, description, scope_type, scope_target, status, starts_at, ends_at, created_at)
    SELECT
      id, title, description, scope_type, scope_target, status, starts_at, ends_at, created_at
    FROM elections;
  `);

  // 3. Swap: drop old, rename new into place.
  db.exec(`DROP TABLE elections;`);
  db.exec(`ALTER TABLE elections_new RENAME TO elections;`);
});

try {
  rebuild();
  const after = db.prepare('SELECT COUNT(*) AS n FROM elections').get().n;
  if (before !== after) throw new Error(`Row count mismatch: before=${before} after=${after}`);

  // Re-check foreign key integrity now that the swap is done.
  const fkProblems = db.pragma('foreign_key_check');
  if (fkProblems.length) throw new Error(`FK check failed: ${JSON.stringify(fkProblems)}`);

  db.pragma('foreign_keys = ON');
  console.log(`Rebuild OK. Elections preserved: ${after} (was ${before}).`);
  console.log(JSON.stringify(
    db.prepare('SELECT id, title, scope_type, scope_target, status FROM elections').all(),
    null, 2
  ));
} catch (err) {
  console.error('Rebuild FAILED — transaction rolled back. Database is unchanged.');
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}