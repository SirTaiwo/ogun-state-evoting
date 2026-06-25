// seed-senate.js — Box 3: seed the three Ogun senatorial-district Senate
// contests (Central, East, West), each with distinct fictional candidates,
// all set to 'open'. Idempotent: skips any contest that already exists.
//
//   node seed-senate.js

require('dotenv').config();
const { db, audit } = require('./db');

const contests = [
  {
    title: '2027 Ogun Central Senatorial Election (Case Study)',
    target: 'Central',
    candidates: [
      { name: 'Olumide Bankole',   party: 'All Progressives Congress', acr: 'APC' },
      { name: 'Adebisi Kuforiji',  party: 'Peoples Democratic Party',  acr: 'PDP' },
      { name: 'Ngozi Okafor',      party: 'Labour Party',              acr: 'LP'  },
    ],
  },
  {
    title: '2027 Ogun East Senatorial Election (Case Study)',
    target: 'East',
    candidates: [
      { name: 'Oluwaseun Adebayo', party: 'All Progressives Congress', acr: 'APC' },
      { name: 'Folarin Onabanjo',  party: 'Peoples Democratic Party',  acr: 'PDP' },
      { name: 'Chidinma Eze',      party: 'New Nigeria Peoples Party',  acr: 'NNPP'},
    ],
  },
  {
    title: '2027 Ogun West Senatorial Election (Case Study)',
    target: 'West',
    candidates: [
      { name: 'Taiwo Ogunsanya',   party: 'All Progressives Congress', acr: 'APC' },
      { name: 'Morenike Ayodele',  party: 'Peoples Democratic Party',  acr: 'PDP' },
      { name: 'Emeka Nwachukwu',   party: 'Labour Party',              acr: 'LP'  },
    ],
  },
];

const insElection = db.prepare(
  `INSERT INTO elections (title, description, scope_type, scope_target, status, starts_at, ends_at)
   VALUES (?, ?, 'senatorial-district', ?, 'open', '2027-01-16 08:00:00', '2027-01-16 18:00:00')`
);
const insCandidate = db.prepare(
  `INSERT INTO candidates (election_id, full_name, party, party_acronym) VALUES (?, ?, ?, ?)`
);
const findByTitle = db.prepare('SELECT id FROM elections WHERE title = ?');

let created = 0, skipped = 0;

const seed = db.transaction(() => {
  for (const c of contests) {
    if (findByTitle.get(c.title)) { skipped++; console.log(`Skip (exists): ${c.title}`); continue; }

    const electionId = insElection.run(
      c.title,
      `Senate contest for Ogun ${c.target} senatorial district, ` +
      `anchored to the INEC 2027 cycle. Polling day: 16 January 2027.`,
      c.target
    ).lastInsertRowid;

    for (const cand of c.candidates) insCandidate.run(electionId, cand.name, cand.party, cand.acr);
    created++;
    console.log(`Created: ${c.title} (id=${electionId}, ${c.candidates.length} candidates)`);
  }
});

seed();
audit({ actorType: 'system', action: 'SEED_SENATE', details: `created ${created}, skipped ${skipped}` });

console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
console.log('Open senatorial contests now in the system:');
console.log(JSON.stringify(
  db.prepare(
    `SELECT id, title, scope_type, scope_target, status FROM elections
     WHERE scope_type = 'senatorial-district' ORDER BY scope_target`
  ).all(),
  null, 2
));