-- ═══ P1.1A · ACCOUNTING FOUNDATION · UP ═══
BEGIN;

CREATE TABLE IF NOT EXISTS legal_entities (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     code VARCHAR(20) NOT NULL,
     name VARCHAR(200) NOT NULL,
     name_ar VARCHAR(200),
     functional_currency VARCHAR(3) NOT NULL,
     fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1,
     accounting_start_date DATE NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

CREATE TABLE IF NOT EXISTS cost_centers (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     code VARCHAR(20) NOT NULL,
     name VARCHAR(200) NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

CREATE TABLE IF NOT EXISTS accounting_accounts (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     code VARCHAR(20) NOT NULL,
     name VARCHAR(200) NOT NULL,
     name_ar VARCHAR(200),
     account_type VARCHAR(20) NOT NULL,
     account_group VARCHAR(60),
     system_role VARCHAR(40),
     normal_balance VARCHAR(6) NOT NULL,
     parent_id UUID,
     level SMALLINT NOT NULL DEFAULT 1,
     is_postable BOOLEAN NOT NULL DEFAULT true,
     is_monetary BOOLEAN NOT NULL DEFAULT false,
     is_related_party BOOLEAN NOT NULL DEFAULT false,
     requires_subledger BOOLEAN NOT NULL DEFAULT false,
     currency_restriction VARCHAR(3),
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

CREATE TABLE IF NOT EXISTS journals (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     code VARCHAR(10) NOT NULL,
     name VARCHAR(100) NOT NULL,
     entry_prefix VARCHAR(10) NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

CREATE TABLE IF NOT EXISTS fiscal_years (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     year SMALLINT NOT NULL,
     start_date DATE NOT NULL,
     end_date DATE NOT NULL,
     status VARCHAR(15) NOT NULL DEFAULT 'open',
     next_entry_no INTEGER NOT NULL DEFAULT 1,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

CREATE TABLE IF NOT EXISTS fiscal_periods (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     fiscal_year_id UUID NOT NULL,
     period_no SMALLINT NOT NULL,
     name VARCHAR(30) NOT NULL,
     start_date DATE NOT NULL,
     end_date DATE NOT NULL,
     status VARCHAR(15) NOT NULL DEFAULT 'open',
     closed_by UUID, closed_at TIMESTAMPTZ, close_reason VARCHAR(500),
     reopened_by UUID, reopened_at TIMESTAMPTZ, reopen_reason VARCHAR(500),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

CREATE TABLE IF NOT EXISTS accounting_fx_rates (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     currency_from VARCHAR(3) NOT NULL,
     currency_to VARCHAR(3) NOT NULL,
     rate NUMERIC(18,8) NOT NULL,
     rate_date DATE NOT NULL,
     source VARCHAR(20) NOT NULL,
     source_reference VARCHAR(200),
     created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     approved_by UUID, approved_at TIMESTAMPTZ
   );

CREATE TABLE IF NOT EXISTS journal_entries (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     journal_id UUID NOT NULL,
     fiscal_year_id UUID NOT NULL,
     fiscal_period_id UUID NOT NULL,
     entry_no VARCHAR(30),
     status VARCHAR(15) NOT NULL DEFAULT 'draft',
     accounting_event_type VARCHAR(30) NOT NULL DEFAULT 'manual',
     source_document_date DATE NOT NULL,
     accounting_date DATE NOT NULL,
     description VARCHAR(500) NOT NULL,
     reference VARCHAR(200),
     source_type VARCHAR(30),
     source_id UUID,
     source_reference VARCHAR(200),
     is_backdated BOOLEAN NOT NULL DEFAULT false,
     backdated_reason VARCHAR(500),
     reversal_of_entry_id UUID,
     reversed_by_entry_id UUID,
     total_debit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     total_credit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     reviewed_by UUID, reviewed_at TIMESTAMPTZ,
     posted_by UUID, posted_at TIMESTAMPTZ,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

CREATE TABLE IF NOT EXISTS journal_lines (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     entry_id UUID NOT NULL,
     line_no SMALLINT NOT NULL,
     account_id UUID NOT NULL,
     debit NUMERIC(18,2) NOT NULL DEFAULT 0,
     credit NUMERIC(18,2) NOT NULL DEFAULT 0,
     transaction_currency VARCHAR(3) NOT NULL,
     fx_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
     fx_date DATE NOT NULL,
     fx_source VARCHAR(20) NOT NULL,
     fx_rate_id UUID,
     debit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     credit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     vessel_id UUID,
     supplier_id UUID,
     customer_id UUID,
     cost_center_id UUID,
     description VARCHAR(500),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

DO $$ BEGIN
  ALTER TABLE accounting_accounts ADD CONSTRAINT chk_acct_type CHECK (account_type IN ('asset','liability','equity','revenue','expense'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_accounts ADD CONSTRAINT chk_acct_normal_balance CHECK (normal_balance IN ('debit','credit'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE fiscal_periods ADD CONSTRAINT chk_period_status CHECK (status IN ('open','soft_closed','hard_closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE fiscal_periods ADD CONSTRAINT chk_period_no CHECK (period_no BETWEEN 0 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE fiscal_periods ADD CONSTRAINT chk_period_dates CHECK (end_date >= start_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT chk_je_status CHECK (status IN ('draft','posted','reversed','void'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT chk_je_event_type CHECK (accounting_event_type IN ('manual','opening_balance','invoice_accrual','payment_settlement','reversal','adjustment','depreciation','fx_revaluation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT chk_je_posted_has_no CHECK (status <> 'posted' OR entry_no IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT chk_je_posted_balanced CHECK (status <> 'posted' OR total_debit_eur = total_credit_eur);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT chk_je_backdate_reason CHECK (is_backdated = false OR backdated_reason IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_nonneg CHECK (debit >= 0 AND credit >= 0 AND debit_eur >= 0 AND credit_eur >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_one_side CHECK ((debit > 0) <> (credit > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_eur_side CHECK ((debit_eur > 0) = (debit > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_fx_positive CHECK (fx_rate > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_eur_rate_is_one CHECK (transaction_currency <> 'EUR' OR fx_rate = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_fx_source CHECK (fx_source IN ('FUNCTIONAL','ECB','BANK','MANUAL_APPROVED','OTHER_APPROVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_foreign_needs_fx CHECK ((transaction_currency = 'EUR') = (fx_source = 'FUNCTIONAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_rate_positive CHECK (rate > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_source CHECK (source IN ('ECB','BANK','MANUAL_APPROVED','OTHER_APPROVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_manual_approved CHECK (source <> 'MANUAL_APPROVED' OR approved_by IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cost_centers ADD CONSTRAINT fk_cc_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_accounts ADD CONSTRAINT fk_acct_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_accounts ADD CONSTRAINT fk_acct_parent FOREIGN KEY (parent_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journals ADD CONSTRAINT fk_journal_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE fiscal_years ADD CONSTRAINT fk_fy_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE fiscal_periods ADD CONSTRAINT fk_period_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE fiscal_periods ADD CONSTRAINT fk_period_fiscal_year FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accounting_fx_rates ADD CONSTRAINT fk_fx_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT fk_je_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT fk_je_journal FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT fk_je_fiscal_year FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT fk_je_period FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT fk_je_reversal_of FOREIGN KEY (reversal_of_entry_id) REFERENCES journal_entries(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_entries ADD CONSTRAINT fk_je_reversed_by FOREIGN KEY (reversed_by_entry_id) REFERENCES journal_entries(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT fk_jl_entry FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT fk_jl_account FOREIGN KEY (account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT fk_jl_fx_rate FOREIGN KEY (fx_rate_id) REFERENCES accounting_fx_rates(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE journal_lines ADD CONSTRAINT fk_jl_cost_center FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_entity_code ON legal_entities (code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_entity_code ON accounting_accounts (legal_entity_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_entity_system_role ON accounting_accounts (legal_entity_id, system_role) WHERE system_role IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entity_code ON journals (legal_entity_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fy_entity_year ON fiscal_years (legal_entity_id, year);

CREATE UNIQUE INDEX IF NOT EXISTS uq_period_fy_no ON fiscal_periods (fiscal_year_id, period_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_je_entity_fy_entry_no ON journal_entries (legal_entity_id, fiscal_year_id, entry_no) WHERE entry_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_je_accounting_event ON journal_entries (legal_entity_id, accounting_event_type, source_type, source_id) WHERE source_id IS NOT NULL AND status <> 'void';

CREATE UNIQUE INDEX IF NOT EXISTS uq_jl_entry_line ON journal_lines (entry_id, line_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_rate_lookup ON accounting_fx_rates (legal_entity_id, currency_from, currency_to, rate_date, source);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_entity_code ON cost_centers (legal_entity_id, code);

CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines (account_id, entry_id);

CREATE INDEX IF NOT EXISTS idx_je_period_status ON journal_entries (legal_entity_id, fiscal_period_id, status);

CREATE INDEX IF NOT EXISTS idx_je_source ON journal_entries (source_type, source_id) WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_je_backdated ON journal_entries (legal_entity_id, is_backdated) WHERE is_backdated;

CREATE INDEX IF NOT EXISTS idx_jl_vessel ON journal_lines (vessel_id) WHERE vessel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jl_supplier ON journal_lines (supplier_id) WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fx_lookup ON accounting_fx_rates (legal_entity_id, currency_from, rate_date DESC);

CREATE OR REPLACE FUNCTION accounting_je_immutable() RETURNS TRIGGER AS $$
   BEGIN
     IF (TG_OP = 'DELETE') THEN
       IF OLD.status IN ('posted','reversed') THEN
         RAISE EXCEPTION 'لا يجوز حذف قيد مُرحَّل (%). التصحيح يكون بقيد عكسي.', OLD.entry_no;
       END IF;
       RETURN OLD;
     END IF;

     IF OLD.status IN ('posted','reversed') THEN
       IF OLD.status = 'posted' AND NEW.status = 'reversed'
          AND OLD.reversed_by_entry_id IS NULL
          AND NEW.reversed_by_entry_id IS NOT NULL
          AND (to_jsonb(NEW) - 'status' - 'reversed_by_entry_id' - 'updated_at')
            = (to_jsonb(OLD) - 'status' - 'reversed_by_entry_id' - 'updated_at')
       THEN
         RETURN NEW;
       END IF;
       RAISE EXCEPTION 'قيد مُرحَّل (%) لا يقبل أي تعديل عدا توسيمه بالعكس.', OLD.entry_no;
     END IF;

     RETURN NEW;
   END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_immutable ON journal_entries;

CREATE TRIGGER trg_je_immutable BEFORE UPDATE OR DELETE ON journal_entries
     FOR EACH ROW EXECUTE FUNCTION accounting_je_immutable();

CREATE OR REPLACE FUNCTION accounting_jl_immutable() RETURNS TRIGGER AS $$
   DECLARE st VARCHAR(15); eid UUID;
   BEGIN
     IF (TG_OP = 'DELETE') THEN eid := OLD.entry_id; ELSE eid := NEW.entry_id; END IF;
     SELECT status INTO st FROM journal_entries WHERE id = eid;
     IF st IN ('posted','reversed') THEN
       RAISE EXCEPTION 'لا يجوز المساس بأسطر قيد مُرحَّل.';
     END IF;
     IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
   END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jl_immutable ON journal_lines;

CREATE TRIGGER trg_jl_immutable BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
     FOR EACH ROW EXECUTE FUNCTION accounting_jl_immutable();

CREATE OR REPLACE FUNCTION accounting_je_assert_balanced() RETURNS TRIGGER AS $$
   DECLARE st VARCHAR(15); hd NUMERIC(18,2); hc NUMERIC(18,2);
           ld NUMERIC(18,2); lc NUMERIC(18,2); ln INT;
   BEGIN
     SELECT status, total_debit_eur, total_credit_eur INTO st, hd, hc
       FROM journal_entries WHERE id = NEW.id;
     IF NOT FOUND THEN RETURN NULL; END IF;
     IF st NOT IN ('posted','reversed') THEN RETURN NULL; END IF;

     SELECT COUNT(*), COALESCE(SUM(debit_eur),0), COALESCE(SUM(credit_eur),0)
       INTO ln, ld, lc FROM journal_lines WHERE entry_id = NEW.id;

     IF ln < 2 THEN
       RAISE EXCEPTION 'قيد مُرحَّل بأقل من سطرين (%).', NEW.entry_no;
     END IF;
     IF ld <> lc THEN
       RAISE EXCEPTION 'قيد مُرحَّل غير متوازن (%): مدين % · دائن %.', NEW.entry_no, ld, lc;
     END IF;
     IF ld <> hd OR lc <> hc THEN
       RAISE EXCEPTION 'إجماليات رأس القيد (%) لا تطابق مجموع أسطره: رأس %/% · أسطر %/%.',
         NEW.entry_no, hd, hc, ld, lc;
     END IF;
     RETURN NULL;
   END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_balanced_deferred ON journal_entries;

CREATE CONSTRAINT TRIGGER trg_je_balanced_deferred
     AFTER INSERT OR UPDATE ON journal_entries
     DEFERRABLE INITIALLY DEFERRED
     FOR EACH ROW EXECUTE FUNCTION accounting_je_assert_balanced();

CREATE OR REPLACE FUNCTION accounting_je_period_guard() RETURNS TRIGGER AS $$
   DECLARE ps VARCHAR(15);
   BEGIN
     IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
     IF (TG_OP = 'UPDATE' AND OLD.status = 'posted') THEN RETURN NEW; END IF;

     SELECT status INTO ps FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
     IF ps = 'hard_closed' THEN
       RAISE EXCEPTION 'الفترة مُقفلة نهائياً — لا ترحيل فيها. التصحيح بقيد في فترة لاحقة.';
     END IF;
     IF ps = 'soft_closed' AND NEW.accounting_event_type NOT IN ('adjustment','reversal') THEN
       RAISE EXCEPTION 'الفترة مُقفلة مبدئياً — لا يُقبل فيها إلا قيد تسوية أو عكس.';
     END IF;
     RETURN NEW;
   END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_period_guard ON journal_entries;

CREATE TRIGGER trg_je_period_guard BEFORE INSERT OR UPDATE ON journal_entries
     FOR EACH ROW EXECUTE FUNCTION accounting_je_period_guard();

DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legal_entities','cost_centers','accounting_accounts','journals','fiscal_years','fiscal_periods','accounting_fx_rates','journal_entries','journal_lines'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE journals ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting_fx_rates ENABLE ROW LEVEL SECURITY;

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

COMMIT;
