# Security Analysis

What would need to change for this records-layer prototype to be trusted in a real Nigerian election.

This document is an honest assessment of the system as it actually stands in this repository — not an aspirational description. It reads the real `server.js` and `db.js`, names the defects found while writing it, and separates *deliberate scope boundaries* (covered in FINDINGS.md §5.3) from *things that are simply not safe yet*. The headline conclusion is unchanged from the README: **this is a study artifact and must not run a binding election.** The point of the document is to be specific about *why*, so the gap between a prototype and a trustworthy system is legible rather than hand-waved.

---

## 1. Threat model: who are we defending against?

A toy voting demo implicitly assumes an honest operator and a curious-but-powerless user. A real election inverts both assumptions. The adversaries that matter are:

- **A malicious or coerced insider** — someone with write access to the server, the database file, or the deployment pipeline. In Nigerian election history this is the most realistic threat, not an external hacker.
- **A compromised host** — the machine running Node has been rooted, or the `evoting.db` file is reachable on a shared disk.
- **A network attacker** — between voter and server, or able to forge headers.
- **A dishonest voter** — trying to vote twice, vote outside their geography, or repudiate/forge a receipt.

The current system defends *reasonably* against the dishonest voter and the casual network attacker, and **barely at all** against the insider and the compromised host. Everything below follows from that asymmetry.

---

## 2. The central finding: tamper-evident is not tamper-proof

The hash chain is the system's headline integrity feature, and it is the thing most likely to be *over-trusted*. It deserves the most precise statement.

Each vote stores `prev_hash` and `vote_hash`, where:

```
vote_hash = SHA256( prev_hash | election_id | candidate_id | voter_hash | created_at )
```

and `/api/admin/integrity` walks the table from `GENESIS`, recomputing each `vote_hash` and reporting "intact" if every stored hash matches.

The problem: **the integrity check recomputes the chain from exactly the same public inputs an attacker can edit, using no secret.** An insider who can write to `evoting.db` can change a vote's `candidate_id`, then recompute that row's `vote_hash` and every subsequent row's `prev_hash`/`vote_hash` forward. The chain will be internally consistent, and `/api/admin/integrity` will cheerfully report **"Vote chain is intact — no tampering detected."**

So the hash chain detects *accidental* corruption and *naive* edits (someone changing one row with a SQL `UPDATE` and not knowing about the chain). It does **not** detect a knowledgeable adversary — which is precisely the adversary an election must withstand.

What real integrity requires, roughly in order of strength:

1. **Keyed MAC instead of a bare hash.** Replace `SHA256(...)` with `HMAC-SHA256(secret, ...)`, where the secret lives outside the database (ideally in an HSM). Now recomputation requires a key the DB-writer doesn't have, so a database edit can't be "healed." This is the smallest change with the largest payoff.
2. **External anchoring.** Periodically publish the current head `vote_hash` somewhere append-only and outside the operator's control (a public log, a notarised timestamp, even a printed and witnessed value at intervals). This bounds how far back any tampering can reach without being noticed.
3. **Per-vote signatures.** Have an independent signing authority sign each vote as it is cast, so individual rows are non-forgeable, not just chained.
4. **Append-only storage.** SQLite with WAL is not append-only; the file is freely rewritable. A real system stores votes where deletion and in-place edit are structurally prevented or independently witnessed.

Until at least (1) and (2) exist, the honest claim is: *the chain shows that nobody edited the votes carelessly.* It cannot show that nobody edited them deliberately.

---

## 3. Defects found while writing this analysis

These are real bugs in the current code, not hypothetical risks. They are documented here because in an integrity system a correctness bug *is* a security bug.

### 3.1 Schema disagrees with the code (high severity)

`db.js init()` creates the `elections` table with a single `scope` column:

```sql
CREATE TABLE IF NOT EXISTS elections (
  ...
  scope TEXT,   -- e.g. "Presidential", "Lagos State"
  ...
);
```

But `server.js` and `isEligible` everywhere read and write `scope_type` and `scope_target` — columns that `init()` never creates. The system only works because the migration scripts (`migrate-scope-1a.js`, `migrate-scope-1b2.js`) add those columns to an *existing* database after the fact. **A fresh `init()` on a clean machine produces a schema the server cannot run against.** The canonical schema and the running code disagree.

This matters for security because the schema is supposed to be the authoritative definition of what the data *is*. When it lives in two places that contradict each other, you cannot reason about constraints (e.g. the `CHECK` constraint on `scope_type` mentioned in the README is added by migration, not present in `init()`). Fix: make `init()` create the final schema directly; keep migrations only for upgrading already-deployed databases.

### 3.2 Duplicate `case` in `isEligible` (low severity, but misleading)

`isEligible` has `case 'state-constituency':` **twice** — first with a real LGA-granularity implementation, then again in a fall-through group with `federal-constituency` that returns "not yet supported." JavaScript's `switch` takes the first match, so the second `state-constituency` branch is dead code. The behaviour is correct (the implemented branch wins) but the source misleads any reader/auditor into thinking state-constituency is unsupported. In election code, *code that misrepresents its own behaviour to an auditor* is a defect worth fixing. Remove the duplicate label.

### 3.3 Audit-log IP addresses are untrustworthy (medium severity)

