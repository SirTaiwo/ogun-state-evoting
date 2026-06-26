// seed-state-assembly.js — Box 5: seed State House of Assembly contests.
//
// Modelling note (data-integrity decision): Ogun's real state constituencies
// are sub-LGA and finer boundary data is not reliably available, so we model
// each constituency at LGA granularity — scope_target is an LGA name, and
// eligibility resolves by the voter's LGA. This is a deliberate, documented
// simplification rather than inventing boundary splits.
//
// Idempotent: skips any contest that already exists.
//   node seed-state-assembly.js

require('dotenv').config();
const { db, audit } = require('./db');

// One assembly contest per listed LGA (matching sample voters' LGAs so the
// per-constituency filtering is visible in the live check).
const contests = [
  {
    title: '2027 Ogun State Assembly — Abeokuta South Constituency (Case Study)',
    lga: 'Abeokuta South',
    candidates: [
      { name: 'Wale Odunsi',      party: 'All Progressives Congress', acr: 'APC' },
      { name: 'Bisi Adekunle',    party: 'Peoples Democratic Party',  acr: 'PDP' },
    ],
  },
  {
    title: '2027 Ogun State Assembly — Ijebu Ode Constituency (Case Study)',
    lga: 'Ijebu Ode',
    candidates: [
      { name: 'Segun Balogun',    party: 'All Progressives Congress', acr: 'APC' },
      { name: 'Tope Falana',      party: 'Labour Party',              acr: 'LP'  },
    ],
  },
  {
    title: '2027 Ogun State Assembly — Ado-Odo/Ota Constituency (Case Study)',
    lga: 'Ado-Odo/Ota',
    candidates: [
      { name: 'Kemi Oladipo',     party: 'All Progressives Congress', acr: 'APC' },
      { name: 'Femi Adewale',     party: 'Peoples Democratic Party',  acr: 'PDP' },
    ],
  },
];

const insElection = db.prepare(
  `INSERT INTO elections (title, description, scope_type, scope_target, status, starts_at, ends_at)
   VALUES (?, ?, 'state-constituency', ?, 'open', '2027-02-06 08:00:00', '2027-02-06 18:00:00')`
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
      `State House of Assembly contest, modelled at LGA granularity ` +
      `(constituency = ${c.lga}). Anchored to the INEC 2027 cycle. ` +
      `Polling day: 6 February 2027.`,
      c.lga
    ).lastInsertRowid;

    for (const cand of c.candidates) insCandidate.run(electionId, cand.name, cand.party, cand.acr);
    created++;
    console.log(`Created: ${c.title} (id=${electionId}, ${c.candidates.length} candidates)`);
  }
});

seed();
audit({ actorType: 'system', action: 'SEED_STATE_ASSEMBLY', details: `created ${created}, skipped ${skipped}` });

console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
console.log('State Assembly contests now in the system:');
console.log(JSON.stringify(
  db.prepare(
    `SELECT id, title, scope_type, scope_target, status FROM elections
     WHERE scope_type = 'state-constituency' ORDER BY scope_target`
  ).all(),
  null, 2
));