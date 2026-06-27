# Ogun State Election-Integrity Case Study

A case study adapting an open-source e-voting reference implementation for **Ogun State, Nigeria**, focused on the **integrity and records layer** of an election system: cryptographic vote receipts, tamper-evident hash chain, audit trail, and four-tier election scoping (presidential, senate, governorship, state assembly). Built for academic and civic-research purposes — **not for use in any real election.**

**What this is NOT:** a complete e-voting solution. Voter authentication, ballot delivery to remote voters, primaries, collation across tiers, petitions, and results declaration are explicitly out of scope. See FINDINGS.md §5.3 and OGUN-ADAPTATIONS.md for the full scope discussion.

## About this project

This repository simulates the **integrity and records layer** of a Nigerian state election system, using Ogun State as concrete context. It implements four tiers of election scoping — the same hierarchy a real Nigerian voter encounters — and demonstrates how voter eligibility, ballot secrecy, and tamper evidence can be combined in a single records-layer system.

The system models:

- **20 Local Government Areas (LGAs)** — Ogun State's full set, mapped to senatorial districts
- **3 Senatorial Districts** — Ogun Central, Ogun East, Ogun West
- **4 election tiers** — Presidential (national), Senate (per-district), Governorship (state-wide), State Assembly (per-LGA)
- **Voter eligibility filtering** — voters can neither see nor cast ballots in elections outside their geographic scope
- **PVC-style voter identifiers** — matching the format of real Nigerian Permanent Voter Cards
- **Cryptographic vote receipts** — voters receive a code to verify their vote was recorded without revealing their choice
- **Tamper-evident hash chain** — each vote linked to the previous; any modification breaks the chain
- **Audit trail** — every action (logins, registrations, votes, integrity checks) recorded with timestamp, actor, and IP

For the detailed engineering account of what was adapted and why, see [`OGUN-ADAPTATIONS.md`](./OGUN-ADAPTATIONS.md). For observations, bugs discovered, and lessons learned during the study, see [`FINDINGS.md`](./FINDINGS.md).

## Honest authorship notice

**The base implementation was AI-generated** by Cowork (Anthropic) using a single prompt. The original codebase is available at https://github.com/SirTaiwo/electronic-voting as a reference implementation.

**This repository contains:**

- The Cowork-generated base code (Node.js + Express + SQLite + EJS)
- **My own adaptations** for Ogun State context: seed data localised to Ogun LGAs, validated geographic structure, PVC-style voter identifiers
- **My own structural extensions**: the four-tier election scoping system (`scope_type` / `scope_target`), the LGA reference table with senatorial-district mapping, the `isEligible` voter-eligibility function, and per-tier seed scripts
- **My own bug fixes** discovered during the study (e.g., Content Security Policy preventing inline event handlers; documented in FINDINGS.md §2.1)
- **My own case study documentation**: `FINDINGS.md` (observations, bugs, security features, UX patterns, lessons) and `OGUN-ADAPTATIONS.md` (engineering decisions and file-by-file map)

I am extending and studying an existing implementation — not claiming to have designed the underlying cryptographic architecture (JWT, bcrypt, SHA-256 hash chain, salted voter hashes). Where I made decisions of my own (scope vocabulary, eligibility rules, migration strategy), those are explicitly documented in `OGUN-ADAPTATIONS.md`.

## Tech stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via better-sqlite3)
- **Authentication:** JWT tokens, bcrypt password hashing
- **Security:** Helmet (CSP), express-rate-limit
- **Frontend:** Plain HTML + CSS (no framework)

## Quick start (local development)

```bash
npm install                          # install dependencies
cp .env.example .env                 # configure environment

# Seed in tier order (each script is idempotent and committed separately)
node seed.js                         # base voters, LGAs, governorship
node seed-senate.js                  # 3 senatorial-district Senate contests
node seed-presidential.js            # national Presidential contest
node seed-state-assembly.js          # per-LGA State Assembly contests

npm start                            # start server at http://localhost:3000

# Optional: verify eligibility filtering end to end
node check-eligibility-live.js       # logs in as voters; prints their eligible contests
```

