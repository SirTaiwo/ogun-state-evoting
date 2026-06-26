# Ogun State E-Voting — Adaptations

*A case-study record of how a single-election voting system was adapted into a
multi-tier electoral records layer for the Nigerian 2027 general election cycle.*

## 1. Project goal

This project began as a working but minimal e-voting system: voter registration,
authentication, a single election, ballot secrecy through hashed voter tokens, and
a tamper-evident vote chain. The goal of the adaptation described here was not to
add features for their own sake, but to test a specific claim — that the system's
real contribution is as an **integrity and records layer**: the part of an election
that reliably records who is eligible to vote in which contest, captures each vote
once, and preserves it against tampering.

To test that claim against something real, the system was anchored to the Nigerian
2027 general election cycle and extended to model the full tier structure of that
cycle — Presidential, Senate, Governorship, and State House of Assembly — using
Ogun State as the worked example. The question driving every change was simple:
*can one records layer correctly determine, for any voter and any contest across
all these tiers, whether that voter is eligible?* The sections that follow document
how that was achieved, what was deliberately left unchanged, and where the
boundaries of the model were drawn on purpose.
## 2. The multi-tier adaptation

The system originally modelled one election: a gubernatorial contest in which
every registered voter could vote. Extending it to four tiers could have meant
bolting on special-case logic for each new contest type. Instead, the adaptation
rested on one structural idea: an election is defined not by *what it is called*
but by the **scope** of voters it draws from.

This was captured in two fields on every election: a `scope_type` drawn from a
fixed vocabulary — `national`, `state`, `senatorial-district`, `state-constituency`,
`lga` (plus `federal-constituency`, reserved but not modelled) — and a
`scope_target` naming the specific area, where one applies. A presidential contest
is `national` with no target; the Ogun governorship is `state` targeting "Ogun
State"; an Ogun Central senate seat is `senatorial-district` targeting "Central".
Once an election can describe its own catchment this way, adding a new tier becomes
a matter of *data*, not new code.

Eligibility is then computed, not stored. A single function answers, for any voter
and any election, whether that voter may participate — by reading the scope rules:
a national contest admits everyone; a state contest matches the voter's state; a
senatorial-district contest looks up the senatorial district of the voter's Local
Government Area and compares it to the target; a constituency contest matches at
LGA level. Because eligibility is derived fresh each time rather than recorded in a
table, it can never drift out of date as voter or election data changes.

The result is a system in which a single voter, logging in, sees exactly the
contests they are entitled to vote in — their presidential and gubernatorial
ballots (shared by all in the state), their own senatorial district's contest, and
their own state constituency's contest — and never another district's. The same
records layer resolves four different scopes simultaneously and correctly, which is
the claim the project set out to demonstrate.
## 3. Key design decisions

Three decisions shaped the adaptation, each made deliberately and each defensible
on its own terms.

**Separating contest type from scope.** The original election carried a single
free-text `scope` field that conflated two different questions — what kind of
contest this is, and what area it draws from. The adaptation split these apart and
constrained `scope_type` to a fixed vocabulary enforced by a database `CHECK`
constraint, so that an invalid scope cannot be stored even by a direct database
write, not merely blocked in application code. Disciplining the data at its source,
rather than trusting every code path to validate, is consistent with the system's
integrity-first posture.

**Computing eligibility rather than recording it.** Eligibility could have been
materialised into a table listing which voters may vote in which contests. That
was rejected in favour of computing it on demand from scope rules. A stored table
is a second source of truth that can fall out of step with reality when a voter's
details or an election's scope change; a computed rule cannot. For a records layer
whose entire value is trustworthiness, "no second source of truth to drift" was
worth more than the marginal convenience of a stored lookup.

