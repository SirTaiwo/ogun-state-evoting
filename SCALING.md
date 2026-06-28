# Scaling Analysis

Could this records-layer approach work for Ogun State's ~3 million registered voters?

This document asks a narrower question than it first appears to. It is **not** "could this codebase run a real election" — SECURITY-ANALYSIS.md already answers that (no). It is: *taking the architecture as a records-and-integrity layer, do its data structures and access patterns survive being scaled from a five-voter demo to roughly three million voters?* That is a fair engineering question to ask of any design, and the answers turn out to be a mix of "fine," "needs a real database," and "one structural bottleneck that scaling makes worse."

Throughout, the working figure is Ogun State's roughly 2.5–3 million registered voters (INEC register, recent cycles). Treat it as an order-of-magnitude target, not a precise count.

---

## 1. The data volumes are not the problem

Start with the reassuring part. Three million voters and, say, four tiers of election is not a large amount of data by database standards.

- **Voters:** ~3M rows. Each row is small (VIN, a bcrypt hash, name, state, LGA, dob). Call it a few hundred bytes; the table is well under 1 GB.
- **Votes:** at most one row per voter per election. Four tiers × 3M = 12M vote rows as an absolute ceiling at 100% turnout across every tier. Realistically lower. Each row is small. Low single-digit GB at the outside.
- **Candidates, LGAs, elections:** trivially small (tens to low thousands of rows).
- **Audit log:** the largest-growing table — every login, registration, vote, and integrity check. At 3M voters this could reach tens of millions of rows over a cycle, but it is append-only and rarely queried mid-election, so size alone is manageable.

So raw storage is a non-issue. The interesting limits are about *concurrency*, *the engine*, and *one algorithm that is O(n) in the worst place*.

---

## 2. SQLite is the first hard ceiling

`db.js` uses `better-sqlite3` with `journal_mode = WAL`. WAL is the right pragma and meaningfully improves read concurrency — multiple readers proceed while a writer is active. But the structural fact remains: **SQLite serialises writes. There is exactly one writer at a time, for the whole database file.**

For an election, the write path is vote casting. Consider the load:

- 3M voters, and election-day turnout is famously spiky — large fractions of voters arrive in a few peak hours, not spread evenly.
- Every cast vote is a *write* (an `INSERT` into `votes`, plus an `INSERT` into `audit_log`), and — critically — each cast is wrapped in a transaction that also reads the current chain head (see §3).

`better-sqlite3` is synchronous and fast for single writes (tens of thousands per second on good hardware for trivial inserts). But that headline number erodes fast here because each vote is not a trivial insert — it is a transaction containing a "find the last vote" read, a uniqueness check, and two inserts, all serialised against every other in-flight vote across the entire state.

The honest assessment: SQLite could probably cope with a *single LGA* pilot (tens of thousands of voters, modest peak). It is the wrong engine for a state-wide concurrent write load. A real version uses PostgreSQL (or similar) with proper connection pooling and row-level locking, so that writes to different elections — or different shards — proceed in parallel instead of single-file. This is a swap of the persistence layer, not of the design's logic.

---

## 3. The hash chain is the real bottleneck, and scaling makes it worse

This is the finding that matters most, because it is structural rather than just "use a bigger database."

The chain is **global and strictly sequential.** Every vote links to *the single most recent vote in the entire system*, across all four tiers and all 20 LGAs:

```js
const last = db.prepare('SELECT vote_hash FROM votes ORDER BY id DESC LIMIT 1').get();
const prevHash = last ? last.vote_hash : GENESIS;
```

Two consequences, both bad at scale:

**3.1 It forces total serialisation of *all* voting state-wide.** Because each vote's `prev_hash` is the previous vote's `vote_hash`, no two votes can be computed in parallel — not even votes in different elections in different LGAs. A voter in Ogun West casting an Assembly ballot and a voter in Ogun East casting a Senate ballot must be ordered one-behind-the-other in a single global chain. The hash chain doesn't just sit on top of SQLite's single-writer limit; it *requires* single-writer semantics by design. Moving to PostgreSQL would not help here, because the chain itself is the serialisation point. You would have bought parallel writes and then thrown them away.

**3.2 The integrity check is O(n) over every vote ever cast.** `/api/admin/integrity` loads *all* votes and walks the entire chain from `GENESIS`:

```js
const votes = db.prepare('SELECT * FROM votes ORDER BY id ASC').all();
```

At 5 votes this is instant. At 10 million votes it loads the entire vote table into memory and recomputes 10 million SHA-256 hashes on every single integrity check. That is seconds-to-minutes of full-table work per call, and it cannot be done incrementally as written.

