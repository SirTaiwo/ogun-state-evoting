// check-eligibility-live.js — live per-voter eligibility check via HTTP.
// Logs in as each voter, lists their eligible elections, prints them.
// Pure Node (uses global fetch); no shell token plumbing.

const BASE = 'http://localhost:3000';

async function checkVoter(vin, password, label) {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin, password }),
  }).then((r) => r.json());

  if (!login.token) { console.log(`\n${label} (${vin}): LOGIN FAILED — ${JSON.stringify(login)}`); return; }

  const data = await fetch(`${BASE}/api/elections`, {
    headers: { Authorization: `Bearer ${login.token}` },
  }).then((r) => r.json());

  console.log(`\n${label} (${vin}) — ${login.user.name}, sees ${data.elections.length} election(s):`);
  for (const e of data.elections) console.log(`   • ${e.title}  [${e.scope}]`);
}

(async () => {
  await checkVoter('PVC0000001', 'voter123', 'Adeola — Abeokuta South / Central');
  await checkVoter('PVC0000003', 'voter123', 'Tunde — Ijebu Ode / East');
  await checkVoter('PVC0000002', 'voter123', 'Folake — Ado-Odo/Ota / West');
})();