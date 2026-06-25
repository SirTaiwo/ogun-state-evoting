// reframe-election.js
// Step 1 of multi-tier adaptation: reframe the existing election (id=1)
// as the 2027 Ogun State Governorship, anchored to the real INEC date.
// Safe to re-run. Updates one row in place — does not touch id, candidates, or votes.

const Database = require('better-sqlite3');
const db = new Database('evoting.db');

const result = db.prepare(`
  UPDATE elections
  SET title       = @title,
      description = @description,
      scope       = @scope,
      starts_at   = @starts_at,
      ends_at     = @ends_at
  WHERE id = 1
`).run({
  title:       '2027 Ogun State Governorship Election (Case Study)',
  description: 'Demonstration of the gubernatorial contest for Ogun State, '
             + 'anchored to the INEC 2027 general election cycle. '
             + 'Polling day: 6 February 2027.',
  scope:       'Ogun State',
  // INEC: Governorship & State Assembly polls hold 6 February 2027.
  // Times are illustrative polling-window bounds for the case study.
  starts_at:   '2027-02-06 08:00:00',
  ends_at:     '2027-02-06 18:00:00',
});

console.log(`Rows updated: ${result.changes}`);
console.log(JSON.stringify(
  db.prepare('SELECT * FROM elections WHERE id = 1').get(),
  null, 2
));

db.close();