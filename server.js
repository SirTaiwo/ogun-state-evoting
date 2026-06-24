/**
 * server.js — Nigeria E-Voting System API + static frontend.
 *
 * Stack: Node.js + Express + SQLite (better-sqlite3) + JWT + bcrypt.
 * Features: voter auth, admin dashboard, live results, security/verification.
 */

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db, init, audit } = require('./db');

init();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_dev_secret_do_not_use_in_prod';
const VOTE_SALT = process.env.VOTE_SALT || 'CHANGE_ME_vote_salt';

// ---------- Security middleware ----------
app.use(helmet({
  // Allow the Chart.js CDN + inline page scripts used by the simple frontend.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '100kb' }));
app.set('trust proxy', 1);

// Stricter limit on auth + voting endpoints to slow brute force / spam.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
const voteLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

const clientIp = (req) => (req.headers['x-forwarded-for'] || req.ip || '').toString();

// ---------- Helpers ----------
function sign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}

function authRequired(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (role && decoded.role !== role) return res.status(403).json({ error: 'Forbidden' });
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

// Deterministic, non-reversible voter token for an election (ballot secrecy + 1 vote).
function voterHashFor(voterId, electionId) {
  return crypto.createHash('sha256')
    .update(`${VOTE_SALT}:${voterId}:${electionId}`)
    .digest('hex');
}

// Hash chain: link each vote to the previous one for tamper evidence.
function computeVoteHash(prevHash, electionId, candidateId, voterHash, createdAt) {
  return crypto.createHash('sha256')
    .update(`${prevHash}|${electionId}|${candidateId}|${voterHash}|${createdAt}`)
    .digest('hex');
}

const GENESIS = '0'.repeat(64);

// =====================================================================
//  AUTH ROUTES
// =====================================================================
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { vin, password, fullName, state, lga, dob } = req.body || {};
  if (!vin || !password || !fullName)
    return res.status(400).json({ error: 'VIN, password and full name are required' });
  if (!/^[A-Za-z0-9]{6,20}$/.test(vin))
    return res.status(400).json({ error: 'VIN must be 6-20 letters/digits' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = db.prepare('SELECT id FROM voters WHERE vin = ?').get(vin);
  if (exists) return res.status(409).json({ error: 'A voter with this VIN already exists' });

  const hash = bcrypt.hashSync(String(password), 12);
  const info = db.prepare(
    `INSERT INTO voters (vin, password_hash, full_name, state, lga, dob) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(vin, hash, fullName, state || null, lga || null, dob || null);

  audit({ actorType: 'voter', actorId: info.lastInsertRowid, action: 'REGISTER', details: `VIN ${vin}`, ip: clientIp(req) });
  res.status(201).json({ message: 'Registration successful. You can now log in.' });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { vin, password } = req.body || {};
  const voter = db.prepare('SELECT * FROM voters WHERE vin = ?').get(vin || '');
  if (!voter || !bcrypt.compareSync(String(password || ''), voter.password_hash))
    return res.status(401).json({ error: 'Invalid VIN or password' });
  if (!voter.is_active) return res.status(403).json({ error: 'This voter account is disabled' });

  audit({ actorType: 'voter', actorId: voter.id, action: 'LOGIN', ip: clientIp(req) });
  const token = sign({ sub: voter.id, role: 'voter', name: voter.full_name, vin: voter.vin });
  res.json({ token, user: { id: voter.id, name: voter.full_name, vin: voter.vin, role: 'voter' } });
});

app.post('/api/auth/admin/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username || '');
  if (!admin || !bcrypt.compareSync(String(password || ''), admin.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });

  audit({ actorType: 'admin', actorId: admin.id, action: 'ADMIN_LOGIN', ip: clientIp(req) });
  const token = sign({ sub: admin.id, role: 'admin', name: admin.full_name, username: admin.username });
  res.json({ token, user: { id: admin.id, name: admin.full_name, username: admin.username, role: 'admin' } });
});

app.get('/api/auth/me', authRequired(), (req, res) => res.json({ user: req.user }));

// =====================================================================
//  VOTER ROUTES
// =====================================================================

// List open elections + whether this voter has already voted.
app.get('/api/elections', authRequired('voter'), (req, res) => {
  const elections = db.prepare(
    `SELECT id, title, description, scope, status, starts_at, ends_at
     FROM elections WHERE status = 'open' ORDER BY created_at DESC`
  ).all();

  const result = elections.map((e) => {
    const vh = voterHashFor(req.user.sub, e.id);
    const voted = db.prepare('SELECT id FROM votes WHERE election_id = ? AND voter_hash = ?').get(e.id, vh);
    const candidates = db.prepare(
      'SELECT id, full_name, party, party_acronym FROM candidates WHERE election_id = ? ORDER BY id'
    ).all(e.id);
    return { ...e, hasVoted: !!voted, candidates };
  });
  res.json({ elections: result });
});

// Cast a vote.
app.post('/api/elections/:id/vote', voteLimiter, authRequired('voter'), (req, res) => {
  const electionId = Number(req.params.id);
  const candidateId = Number((req.body || {}).candidateId);

  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(electionId);
  if (!election) return res.status(404).json({ error: 'Election not found' });
  if (election.status !== 'open') return res.status(403).json({ error: 'This election is not open for voting' });

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ? AND election_id = ?').get(candidateId, electionId);
  if (!candidate) return res.status(400).json({ error: 'Invalid candidate for this election' });

  const voterHash = voterHashFor(req.user.sub, electionId);

  // The whole cast is one transaction so the chain stays consistent.
  const cast = db.transaction(() => {
    const already = db.prepare('SELECT id FROM votes WHERE election_id = ? AND voter_hash = ?').get(electionId, voterHash);
    if (already) { const e = new Error('ALREADY_VOTED'); e.code = 'ALREADY_VOTED'; throw e; }

    const last = db.prepare('SELECT vote_hash FROM votes ORDER BY id DESC LIMIT 1').get();
    const prevHash = last ? last.vote_hash : GENESIS;
    const createdAt = new Date().toISOString();
    const receipt = crypto.randomBytes(9).toString('hex').toUpperCase(); // 18-char receipt
    const voteHash = computeVoteHash(prevHash, electionId, candidateId, voterHash, createdAt);

    db.prepare(
      `INSERT INTO votes (election_id, candidate_id, voter_hash, receipt, prev_hash, vote_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(electionId, candidateId, voterHash, receipt, prevHash, voteHash, createdAt);

    return { receipt, voteHash, createdAt };
  });

  try {
    const out = cast();
    audit({ actorType: 'voter', actorId: req.user.sub, action: 'VOTE_CAST', details: `election ${electionId}`, ip: clientIp(req) });
    res.status(201).json({
      message: 'Your vote has been recorded.',
      receipt: out.receipt,
      verificationHash: out.voteHash,
      castAt: out.createdAt,
    });
  } catch (err) {
    if (err.code === 'ALREADY_VOTED')
      return res.status(409).json({ error: 'You have already voted in this election' });
    console.error(err);
    res.status(500).json({ error: 'Could not record vote' });
  }
});

// Public receipt verification (does NOT reveal the candidate -> ballot secrecy).
app.get('/api/verify/:receipt', (req, res) => {
  const vote = db.prepare(
    `SELECT v.receipt, v.vote_hash, v.created_at, e.title AS election_title
     FROM votes v JOIN elections e ON e.id = v.election_id
     WHERE v.receipt = ?`
  ).get(String(req.params.receipt || '').trim().toUpperCase());
  if (!vote) return res.status(404).json({ found: false, error: 'No vote found for this receipt' });
  res.json({
    found: true,
    election: vote.election_title,
    castAt: vote.created_at,
    verificationHash: vote.vote_hash,
    message: 'This receipt matches a recorded vote.',
  });
});

// =====================================================================
//  RESULTS (public)
// =====================================================================
app.get('/api/results/:id', (req, res) => {
  const electionId = Number(req.params.id);
  const election = db.prepare('SELECT id, title, scope, status FROM elections WHERE id = ?').get(electionId);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  const rows = db.prepare(
    `SELECT c.id, c.full_name, c.party, c.party_acronym,
            COUNT(v.id) AS votes
     FROM candidates c
     LEFT JOIN votes v ON v.candidate_id = c.id
     WHERE c.election_id = ?
     GROUP BY c.id
     ORDER BY votes DESC, c.id`
  ).all(electionId);

  const total = rows.reduce((s, r) => s + r.votes, 0);
  const results = rows.map((r) => ({
    ...r,
    percentage: total ? +((r.votes / total) * 100).toFixed(2) : 0,
  }));
  res.json({ election, totalVotes: total, results });
});

// List all elections (for the public results page selector).
app.get('/api/results', (req, res) => {
  const elections = db.prepare(
    `SELECT id, title, scope, status FROM elections ORDER BY created_at DESC`
  ).all();
  res.json({ elections });
});

// =====================================================================
//  ADMIN ROUTES
// =====================================================================
const adminOnly = authRequired('admin');

app.get('/api/admin/stats', adminOnly, (req, res) => {
  const voters = db.prepare('SELECT COUNT(*) AS n FROM voters').get().n;
  const elections = db.prepare('SELECT COUNT(*) AS n FROM elections').get().n;
  const open = db.prepare("SELECT COUNT(*) AS n FROM elections WHERE status='open'").get().n;
  const votes = db.prepare('SELECT COUNT(*) AS n FROM votes').get().n;
  const turnout = voters ? +((votes / voters) * 100).toFixed(1) : 0;
  res.json({ voters, elections, openElections: open, votesCast: votes, turnout });
});

app.get('/api/admin/elections', adminOnly, (req, res) => {
  const elections = db.prepare(
    `SELECT e.*,
       (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id) AS candidate_count,
       (SELECT COUNT(*) FROM votes v WHERE v.election_id = e.id)      AS vote_count
     FROM elections e ORDER BY e.created_at DESC`
  ).all();
  res.json({ elections });
});

app.post('/api/admin/elections', adminOnly, (req, res) => {
  const { title, description, scope } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const info = db.prepare(
    `INSERT INTO elections (title, description, scope, status) VALUES (?, ?, ?, 'draft')`
  ).run(title, description || null, scope || null);
  audit({ actorType: 'admin', actorId: req.user.sub, action: 'ELECTION_CREATE', details: title, ip: clientIp(req) });
  res.status(201).json({ id: info.lastInsertRowid, message: 'Election created (status: draft)' });
});

app.post('/api/admin/elections/:id/status', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!['draft', 'open', 'closed'].includes(status))
    return res.status(400).json({ error: 'Status must be draft, open or closed' });
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
  if (!election) return res.status(404).json({ error: 'Election not found' });
  if (status === 'open') {
    const n = db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE election_id = ?').get(id).n;
    if (n < 2) return res.status(400).json({ error: 'Add at least 2 candidates before opening' });
  }
  db.prepare(`UPDATE elections SET status = ?,
              starts_at = CASE WHEN ?='open' AND starts_at IS NULL THEN datetime('now') ELSE starts_at END,
              ends_at   = CASE WHEN ?='closed' THEN datetime('now') ELSE ends_at END
              WHERE id = ?`).run(status, status, status, id);
  audit({ actorType: 'admin', actorId: req.user.sub, action: 'ELECTION_STATUS', details: `${id} -> ${status}`, ip: clientIp(req) });
  res.json({ message: `Election is now ${status}` });
});

app.post('/api/admin/elections/:id/candidates', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { fullName, party, partyAcronym } = req.body || {};
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
  if (!election) return res.status(404).json({ error: 'Election not found' });
  if (election.status !== 'draft')
    return res.status(403).json({ error: 'Candidates can only be added while the election is a draft' });
  if (!fullName) return res.status(400).json({ error: 'Candidate name is required' });
  const info = db.prepare(
    `INSERT INTO candidates (election_id, full_name, party, party_acronym) VALUES (?, ?, ?, ?)`
  ).run(id, fullName, party || null, partyAcronym || null);
  audit({ actorType: 'admin', actorId: req.user.sub, action: 'CANDIDATE_ADD', details: `${fullName} (election ${id})`, ip: clientIp(req) });
  res.status(201).json({ id: info.lastInsertRowid, message: 'Candidate added' });
});