`clientIp()` reads `x-forwarded-for` first. That header is client-supplied and trivially spoofable; with `trust proxy` set to `1`, anything beyond a single known proxy can be forged. So the IP recorded against every `LOGIN`, `VOTE_CAST`, etc. cannot be relied on for forensics or non-repudiation. For a demo this is fine; for a real audit trail, the IP must come from the connection as seen by trusted infrastructure, not from a header. The audit log should also be append-only and ideally itself chained — right now an insider who can edit `votes` can equally edit `audit_log` to erase their tracks.

---

## 4. Authentication and session security

The README already scopes voter authentication out (§5.3), and that boundary is correct — PVC + password is a demo stand-in for what a real system needs (biometric / NIN-backed / supervised in-person identity proofing). Within that boundary, the mechanics still have gaps a real deployment must close:

- **`JWT_SECRET` and `VOTE_SALT` default to hardcoded `CHANGE_ME_...` strings.** If the environment variables are unset, the system runs anyway with publicly-known secrets — meaning anyone can forge an admin token and anyone can recompute `voter_hash` values. A real build must *refuse to start* if these are unset or equal to the defaults, rather than degrading silently.
- **No token revocation.** JWTs are valid for 2h with no server-side session store, so a leaked token cannot be invalidated before expiry. Elections need the ability to kill a session immediately.
- **Password floor is 6 characters** with no rate-limit lockout beyond the coarse 50-per-15-min limiter, and admin and voter login share that limiter keyed only by IP. Adequate for a demo; below standard for protecting an admin account that can open and close elections.
- **A single global `VOTE_SALT`** means `voter_hash` is deterministic across the whole table. It enforces one-vote-per-election (good) but anyone who learns the salt can recompute the hash for any `(voter, election)` pair and thus confirm whether a specific person voted in a specific election — a ballot-secrecy weakness against an insider who knows the salt. Per-election salts, or a keyed derivation, narrow this.

---

## 5. Ballot secrecy: a real but partial property

The design genuinely separates *that you voted* from *who you voted for* at the row level: a `votes` row holds a salted `voter_hash`, not your id, and the public `/api/verify/:receipt` route deliberately returns the election and timestamp but **not** the candidate. That is a thoughtful, correct piece of design and worth keeping.

Its limits, honestly stated:

- Secrecy holds against an outsider reading the `votes` table, **not** against an insider who knows `VOTE_SALT` (see §4) and can therefore link a row back to a voter.
- The receipt is random and stored unlinked to the voter, so a voter who loses their receipt cannot recover it — a deliberate tradeoff that favours secrecy over convenience. Worth stating explicitly so it is understood as a *choice*, not an oversight.
- Timing analysis: votes are chained in insertion order with timestamps, and the audit log records `VOTE_CAST` per voter id with a timestamp. Correlating the audit log's ordered `VOTE_CAST` entries with the votes table's insertion order can re-link voter to vote *without* needing the salt at all. This is a more serious secrecy leak than the salt issue and should be the first thing a real design closes — e.g. by not recording per-voter vote timestamps in a separately-ordered log.

That last point is the kind of finding that only falls out of reading both halves together; it deserves a line in FINDINGS.md too if you agree with it.

---

## 6. Input handling and API surface

Mostly solid for a prototype, with caveats:

- Parameterised queries throughout (`better-sqlite3` prepared statements), so SQL injection is well-handled. Good.
- Helmet sets a CSP, but it allows `'unsafe-inline'` for scripts and a CDN (`cdn.jsdelivr.net`) — necessary for the simple inline frontend, but `'unsafe-inline'` defeats much of CSP's XSS protection. A real frontend should drop inline scripts and pin the CDN by hash (or self-host).
- `express.json({ limit: '100kb' })` caps body size — good. But there is no CSRF protection; the API relies on bearer tokens in the `Authorization` header rather than cookies, which sidesteps classic CSRF, so this is acceptable *as long as* the token is never moved into a cookie.
- No HTTPS enforcement in the app itself. A real deployment must terminate TLS and refuse plaintext; vote traffic and tokens over plain HTTP would be fatal.

---

## 7. What changes, in priority order

If this were ever to move from study artifact toward something real — which the README correctly says it is not — the order that maximises trust per unit of work:

1. **Make secrets mandatory.** Refuse to start without real `JWT_SECRET` / `VOTE_SALT`. (Hours.)
2. **Reconcile the schema.** `init()` must produce the final schema; migrations only upgrade. (Hours.)
3. **Key the integrity chain.** HMAC with an out-of-database secret so DB edits cannot self-heal. (Days.)
4. **Anchor the head hash externally and make the audit log append-only and chained.** (Days–weeks.)
5. **Close the timing/secrecy correlation** between audit log and vote order. (Design work.)
6. **Replace the demo authentication** with real identity proofing — the big one, explicitly out of scope here, and properly the subject of its own project.

Items 1–2 are bug fixes. Items 3–5 are the genuine cryptographic and architectural work that separates "looks like an election system" from "could be trusted as one." Item 6 is the elephant the README already names and sets aside.

---

## 8. Honest bottom line

The prototype gets several things *right* that many student projects get wrong: parameterised queries, bcrypt at cost 12, real ballot-secrecy thinking, eligibility enforced at the API layer rather than only in the UI, and a genuine (if over-trusted) integrity mechanism. Those are worth saying plainly.

But the system's own headline feature — the tamper-evident chain — is safe only against careless tampering, not deliberate insider tampering, which is the threat that actually decides elections. Combined with the schema mismatch, the silent-default secrets, and the audit-log/vote timing leak, the correct conclusion is the one the README already states and this analysis now substantiates in detail: **a valuable thing to have built and studied; not a thing to run an election on.**

The distance between those two is exactly what this document is for.