**Modelling state constituencies at LGA granularity — and stopping there.** This
was the most consequential decision. Nigerian state constituencies are sub-LGA:
a single Local Government Area can divide into several. Modelling them with full
fidelity would have required boundary data that is not reliably available, which
in practice would have meant inventing the splits. For a project whose subject is
*integrity*, fabricating boundary data to appear more complete would have
undermined the very thing being demonstrated. State constituencies were therefore
modelled to the granularity of data that could be stood behind — the LGA — and the
simplification was documented in the code itself, beside the logic it governs. The
system models exactly as much as it can verify, and says so.
## 4. What was deliberately not changed or built

An adaptation is defined as much by its restraint as by its additions. Several
things were left untouched on purpose.

**The vote-integrity core was not modified.** The hashed voter tokens that provide
ballot secrecy, the one-vote-per-election constraint, the tamper-evident vote chain,
and the receipt-and-verification mechanism were all left exactly as they were. These
are the heart of the integrity layer, and they were already correct; the multi-tier
work added new *contests* around them without altering how a vote is cast, secured,
or verified. Authentication, rate limiting, and the audit log were likewise left
in place unchanged.

**The administrative hierarchy stops at the LGA.** The model deliberately does not
descend to the ward level, the administrative tier below the LGA. Ward-level data
in Nigeria is large, shifting, and unevenly documented; modelling it would have
meant either sourcing data the project could not verify or inventing it. Stopping
at the LGA keeps every record traceable to data that can be stood behind, and the
floor was set there on purpose rather than by omission.

**The House of Representatives tier was not modelled.** The scope vocabulary
reserves `federal-constituency` for House of Representatives seats, but no such
contests were built. Federal constituencies, like state constituencies, do not
align cleanly with LGA boundaries, and modelling them faithfully would have raised
the same data-fidelity problem. The placeholder in the vocabulary records the
intent and the shape of the gap, without pretending the gap is filled.

**Scope was kept narrow on purpose.** The full electoral process — campaigns,
primaries, collation across tiers, petitions, results declaration — was never in
scope. This system is the records-and-integrity slice of an election, not the whole
machine. Holding that line is what allowed the multi-tier adaptation to be completed
and verified rather than left perpetually half-built.
## 5. Map of files touched

The adaptation was carried out in small, independently committed steps. The files
involved, and their role in the multi-tier system:

| File | Role in the adaptation |
|------|------------------------|
| `db.js` | Schema and data layer. Holds the `elections` table (with `scope_type` / `scope_target` and the `CHECK` constraint), the `scopeLabel` helper for human-readable scope names, and the `isEligible` function that computes voter eligibility from scope rules. |
| `server.js` | API layer. The create-election route validates `scope_type` against the fixed vocabulary; the voter election list and the vote-cast route both apply `isEligible`, so a voter can neither see nor cast an ineligible ballot. |
| `seed.js` | Base seed: sample Ogun voters, the 20 LGAs mapped to their three senatorial districts, and the gubernatorial contest in its disciplined scope form. |
| `seed-senate.js` | Seeds the three Ogun senatorial-district Senate contests (Central, East, West). |
| `seed-presidential.js` | Seeds the national-scope Presidential contest. |
| `seed-state-assembly.js` | Seeds State House of Assembly contests at LGA granularity, with the modelling decision documented in the file. |
| `check-eligibility-live.js` | Verification script: logs in as voters across districts and prints the contests each is eligible for, demonstrating the filter end to end. |

### Migration scripts (one-time, retained for the record)

| Script | What it did |
|--------|-------------|
| `reframe-election.js` | Reframed the original election as the 2027 Ogun State Governorship, anchored to the real INEC polling date. |
| `migrate-scope-1a.js` | Added the `scope_type` and `scope_target` columns (additive, non-breaking). |
| `migrate-scope-1b2.js` | Rebuilt the `elections` table with the `CHECK` constraint and retired the old free-text `scope` column. |

Each step was committed separately, so the project history reads as a sequence of
small, reversible changes rather than one large rewrite — itself a property worth
having in a system concerned with integrity and auditability.