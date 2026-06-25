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
  { vin: 'PVC0000001', pw: 'voter123', name: 'Adeola Akinwande',  state: 'Ogun', lga: 'Abeokuta South',   dob: '1985-03-15' },
  { vin: 'PVC0000002', pw: 'voter123', name: 'Folake Adeyemi',    state: 'Ogun', lga: 'Ado-Odo/Ota',      dob: '1990-08-22' },
  { vin: 'PVC0000003', pw: 'voter123', name: 'Tunde Ogundimu',    state: 'Ogun', lga: 'Ijebu Ode',        dob: '1978-11-09' },
  { vin: 'PVC0000004', pw: 'voter123', name: 'Aminat Sowande',    state: 'Ogun', lga: 'Sagamu',           dob: '1995-05-30' },
  { vin: 'PVC0000005', pw: 'voter123', name: 'Babatunde Oyelaja', state: 'Ogun', lga: 'Yewa North',       dob: '1982-07-04' },
];
const insVoter = db.prepare(
  `INSERT INTO voters (vin, password_hash, full_name, state, lga, dob) VALUES (?, ?, ?, ?, ?, ?)`
);
for (const v of voters) insVoter.run(v.vin, hash(v.pw), v.name, v.state, v.lga, v.dob);
// ---- Ogun State LGAs (20 LGAs across 3 senatorial districts) ----
const ogunLgas = [
  // Ogun Central (6 LGAs)
  { name: 'Abeokuta North',  district: 'Central' },
  { name: 'Abeokuta South',  district: 'Central' },
  { name: 'Ewekoro',         district: 'Central' },
  { name: 'Ifo',             district: 'Central' },
  { name: 'Obafemi Owode',   district: 'Central' },
  { name: 'Odeda',           district: 'Central' },
  // Ogun East (9 LGAs)
  { name: 'Ijebu East',      district: 'East' },
  { name: 'Ijebu North',     district: 'East' },
  { name: 'Ijebu North East',district: 'East' },
  { name: 'Ijebu Ode',       district: 'East' },
  { name: 'Ikenne',          district: 'East' },
  { name: 'Odogbolu',        district: 'East' },
  { name: 'Ogun Waterside',  district: 'East' },
  { name: 'Remo North',      district: 'East' },
  { name: 'Sagamu',          district: 'East' },
  // Ogun West (5 LGAs)
  { name: 'Ado-Odo/Ota',     district: 'West' },
  { name: 'Yewa North',      district: 'West' },
  { name: 'Yewa South',      district: 'West' },
  { name: 'Imeko Afon',      district: 'West' },
  { name: 'Ipokia',          district: 'West' },
];

const insLga = db.prepare(
  `INSERT INTO lgas (name, senatorial_district) VALUES (?, ?)`
);
for (const l of ogunLgas) insLga.run(l.name, l.district);
// ---- Sample election (open) ----
const electionId = db.prepare(
  `INSERT INTO elections (title, description, scope_type, scope_target, status, starts_at, ends_at)
   VALUES (?, ?, ?, ?, 'open', datetime('now'), datetime('now','+30 day'))`
).run(
  '2027 Ogun State Governorship Election (Case Study)',
  'A demonstration gubernatorial election for the e-voting system project.',
  'state',
  'Ogun State'
).lastInsertRowid;

const candidates = [
  { name: 'Adetola Olabanji',     party: 'All Progressives Congress',     acr: 'APC' },
  { name: 'Funmilayo Adeyemo',    party: "Peoples Democratic Party",      acr: 'PDP' },
  { name: 'Olamide Sowande',     party: 'Labour Party',                  acr: 'LP'  },
  { name: 'Babatunde Aregbesola',   party: 'New Nigeria Peoples Party',     acr: 'NNPP'},
];
const insCand = db.prepare(
  `INSERT INTO candidates (election_id, full_name, party, party_acronym) VALUES (?, ?, ?, ?)`
);
for (const c of candidates) insCand.run(electionId, c.name, c.party, c.acr);

audit({ actorType: 'system', action: 'SEED', details: 'Initial data seeded' });

console.log('Seed complete.');
console.log('--------------------------------------------------');
console.log('Admin login   ->  username: admin     password: admin123');
console.log('Voter logins  ->  PVC: PVC0000001..5   password: voter123');
console.log('Sample election created & OPEN with 4 candidates.');
console.log('--------------------------------------------------');