Default demo accounts (change before any serious use):

- **Admin:** `admin` / `admin123`
- **Voters:** `PVC0000001` / `voter123` (and `PVC0000002..0000005`)

## What this case study covers

The work was carried out in three logical phases. Each phase produced its own commits and (where applicable) its own case-study document.

### Phase 1 — Localisation (✅ complete)

Adapt the generic e-voting reference for Ogun State context.

- Election re-framed as the 2027 Ogun State Governorship, anchored to the real INEC polling date
- Sample voters localised: names, dates of birth, and LGAs drawn from the actual Ogun State LGA list
- Sample candidates with real Nigerian party affiliations (APC, PDP, LP, NNPP) but fictional names — to avoid implying any real person voted any particular way

### Phase 2 — Structural extensions (✅ complete)

Move from a single demo election to a system that models the actual Nigerian electoral hierarchy.

- LGA reference table (the 20 official Ogun LGAs, mapped to senatorial districts) seeded as authoritative reference data
- Voter registration validates LGA at the API layer — invalid LGAs are rejected with a clear error, independent of any client-side dropdown
- Frontend registration uses a dropdown of valid LGAs grouped by senatorial district (Central, East, West)
- Election scope vocabulary introduced: `scope_type` (`presidential` / `senate` / `state_governorship` / `state_assembly`) and `scope_target` (the geographic scope), enforced by a `CHECK` constraint
- Voter eligibility function (`isEligible`) computes which elections a voter can see and vote in, based on their LGA and senatorial district
- API enforces eligibility on both the elections-list and the vote-cast routes — a voter can neither see nor cast an ineligible ballot
- Per-tier seed scripts: `seed-senate.js` (3 districts), `seed-presidential.js` (national), `seed-state-assembly.js` (per-LGA)
- Migration scripts retained for audit: `migrate-scope-1a.js` (added columns), `migrate-scope-1b2.js` (added constraint, retired old column), `reframe-election.js` (renamed first election)

### Phase 3 — Case study documentation (✅ in progress)

Write up what was done and what was learned.

- ✅ [`FINDINGS.md`](./FINDINGS.md) — observations from the study: bugs found, security features observed, UX patterns, lessons. Includes the scope discussion in §5.3 that distinguishes this project from a full e-voting solution.
- ✅ [`OGUN-ADAPTATIONS.md`](./OGUN-ADAPTATIONS.md) — engineering account of what was changed, why, and the file-by-file map.
- ⏳ `SECURITY-ANALYSIS.md` — what would need to change for use in a real Nigerian election (planned for a future session).
- ⏳ `SCALING.md` — could this approach scale to Ogun's ~3 million registered voters? (planned for a future session.)

## Out of scope

This case study deliberately does **not** address:

- **Voter authentication for remote e-voting** — PVC + password is sufficient for a demo, but a real election needs biometric, digital-ID, or supervised in-person authentication
- **Primaries, collation across tiers, petitions, results declaration** — the full election machinery beyond recording and verifying a single vote
- **Ballot delivery** — how a remote voter receives the right ballot for their geography
- **Production deployment** — the demo runs locally; production would require dedicated server hardening, HSM-backed key management, geographic redundancy, and a great deal more

See FINDINGS.md §5.3 and OGUN-ADAPTATIONS.md §4 for the full scope discussion.

## Further reading

- [`FINDINGS.md`](./FINDINGS.md) — observations, bugs, security features, UX patterns, and broader lessons from the study
- [`OGUN-ADAPTATIONS.md`](./OGUN-ADAPTATIONS.md) — engineering account of what was changed, why, and the file-by-file map

## License

MIT — see original Cowork-generated reference at https://github.com/SirTaiwo/electronic-voting for the full text.

## Author

Taiwo Moses Ogungbola — ACA-qualified Chartered Accountant; BSc Accounting; PGCE (Rhodes University, in progress).  
Based in Qonce (King William's Town), Eastern Cape, South Africa.  
GitHub: [@SirTaiwo](https://github.com/SirTaiwo)