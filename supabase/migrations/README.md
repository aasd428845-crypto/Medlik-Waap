# Migration Chain — Legacy Fragment (Medlik-Waap)

This directory (`Medlik-Waap/supabase/migrations/`) is a **legacy/mirror fragment**
of the authoritative chain at `supabase/migrations/`.

**Neither directory works alone.** They are complementary fragments that must be
interleaved in the exact order defined by `scripts/test-env/replay-chain.sh`.

## Contents

17 files: W-0001 … W-0017

- W-0001…W-0004: Core schema (branches, inventory, products, client_addresses)
- W-0005: Financial core (financial_accounts, financial_journal_entries, etc.)
- W-0006…W-0014: Extensions (invoices, driver_commissions, payments, etc.)
- **W-0015, W-0016**: Divergent duplicate filenames (not replayed)
- **W-0017**: Never replayed

## Interleaving Order (defined ONLY in replay-chain.sh)

```
R-0001 … R-0008
W-0001 … W-0004
R-0009
W-0005
R-0010 … R-0014
W-0006 … W-0014
R-0015, R-0016
R-0017 … R-0034
```

Only W-0001 through W-0014 are actually applied. W-0015/0016/0017 are retained
for historical reference but excluded from the active chain.

## Critical Defects in This Fragment

The following files contain **pre-fix bodies** that were corrected by root
`0024_fix_posted_journal_posting.sql`. This fragment must **never be applied
after root 0024**:

| File | Defective Functions |
|------|---------------------|
| `0008_financial_audit_immutability.sql` | `prevent_posted_journal_line_mutation`, `prevent_posted_journal_mutation` |
| `0010_financial_simple_entries.sql` | `post_financial_journal_entry(uuid)` |

## Rebuild Local Scratch Database

```bash
# From repository root:
scripts/test-env/replay-chain.sh 0034
```

**Do not** run `supabase db push` against this directory alone.

## See Also

- Authoritative chain: `supabase/migrations/README.md`
- Full documentation: `docs/opencode/MIGRATION-CHAIN-AUTHORITY.md`

NO PRODUCTION MIGRATIONS APPLIED