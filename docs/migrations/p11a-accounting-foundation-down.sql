-- ═══ P1.1A · ACCOUNTING FOUNDATION · DOWN (تراجع) ═══
BEGIN;

DROP TRIGGER IF EXISTS trg_je_period_guard ON journal_entries;

DROP TRIGGER IF EXISTS trg_je_balanced_deferred ON journal_entries;

DROP TRIGGER IF EXISTS trg_jl_immutable ON journal_lines;

DROP TRIGGER IF EXISTS trg_je_immutable ON journal_entries;

DROP FUNCTION IF EXISTS accounting_je_period_guard();

DROP FUNCTION IF EXISTS accounting_je_assert_balanced();

DROP FUNCTION IF EXISTS accounting_jl_immutable();

DROP FUNCTION IF EXISTS accounting_je_immutable();

DROP TABLE IF EXISTS journal_lines;

DROP TABLE IF EXISTS journal_entries;

DROP TABLE IF EXISTS accounting_fx_rates;

DROP TABLE IF EXISTS fiscal_periods;

DROP TABLE IF EXISTS fiscal_years;

DROP TABLE IF EXISTS journals;

DROP TABLE IF EXISTS accounting_accounts;

DROP TABLE IF EXISTS cost_centers;

DROP TABLE IF EXISTS legal_entities;

COMMIT;
