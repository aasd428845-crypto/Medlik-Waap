/*
 * bonus_role_account_map → financial_accounts embed shape — CASE 1-5
 * (regression guard for the PGRST201 duplicate-FK embed failure).
 *
 * Background: 0029 defines the FK on bonus_role_account_map.account_id twice
 * (inline CREATE TABLE reference auto-named `…_account_id_fkey` AND the ALTER
 * TABLE constraint `bonus_role_account_map_account_fk`). Any un-hinted
 * `financial_accounts!inner(...)` embed therefore fails at runtime with
 * "Could not embed because more than one relationship was found" — which
 * broke the director mapping editor (red error box + a FALSE
 * ACCOUNT_MAPPING_REQUIRED banner despite active map rows).
 *
 * The fix is UI-only: every embed must pin the named constraint via
 * ROLE_ACCOUNT_MAP_EMBED (bonusRoleAccountMapQuery.ts). No migration.
 *
 * PURE-TS + node:fs source tripwire. No DB / no Supabase. Excluded from
 * tsconfig (*.test.ts); run with:
 *
 *   node --experimental-strip-types src/lib/bonusRoleAccountMapQuery.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ROLE_ACCOUNT_MAP_EMBED,
  ROLE_ACCOUNT_MAP_FK_CONSTRAINT,
} from './bonusRoleAccountMapQuery.ts';

// ── Minimal inline assertion harness (no @types/node dependency) ──────────────
let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`PASS: ${msg}`);
  } else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// CASE 1 — the embed pins the exact named constraint from 0029's ALTER TABLE.
// If 0029's constraint name ever differs (it must not — migrations are frozen),
// or someone renames the constant, this fails loudly instead of failing at
// runtime in the director UI.
check(
  ROLE_ACCOUNT_MAP_FK_CONSTRAINT === 'bonus_role_account_map_account_fk',
  'CASE 1: constraint constant matches the 0029 ALTER TABLE name exactly',
);

// CASE 2 — the embed is disambiguated (contains `!<constraint>!`) — a bare
// `financial_accounts!inner` is the ambiguous shape that triggers PGRST201.
check(
  ROLE_ACCOUNT_MAP_EMBED.includes(
    `financial_accounts!${ROLE_ACCOUNT_MAP_FK_CONSTRAINT}!inner`,
  ),
  'CASE 2: embed uses the named-constraint disambiguation (not the ambiguous bare form)',
);

// CASE 3 — the embed is an inner join and requests only display columns, so a
// mapping row without an account can never produce a half-decorated row and
// the payload stays under the `financial_accounts` key the consumers read.
check(
  ROLE_ACCOUNT_MAP_EMBED.endsWith('!inner(code, name)'),
  'CASE 3: embed is inner-joined and selects only (code, name)',
);

// CASE 4 — no un-hinted financial_accounts embed may exist anywhere in the
// lib (source tripwire: catches future call sites reintroducing PGRST201).
// Every occurrence must carry a constraint hint (i.e. not be followed by
// `!inner` / `!left` directly).
{
  const dir = fileURLToPath(new URL('./', import.meta.url));
  const files = ['bonusFinancialApi.ts', 'bonusAccountingPolicyLive.ts'];
  let bad: string[] = [];
  for (const f of files) {
    const text = readFileSync(dir + f, 'utf8');
    for (const line of text.split('\n')) {
      if (/financial_accounts!(inner|left)/.test(line)) bad.push(`${f}: ${line.trim()}`);
    }
  }
  check(
    bad.length === 0,
    `CASE 4: no ambiguous financial_accounts embed in consumers (${bad.length} offenders)`,
  );
  if (bad.length > 0) console.error(bad.join('\n'));
}

// CASE 5 — the shared constant is actually what both consumers interpolate
// (guards against someone re-inlining a drifted literal in one file while the
// test-only constant stays correct).
{
  const dir = fileURLToPath(new URL('./', import.meta.url));
  for (const f of ['bonusFinancialApi.ts', 'bonusAccountingPolicyLive.ts']) {
    const text = readFileSync(dir + f, 'utf8');
    check(
      text.includes('ROLE_ACCOUNT_MAP_EMBED'),
      `CASE 5: ${f} builds its select from the shared hinted constant`,
    );
  }
}

console.log('──────────────────────────────────────────');
if (failures > 0) {
  console.error(`bonus_role_account_map embed shape: ${failures} failed`);
  process.exitCode = 1;
} else {
  console.log('bonus_role_account_map embed shape: ALL CASES PASS');
}