app.delete('/api/admin/candidates/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const cand = db.prepare(
    `SELECT c.*, e.status AS estatus FROM candidates c JOIN elections e ON e.id = c.election_id WHERE c.id = ?`
  ).get(id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found' });
  if (cand.estatus !== 'draft')
    return res.status(403).json({ error: 'Candidates can only be removed while the election is a draft' });
  db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
  audit({ actorType: 'admin', actorId: req.user.sub, action: 'CANDIDATE_DELETE', details: String(id), ip: clientIp(req) });
  res.json({ message: 'Candidate removed' });
});

app.get('/api/admin/audit', adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
  res.json({ entries: rows });
});

// Verify the integrity of the entire vote hash chain.
app.get('/api/admin/integrity', adminOnly, (req, res) => {
  const votes = db.prepare('SELECT * FROM votes ORDER BY id ASC').all();
  let prev = GENESIS;
  let broken = null;
  for (const v of votes) {
    const expected = computeVoteHash(prev, v.election_id, v.candidate_id, v.voter_hash, v.created_at);
    if (v.prev_hash !== prev || v.vote_hash !== expected) { broken = v.id; break; }
    prev = v.vote_hash;
  }
  res.json({
    totalVotes: votes.length,
    intact: broken === null,
    brokenAtVoteId: broken,
    message: broken === null
      ? 'Vote chain is intact — no tampering detected.'
      : `Tampering detected at vote #${broken}.`,
  });
});

// =====================================================================
//  STATIC FRONTEND (served from this same folder)
// =====================================================================
const send = (file) => (req, res) => res.sendFile(path.join(__dirname, file));
app.get('/', send('index.html'));
app.get('/voter', send('voter.html'));
app.get('/admin', send('admin.html'));
app.get('/results', send('results.html'));
app.get('/styles.css', (req, res) => {
  res.type('text/css').sendFile(path.join(__dirname, 'styles.css'));
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`\n  Nigeria E-Voting System running:  http://localhost:${PORT}\n`);
});
