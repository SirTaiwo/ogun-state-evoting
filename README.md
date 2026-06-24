# Ogun State E-Voting Case Study

A case study adapting an open-source e-voting reference implementation for **Ogun State, Nigeria**. Built for academic and civic-research purposes — **not for use in any real election.**

## About this project

This repository simulates how a secure e-voting system could be structured for Ogun State's gubernatorial election context. The system models:

- 20 Local Government Areas (LGAs)
- 3 Senatorial Districts (Ogun Central, Ogun East, Ogun West)
- Multi-party gubernatorial candidates
- Voter registration with PVC-style identifiers
- Cryptographic vote receipts and tamper-evident hash chain

## Honest authorship notice

**The base implementation was AI-generated** by Cowork using a single prompt. The original codebase is available at https://github.com/SirTaiwo/electronic-voting as a reference implementation.

**This repository contains:**

- The Cowork-generated base code (Node.js + Express + SQLite + EJS)
- **My own adaptations** for Ogun State context (seed data, regional structure, terminology)
- **My own bug fixes** discovered while studying the code (e.g., Content Security Policy fix)
- **My own case study documentation** (findings, security observations, scaling considerations)

I am studying and extending an existing implementation — not claiming to have designed the underlying cryptographic architecture.

## Tech stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via better-sqlite3)
- **Authentication:** JWT tokens, bcrypt password hashing
- **Security:** Helmet (CSP), express-rate-limit
- **Frontend:** Plain HTML + CSS (no framework)

## Quick start (local development)

```bash
npm install                  # install dependencies
cp .env.example .env         # configure environment
node seed.js                 # seed Ogun-context data
npm start                    # start server at http://localhost:3000
```

Default demo accounts (change before any serious use):

- Admin: `admin` / `admin123`
- Voter: `PVC0000001` / `voter123` (and PVC0000002..0000005)

## Case study scope

### Layer 1 — Cosmetic adaptations (in progress)
- Election re-framed as Ogun gubernatorial 2027
- Sample voters localised to Ogun LGAs
- Sample candidates with Nigerian party affiliations

### Layer 2 — Structural adaptations (planned)
- LGA validation (must be one of Ogun's 20 LGAs)
- Senatorial district mapping
- Polling unit field

### Layer 3 — Case study documentation (planned)
- Findings document
- Security analysis
- Scaling implications for ~3M Ogun voters
- Bugs found and fixed

## License

MIT — see original Cowork-generated boilerplate for full text.

## Author

Taiwo Moses Ogungbola — ACA, BSc Accounting, PGCE (Rhodes University)  
GitHub: [@SirTaiwo](https://github.com/SirTaiwo)