**The fix changes the shape of the chain.** Make it *per-election* (or per-LGA-per-election) rather than global. Then:

- Votes in different elections can be cast and chained in parallel — restoring the concurrency that §2's database swap was meant to buy.
- The integrity check becomes per-election and can run independently, in parallel, and incrementally.
- The blast radius of any detected tampering is one election, not the entire state.

This is a genuinely good design change that *only* becomes visible when you ask the scaling question, which is the point of writing this document. The single global chain is the right simplification for a demo and the wrong structure for 3M voters — and the reason is concurrency, not storage.

---

## 4. Query patterns that need indexes before they need anything fancy

A few hot paths are fine logically but would table-scan at scale without indexes the current schema doesn't have:

- **`SELECT * FROM voters WHERE vin = ?`** on login. `vin` is `UNIQUE`, so SQLite has an implicit index — fine.
- **`SELECT id FROM votes WHERE election_id = ? AND voter_hash = ?`** — the already-voted check, run on every cast and every elections-list render. The schema has `idx_votes_election` on `election_id` alone and a `UNIQUE(election_id, voter_hash)` constraint (which provides a usable composite index). So this one is actually covered — worth confirming the unique constraint's index is what's being used.
- **Results aggregation** (`GROUP BY candidate` with a `LEFT JOIN votes`) recomputes tallies from scratch on every `/api/results/:id` call. At 3M votes per election this is a full scan per request. A real system maintains running tallies (incrementally, or via a materialised view) rather than counting from zero each time the results page loads.
- **`isEligible`'s `senatorial-district` branch** runs a `SELECT ... FROM lgas WHERE name = ?` per election per voter on every `/api/elections` render. The `lgas` table is tiny (20 rows) so this is harmless, but caching the LGA→district map in memory removes 20-row lookups from a hot loop trivially.

None of these is hard. They are the ordinary indexing-and-caching pass any app gets before it scales — listed here so the document is concrete rather than gesturing at "performance."

---

## 5. The eligibility model scales fine; the constituency gaps are correctness, not scale

`isEligible` computes eligibility fresh from scope rules on each call. That is the *right* choice for correctness (no stale cached eligibility) and it scales fine — it is O(1) per check plus one tiny `lgas` lookup. Nothing here breaks at 3M voters.

Two non-scale caveats carried over from reading the code, noted so they aren't lost:

- `federal-constituency` eligibility is unimplemented (the House of Reps tier isn't modelled), and `state-constituency` is modelled at LGA granularity by deliberate choice. These are *coverage* gaps, not scaling limits — but a state-wide system would have to resolve them, since real Ogun elections include federal constituencies.
- The duplicate `state-constituency` case (flagged in SECURITY-ANALYSIS.md §3.2) should be cleaned up before anyone reasons about this code at scale.

---

## 6. What a 3M-voter version actually requires

Pulling it together, the changes the scaling question forces, in dependency order:

1. **Swap SQLite for PostgreSQL** (or equivalent) with connection pooling — removes the single-file-write ceiling. (Necessary but, on its own, insufficient — see step 2.)
2. **Make the hash chain per-election, not global** — this is the load-bearing change. Without it, step 1 buys nothing, because the global chain re-serialises everything. (Design work + migration.)
3. **Maintain running vote tallies** instead of aggregating from scratch per results request. (Moderate.)
4. **Make the integrity check per-election and incremental** so it doesn't rescan all votes each call. (Falls out of step 2.)
5. **Cache the tiny reference data** (LGA→district map) in memory. (Trivial.)
6. **Plan audit-log growth** — partition or roll it, since it's the fastest-growing table. (Operational.)

Steps 1 and 2 are the real architecture. The rest is ordinary scaling hygiene.

---

## 7. Honest bottom line

The data *volumes* for 3M voters are unremarkable — this was never going to fail because three million rows is too many rows. It would fail because of **concurrency**: SQLite's single writer, and above it a single global hash chain that mandates total serialisation of every vote in the state and an integrity check that rescans the entire history.

The encouraging part is that the design's *logic* — eligibility computed from scope, ballot secrecy via salted hashes, one-vote-per-election via a unique constraint — scales without change. It is the two serialisation points, the database engine and the global chain, that don't. Both are replaceable without touching that logic: a real database engine, and a chain that is partitioned per election.

So the answer to the title question is: **not as written, and the reason is specifically the global hash chain — but the path to a version that could is clear, and most of the design survives the trip.** That is a more useful conclusion than a flat "no," and it is the kind of insight that only appears when you push a demo's structures against a real population count.