/**
 * seed.js — Seeds the database with a default admin, sample voters,
 * and a sample Nigerian election with candidates.
 *
 *   node seed.js          -> seed only if empty
 *   node seed.js --reset  -> wipe all data, then seed
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, init, audit } = require('./db');

const RESET = process.argv.includes('--reset');

init();

if (RESET) {
  console.log('Resetting database...');
  db.exec(`
    DELETE FROM votes;
    DELETE FROM candidates;
    DELETE FROM elections;
    DELETE FROM voters;
    DELETE FROM admins;
    DELETE FROM audit_log;
    DELETE FROM sqlite_sequence;
  `);
}

const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
if (adminCount > 0 && !RESET) {
  console.log('Database already seeded. Use "npm run reset" to wipe and reseed.');
  process.exit(0);
}

const hash = (pw) => bcrypt.hashSync(pw, 12);

// ---- Default admin (CHANGE THIS PASSWORD IN PRODUCTION) ----
db.prepare(
  `INSERT INTO admins (username, password_hash, full_name) VALUES (?, ?, ?)`
).run('admin', hash('admin123'), 'INEC Returning Officer');

// ---- Sample voters ----
const voters = [
  { vin: 'VIN0000001', pw: 'voter123', name: 'Adaeze Okafor',   state: 'Lagos',  lga: 'Ikeja',     dob: '1995-04-12' },
  { vin: 'VIN0000002', pw: 'voter123', name: 'Chidi Eze',       state: 'Lagos',  lga: 'Surulere',  dob: '1990-09-03' },
  { vin: 'VIN0000003', pw: 'voter123', name: 'Fatima Bello',    state: 'Kano',   lga: 'Nassarawa', dob: '1988-12-22' },
  { vin: 'VIN0000004', pw: 'voter123', name: 'Tunde Adeyemi',   state: 'Oyo',    lga: 'Ibadan N.', dob: '1992-07-18' },
  { vin: 'VIN0000005', pw: 'voter123', name: 'Ngozi Nwankwo',   state: 'Enugu',  lga: 'Enugu E.',  dob: '1997-01-30' },
];
const insVoter = db.prepare(
  `INSERT INTO voters (vin, password_hash, full_name, state, lga, dob) VALUES (?, ?, ?, ?, ?, ?)`
);
for (const v of voters) insVoter.run(v.vin, hash(v.pw), v.name, v.state, v.lga, v.dob);

// ---- Sample election (open) ----
const electionId = db.prepare(
  `INSERT INTO elections (title, description, scope, status, starts_at, ends_at)
   VALUES (?, ?, ?, 'open', datetime('now'), datetime('now','+30 day'))`
).run(
  'Nigeria Presidential Election 2027 (Demo)',
  'A demonstration presidential election for the e-voting system project.',
  'Presidential'
).lastInsertRowid;

const candidates = [
  { name: 'Amina Yusuf',     party: 'All Progressives Congress',     acr: 'APC' },
  { name: 'Emeka Obiora',    party: "Peoples Democratic Party",      acr: 'PDP' },
  { name: 'Bola Akande',     party: 'Labour Party',                  acr: 'LP'  },
  { name: 'Sani Mohammed',   party: 'New Nigeria Peoples Party',     acr: 'NNPP'},
];
const insCand = db.prepare(
  `INSERT INTO candidates (election_id, full_name, party, party_acronym) VALUES (?, ?, ?, ?)`
);
for (const c of candidates) insCand.run(electionId, c.name, c.party, c.acr);

audit({ actorType: 'system', action: 'SEED', details: 'Initial data seeded' });

console.log('Seed complete.');
console.log('--------------------------------------------------');
console.log('Admin login   ->  username: admin     password: admin123');
console.log('Voter logins  ->  VIN: VIN0000001..5   password: voter123');
console.log('Sample election created & OPEN with 4 candidates.');
console.log('--------------------------------------------------');
