// migrate-scope-1a.js
// Step 1a of scope discipline: ADD scope_type + scope_target columns.
// Purely additive — the old free-text `scope` column stays in place,
// so the app keeps running unchanged. No table rebuild, no risk to
// candidates/votes. Backfills the one existing election. Safe to re-run.

const Database = require('better-sqlite3');
const db = new Database('evoting.db');

// --- Helper: does a column already exist on a table? ---
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`)
           .all()
           .some((c) => c.name === column);
}

const tx = db.transaction(() => {
  // 1. Add scope_type (nullable for now; CHECK constraint comes in 1b)
  if (!hasColumn('elections', 'scope_type')) {
    db.exec(`ALTER TABLE elections ADD COLUMN scope_type TEXT`);
    console.log('Added column: scope_type');
  } else {
    console.log('scope_type already exists — skipping');
  }

  // 2. Add scope_target (nullable; null = national, no narrower target)
  if (!hasColumn('elections', 'scope_target')) {
    db.exec(`ALTER TABLE elections ADD COLUMN scope_target TEXT`);
    console.log('Added column: scope_target');
  } else {
    console.log('scope_target already exists — skipping');
  }

  // 3. Backfill the existing election (id = 1): a state-wide governorship
  const updated = db.prepare(`
    UPDATE elections
    SET scope_type   = 'state',
        scope_target = 'Ogun State'
    WHERE id = 1
  `).run();
  console.log(`Backfilled election id=1 (rows changed: ${updated.changes})`);
});

tx();

console.log('\nCurrent elections after 1a:');
console.log(JSON.stringify(
  db.prepare('SELECT id, title, scope, scope_type, scope_target, status FROM elections').all(),
  null, 2
));

db.close();