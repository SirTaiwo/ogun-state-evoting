// seed-presidential.js — Box 4: seed the 2027 Presidential election.
// National scope -> every active voter is eligible (no district filtering).
// Distinct fictional candidates, real parties. Idempotent: skips if it exists.
//
//   node seed-presidential.js

require('dotenv').config();
const { db, audit } = require('./db');

const TITLE = '2027 Presidential Election (Case Study)';

const candidates = [
  { name: 'Chukwuma Adeyteye',   party: 'All Progressives Congress', acr: 'APC'  },
  { name: 'Halima Mohammed',     party: 'Peoples Democratic Party',  acr: 'PDP'  },
  { name: 'Obinna Okereke',      party: 'Labour Party',              acr: 'LP'   },
  { name: 'Yusuf Abdullahi',     party: 'New Nigeria Peoples Party', acr: 'NNPP' },
];

const insElection = db.prepare(
  `INSERT INTO elections (title, description, scope_type, scope_target, status, starts_at, ends_at)
   VALUES (?, ?, 'national', NULL, 'open', '2027-01-16 08:00:00', '2027-01-16 18:00:00')`
);
const insCandidate = db.prepare(
  `INSERT INTO candidates (election_id, full_name, party, party_acronym) VALUES (?, ?, ?, ?)`
);
const findByTitle = db.prepare('SELECT id FROM elections WHERE title = ?');

const seed = db.transaction(() => {
  if (findByTitle.get(TITLE)) {
    console.log(`Skip (exists): ${TITLE}`);
    return null;
  }
  const electionId = insElection.run(
    TITLE,
    'Demonstration of the nationwide presidential contest, anchored to the ' +
    'INEC 2027 cycle. Polling day: 16 January 2027. All registered voters eligible.'
  ).lastInsertRowid;
  for (const c of candidates) insCandidate.run(electionId, c.name, c.party, c.acr);
  console.log(`Created: ${TITLE} (id=${electionId}, ${candidates.length} candidates)`);
  return electionId;
});

const id = seed();
audit({ actorType: 'system', action: 'SEED_PRESIDENTIAL', details: id ? `created id=${id}` : 'skipped (exists)' });

console.log('\nAll open elections now:');
console.log(JSON.stringify(
  db.prepare(`SELECT id, title, scope_type, scope_target, status FROM elections ORDER BY id`).all(),
  null, 2
));