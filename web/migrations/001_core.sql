-- siryous AMS core schema. Process IDs in comments refer to docs/AMS-Process-Catalog.md.

-- ───────────────────────── Organization and users (CRM-33, ADM-01, ADM-02)
CREATE TABLE branches (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  city        text,
  state       text
);

CREATE TABLE users (
  id                     serial PRIMARY KEY,
  username               text NOT NULL UNIQUE,            -- the sign-in name (BASIC_AUTH_USERS holds the passwords)
  full_name              text NOT NULL,
  email                  text NOT NULL UNIQUE,
  title                  text,
  role                   text NOT NULL CHECK (role IN ('admin','principal','account_manager','csr','producer','accounting')),
  branch_id              int REFERENCES branches(id),
  phone                  text,
  inbox_alias            text NOT NULL UNIQUE,            -- forwarding address local part: <alias>@INBOUND_EMAIL_DOMAIN
  can_view_pii           boolean NOT NULL DEFAULT false,
  commission_new_pct     numeric(5,2) NOT NULL DEFAULT 0, -- producer split of agency commission, new business (COM-02)
  commission_renewal_pct numeric(5,2) NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,
  color                  text NOT NULL DEFAULT '#6366f1',
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_active_at         timestamptz
);

CREATE TABLE licenses (                                     -- CMP-01 Lite
  id             serial PRIMARY KEY,
  user_id        int NOT NULL REFERENCES users(id),
  state          text NOT NULL,
  license_number text NOT NULL,
  lines          text NOT NULL DEFAULT 'Property & Casualty',
  expires_on     date NOT NULL
);

-- Every sign-in attempt (same shape as the Underwriting Desktop sign-in log).
CREATE TABLE login_events (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  username        text NOT NULL,
  success         boolean NOT NULL,
  method          text NOT NULL DEFAULT 'signin',
  ip              text,
  user_agent      text,
  accept_language text,
  edge_region     text,
  geo             jsonb,
  geo_source      text
);
CREATE INDEX login_events_time ON login_events (occurred_at DESC);
CREATE INDEX login_events_user ON login_events (username, occurred_at DESC);

-- Append-only audit trail (ADM-04).
CREATE TABLE audit_events (
  id             bigserial PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor          text NOT NULL,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text NOT NULL,
  summary        text NOT NULL DEFAULT '',
  before         jsonb,
  after          jsonb,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE INDEX audit_events_entity ON audit_events (entity_type, entity_id, id);
CREATE INDEX audit_events_actor ON audit_events (actor, occurred_at DESC);
CREATE INDEX audit_events_time ON audit_events (occurred_at DESC);

-- ───────────────────────── Markets and parties (CRM-05, 06, 08, 09, 10)
CREATE TABLE carriers (
  id                     serial PRIMARY KEY,
  code                   text NOT NULL UNIQUE,
  name                   text NOT NULL,
  kind                   text NOT NULL DEFAULT 'carrier' CHECK (kind IN ('carrier','wholesaler','mga')),
  naic                   text,
  am_best                text,
  admitted               boolean NOT NULL DEFAULT true,
  bill_modes             text NOT NULL DEFAULT 'direct' CHECK (bill_modes IN ('direct','agency','both')),
  lines                  text[] NOT NULL DEFAULT '{}',
  phone                  text,
  email                  text,
  underwriting_email     text,
  portal_url             text,
  commission_new_pct     numeric(5,2) NOT NULL DEFAULT 12,
  commission_renewal_pct numeric(5,2) NOT NULL DEFAULT 12,
  active                 boolean NOT NULL DEFAULT true
);

CREATE TABLE finance_companies (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  phone text,
  email text
);

CREATE TABLE vendors (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  kind  text NOT NULL DEFAULT 'service',
  email text,
  phone text
);

CREATE TABLE other_interests (                              -- certificate holders, mortgagees, loss payees
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'certificate_holder'
             CHECK (kind IN ('certificate_holder','mortgagee','loss_payee','additional_insured','lienholder')),
  attention  text,
  address1   text,
  city       text,
  state      text,
  zip        text,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Clients and contacts (CRM-01..38)
CREATE TABLE clients (
  id                 serial PRIMARY KEY,
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('individual','business')),
  status             text NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','insured','inactive')),
  dba                text,
  industry           text,
  naics              text,
  annual_revenue     numeric(14,2),
  employees          int,
  years_in_business  int,
  website            text,
  email              text,
  phone              text,
  address1           text,
  address2           text,
  city               text,
  state              text,
  zip                text,
  branch_id          int REFERENCES branches(id),
  source             text,
  producer_id        int REFERENCES users(id),
  account_manager_id int REFERENCES users(id),
  csr_id             int REFERENCES users(id),
  household          text,
  tags               text[] NOT NULL DEFAULT '{}',
  dob                date,                                -- PII
  drivers_license    text,                                -- PII
  fein               text,                                -- PII
  preferred_channel  text NOT NULL DEFAULT 'email' CHECK (preferred_channel IN ('email','phone','sms','mail')),
  do_not_call        boolean NOT NULL DEFAULT false,
  email_opt_out      boolean NOT NULL DEFAULT false,
  sms_consent_at     timestamptz,                         -- CMP-17
  client_since       date,
  inactive_reason    text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_am ON clients (account_manager_id);
CREATE INDEX clients_name ON clients (lower(name));

CREATE TABLE contacts (
  id                serial PRIMARY KEY,
  client_id         int REFERENCES clients(id) ON DELETE CASCADE,
  carrier_id        int REFERENCES carriers(id) ON DELETE CASCADE,
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  title             text,
  email             text,
  phone             text,
  mobile            text,
  is_primary        boolean NOT NULL DEFAULT false,
  is_billing        boolean NOT NULL DEFAULT false,
  dob               date,                                 -- PII
  license_number    text,                                 -- PII
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_client ON contacts (client_id);
CREATE INDEX contacts_email ON contacts (lower(email));

CREATE TABLE insured_items (                                -- CRM-19 schedules: vehicles, drivers, locations, dwellings, classes
  id         serial PRIMARY KEY,
  client_id  int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('vehicle','driver','location','dwelling','class_code','watercraft','equipment')),
  label      text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX insured_items_client ON insured_items (client_id);

-- ───────────────────────── Sales (SAL-08..12, PLC-29..41)
CREATE TABLE opportunities (
  id            serial PRIMARY KEY,
  client_id     int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'new' CHECK (kind IN ('new','cross_sell','remarket')),
  lines         text[] NOT NULL DEFAULT '{}',
  stage         text NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','qualifying','submitted','quoted','proposal','won','lost')),
  est_premium   numeric(12,2),
  owner_id      int REFERENCES users(id),
  target_date   date,
  source        text,
  lost_reason   text,
  won_policy_id int,
  notes         text,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE submissions (
  id                 serial PRIMARY KEY,
  opportunity_id     int NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  carrier_id         int NOT NULL REFERENCES carriers(id),
  status             text NOT NULL DEFAULT 'preparing'
                     CHECK (status IN ('preparing','submitted','waiting_on_carrier','waiting_on_client','quoted','declined','bound','closed')),
  submitted_at       timestamptz,
  responded_at       timestamptz,
  quoted_premium     numeric(12,2),
  commission_pct     numeric(5,2),
  declination_reason text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Policies (POL-01..78)
CREATE TABLE policies (
  id                  serial PRIMARY KEY,
  client_id           int NOT NULL REFERENCES clients(id),
  policy_number       text NOT NULL,
  carrier_id          int NOT NULL REFERENCES carriers(id),
  wholesaler_id       int REFERENCES carriers(id),
  lob                 text NOT NULL,                       -- primary line code (PA, HO, BOP, GL, WC ...)
  business_type       text NOT NULL CHECK (business_type IN ('personal','commercial')),
  description         text,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('quote','bound','active','pending_cancel','cancelled','non_renewed','lost','expired')),
  effective_date      date NOT NULL,
  expiration_date     date NOT NULL,
  term_months         int NOT NULL DEFAULT 12,
  bill_mode           text NOT NULL DEFAULT 'direct' CHECK (bill_mode IN ('direct','agency')),
  premium             numeric(12,2) NOT NULL DEFAULT 0,
  fees                numeric(12,2) NOT NULL DEFAULT 0,
  taxes               numeric(12,2) NOT NULL DEFAULT 0,
  commission_pct      numeric(5,2) NOT NULL DEFAULT 12,
  is_admitted         boolean NOT NULL DEFAULT true,
  payment_plan        text NOT NULL DEFAULT 'annual',
  finance_company_id  int REFERENCES finance_companies(id),
  delivery_method     text NOT NULL DEFAULT 'email',
  new_renewal         text NOT NULL DEFAULT 'new' CHECK (new_renewal IN ('new','renewal','rewrite')),
  prior_policy_id     int REFERENCES policies(id),
  renewal_policy_id   int REFERENCES policies(id),
  producer_id         int REFERENCES users(id),
  account_manager_id  int REFERENCES users(id),
  renewal_stage       text NOT NULL DEFAULT 'not_started'
                      CHECK (renewal_stage IN ('not_started','in_review','remarketing','quoted','presented','renewed','lost','non_renewed')),
  renewal_owner_id    int REFERENCES users(id),
  remarket_reason     text,
  cancel_date         date,
  cancel_reason       text,
  cancel_method       text,
  return_premium      numeric(12,2),
  binder_number       text,
  binder_expires      date,
  issued_at           timestamptz,                        -- carrier policy received and checked (POL-19)
  policy_checked_at   timestamptz,                        -- POL-20
  opportunity_id      int REFERENCES opportunities(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX policies_client ON policies (client_id);
CREATE INDEX policies_exp ON policies (expiration_date);
CREATE INDEX policies_number ON policies (lower(policy_number));

CREATE TABLE policy_lines (
  id         serial PRIMARY KEY,
  policy_id  int NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  lob        text NOT NULL,
  premium    numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE coverages (
  id              serial PRIMARY KEY,
  policy_id       int NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  lob             text NOT NULL,
  code            text NOT NULL,
  description     text NOT NULL,
  limit_text      text,
  deductible_text text,
  premium         numeric(12,2)
);
CREATE INDEX coverages_policy ON coverages (policy_id);

CREATE TABLE policy_items (
  policy_id int NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  item_id   int NOT NULL REFERENCES insured_items(id) ON DELETE CASCADE,
  PRIMARY KEY (policy_id, item_id)
);

CREATE TABLE policy_forms (
  id          serial PRIMARY KEY,
  policy_id   int NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  form_number text NOT NULL,
  edition     text,
  description text
);

CREATE TABLE additional_interests (                          -- POL-33
  id          serial PRIMARY KEY,
  policy_id   int NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  interest_id int NOT NULL REFERENCES other_interests(id),
  role        text NOT NULL,
  loan_number text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_transactions (                           -- POL-04 lineage
  id             serial PRIMARY KEY,
  policy_id      int NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('new','renewal','endorsement','cancellation','reinstatement','audit','rewrite','non_renewal')),
  status         text NOT NULL DEFAULT 'issued' CHECK (status IN ('pending','issued','not_issued')),
  effective_date date NOT NULL,
  description    text NOT NULL,
  premium_change numeric(12,2) NOT NULL DEFAULT 0,
  created_by_id  int REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  issued_at      timestamptz
);
CREATE INDEX policy_transactions_policy ON policy_transactions (policy_id);

-- ───────────────────────── Claims (CLM-01..11)
CREATE TABLE claims (
  id                   serial PRIMARY KEY,
  claim_number         text NOT NULL UNIQUE,
  client_id            int NOT NULL REFERENCES clients(id),
  policy_id            int REFERENCES policies(id),
  carrier_claim_number text,
  loss_date            date NOT NULL,
  reported_date        date NOT NULL,
  kind                 text NOT NULL,
  description          text NOT NULL,
  location             text,
  claimant             text,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  adjuster_name        text,
  adjuster_phone       text,
  adjuster_email       text,
  submitted_to_carrier_at timestamptz,
  closed_at            timestamptz,
  created_by_id        int REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Certificates (CRT-01..17)
CREATE TABLE certificates (
  id                         serial PRIMARY KEY,
  cert_number                text NOT NULL UNIQUE,
  client_id                  int NOT NULL REFERENCES clients(id),
  holder_id                  int REFERENCES other_interests(id),
  is_master                  boolean NOT NULL DEFAULT false,
  status                     text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','superseded','revoked')),
  description_of_operations  text,
  additional_insured         boolean NOT NULL DEFAULT false,
  waiver_of_subrogation      boolean NOT NULL DEFAULT false,
  primary_noncontributory    boolean NOT NULL DEFAULT false,
  issued_at                  timestamptz,
  issued_by_id               int REFERENCES users(id),
  delivered_to               text,
  delivered_at               timestamptz,
  renewed_from_id            int REFERENCES certificates(id),
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX certificates_client ON certificates (client_id);

CREATE TABLE certificate_policies (
  certificate_id int NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  policy_id      int NOT NULL REFERENCES policies(id),
  PRIMARY KEY (certificate_id, policy_id)
);

-- ───────────────────────── Email intake (WRK-20, WRK-21)
CREATE TABLE emails (
  id                   serial PRIMARY KEY,
  message_id           text UNIQUE,
  direction            text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  from_addr            text NOT NULL,
  from_name            text,
  original_from_addr   text,                              -- the client's address inside a forwarded message
  original_from_name   text,
  to_addrs             text[] NOT NULL DEFAULT '{}',
  cc_addrs             text[] NOT NULL DEFAULT '{}',
  subject              text NOT NULL DEFAULT '',
  body_text            text NOT NULL DEFAULT '',
  body_html            text,
  received_at          timestamptz NOT NULL DEFAULT now(),
  routed_user_id       int REFERENCES users(id),
  forwarded_by_user_id int REFERENCES users(id),
  client_id            int REFERENCES clients(id),
  policy_id            int REFERENCES policies(id),
  match_method         text,
  match_confidence     numeric(3,2),
  status               text NOT NULL DEFAULT 'new' CHECK (status IN ('new','actioned','linked','ignored')),
  classification       jsonb,
  classified_by        text,                              -- 'ai' | 'rules'
  activity_id          int,
  source               text NOT NULL DEFAULT 'webhook',   -- webhook | simulator | seed | outbound
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emails_status ON emails (status, received_at DESC);
CREATE INDEX emails_client ON emails (client_id);

-- ───────────────────────── Work (WRK-01..14)
CREATE TABLE activity_codes (
  code             text PRIMARY KEY,
  label            text NOT NULL,
  category         text NOT NULL,
  default_priority text NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('urgent','high','normal','low')),
  default_due_days int NOT NULL DEFAULT 2,
  sla_hours        int,
  checklist        text[] NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true
);

CREATE TABLE activities (
  id              serial PRIMARY KEY,
  code            text NOT NULL REFERENCES activity_codes(code),
  subject         text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','done','cancelled')),
  priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  owner_id        int REFERENCES users(id),
  created_by_id   int REFERENCES users(id),
  client_id       int REFERENCES clients(id),
  policy_id       int REFERENCES policies(id),
  claim_id        int REFERENCES claims(id),
  certificate_id  int REFERENCES certificates(id),
  opportunity_id  int REFERENCES opportunities(id),
  email_id        int REFERENCES emails(id),
  due_date        date NOT NULL DEFAULT current_date,
  snoozed_until   date,
  waiting_on      text CHECK (waiting_on IN ('client','carrier','internal','other')),
  follow_up_date  date,
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','email','system','automation','lead')),
  checklist       jsonb NOT NULL DEFAULT '[]',
  outcome         text,
  completed_at    timestamptz,
  completed_by_id int REFERENCES users(id),
  auto_key        text UNIQUE,                            -- idempotency key for automation-created work
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_owner_open ON activities (owner_id, status, due_date);
CREATE INDEX activities_client ON activities (client_id, created_at DESC);
CREATE INDEX activities_policy ON activities (policy_id);
CREATE INDEX activities_completed ON activities (completed_at);
ALTER TABLE emails ADD CONSTRAINT emails_activity_fk FOREIGN KEY (activity_id) REFERENCES activities(id);

CREATE TABLE activity_notes (
  id           serial PRIMARY KEY,
  activity_id  int REFERENCES activities(id) ON DELETE CASCADE,
  client_id    int REFERENCES clients(id),
  author_id    int REFERENCES users(id),
  kind         text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','call','email_out','system')),
  body         text NOT NULL,
  confidential boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_notes_activity ON activity_notes (activity_id);
CREATE INDEX activity_notes_client ON activity_notes (client_id, created_at DESC);

-- ───────────────────────── Documents (DOC-01..13)
CREATE TABLE files (
  id         serial PRIMARY KEY,
  sha256     text NOT NULL,
  mime       text NOT NULL,
  size       int NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id             serial PRIMARY KEY,
  client_id      int REFERENCES clients(id),
  policy_id      int REFERENCES policies(id),
  claim_id       int REFERENCES claims(id),
  activity_id    int REFERENCES activities(id),
  email_id       int REFERENCES emails(id),
  certificate_id int REFERENCES certificates(id),
  folder         text NOT NULL DEFAULT 'Correspondence',
  title          text NOT NULL,
  filename       text NOT NULL,
  mime           text NOT NULL DEFAULT 'application/pdf',
  size           int NOT NULL DEFAULT 0,
  file_id        int REFERENCES files(id),
  generated_kind text,                                    -- dec_page | certificate | invoice | id_card | ... rendered on demand
  ref_id         int,                                     -- the record a generated document renders (e.g. invoice id)
  restricted     boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  uploaded_by_id int REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_client ON documents (client_id, created_at DESC);
CREATE INDEX documents_policy ON documents (policy_id);

-- ───────────────────────── Accounting (BIL, CSH, GL, COM, TAX)
CREATE TABLE tax_rates (
  id             serial PRIMARY KEY,
  state          text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('surplus_lines_tax','stamping_fee')),
  rate_pct       numeric(6,4) NOT NULL,
  effective_from date NOT NULL DEFAULT '2026-01-01'
);

CREATE TABLE invoices (
  id             serial PRIMARY KEY,
  invoice_number text NOT NULL UNIQUE,
  client_id      int NOT NULL REFERENCES clients(id),
  policy_id      int REFERENCES policies(id),
  transaction_id int REFERENCES policy_transactions(id),
  issue_date     date NOT NULL,
  due_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','void')),
  total          numeric(12,2) NOT NULL DEFAULT 0,
  memo           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_client ON invoices (client_id);

CREATE TABLE invoice_lines (
  id                serial PRIMARY KEY,
  invoice_id        int NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('premium','return_premium','policy_fee','agency_fee','broker_fee','surplus_lines_tax','stamping_fee')),
  description       text NOT NULL,
  amount            numeric(12,2) NOT NULL,
  commission_pct    numeric(5,2) NOT NULL DEFAULT 0,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  payable_amount    numeric(12,2) NOT NULL DEFAULT 0,     -- owed to the carrier / wholesaler / state
  payable_to        text,                                 -- carrier | agency | state
  carrier_id        int REFERENCES carriers(id),
  carrier_statement_id int
);

CREATE TABLE receipts (
  id              serial PRIMARY KEY,
  receipt_number  text NOT NULL UNIQUE,
  client_id       int REFERENCES clients(id),
  received_date   date NOT NULL,
  amount          numeric(12,2) NOT NULL,
  method          text NOT NULL CHECK (method IN ('check','ach','card','cash','wire')),
  reference       text,
  bank_account    text NOT NULL DEFAULT 'trust' CHECK (bank_account IN ('trust','operating')),
  status          text NOT NULL DEFAULT 'finalized' CHECK (status IN ('finalized','reversed')),
  deposited       boolean NOT NULL DEFAULT true,
  memo            text,
  reversed_reason text,
  created_by_id   int REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipt_applications (
  id         serial PRIMARY KEY,
  receipt_id int NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  invoice_id int NOT NULL REFERENCES invoices(id),
  amount     numeric(12,2) NOT NULL
);

CREATE TABLE carrier_statements (                            -- GL-04 pay by statement
  id             serial PRIMARY KEY,
  carrier_id     int NOT NULL REFERENCES carriers(id),
  statement_date date NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid')),
  total          numeric(12,2) NOT NULL DEFAULT 0,
  paid_date      date,
  reference      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_stmt_fk FOREIGN KEY (carrier_statement_id) REFERENCES carrier_statements(id);

CREATE TABLE commission_statements (                         -- COM-11..21
  id               serial PRIMARY KEY,
  carrier_id       int NOT NULL REFERENCES carriers(id),
  statement_date   date NOT NULL,
  period           text NOT NULL,
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','ai','download')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  statement_total  numeric(12,2) NOT NULL DEFAULT 0,
  deposit_amount   numeric(12,2),
  deposit_date     date,
  notes            text,
  created_by_id    int REFERENCES users(id),
  posted_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commission_lines (
  id                  serial PRIMARY KEY,
  statement_id        int NOT NULL REFERENCES commission_statements(id) ON DELETE CASCADE,
  policy_number       text NOT NULL,
  insured_name        text,
  effective_date      date,
  transaction_kind    text NOT NULL DEFAULT 'new',
  premium             numeric(12,2) NOT NULL DEFAULT 0,
  rate_pct            numeric(5,2),
  commission          numeric(12,2) NOT NULL DEFAULT 0,
  policy_id           int REFERENCES policies(id),
  expected_commission numeric(12,2),
  match_status        text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('matched','variance','unmatched','closed')),
  note                text
);
CREATE INDEX commission_lines_policy ON commission_lines (policy_id);

CREATE TABLE producer_statements (                           -- COM-23
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id),
  period     text NOT NULL,
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid')),
  total      numeric(12,2) NOT NULL DEFAULT 0,
  paid_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period)
);

CREATE TABLE producer_statement_lines (
  id                 serial PRIMARY KEY,
  statement_id       int NOT NULL REFERENCES producer_statements(id) ON DELETE CASCADE,
  policy_id          int REFERENCES policies(id),
  commission_line_id int REFERENCES commission_lines(id),
  kind               text NOT NULL CHECK (kind IN ('new','renewal','chargeback')),
  agency_commission  numeric(12,2) NOT NULL,
  split_pct          numeric(5,2) NOT NULL,
  amount             numeric(12,2) NOT NULL
);

-- Double-entry insurance sub-ledger: trust account, receivables, payables, commission income. GL-17 exports it.
CREATE TABLE ledger_entries (
  id             bigserial PRIMARY KEY,
  entry_date     date NOT NULL,
  journal        text NOT NULL,                           -- groups the lines of one posting
  account        text NOT NULL CHECK (account IN (
                   'trust_cash','operating_cash','premium_receivable','carrier_payable','commission_income',
                   'commission_receivable','producer_payable','producer_expense','tax_payable','fee_income','refunds_payable')),
  debit          numeric(12,2) NOT NULL DEFAULT 0,
  credit         numeric(12,2) NOT NULL DEFAULT 0,
  memo           text NOT NULL,
  ref_type       text,
  ref_id         int,
  client_id      int REFERENCES clients(id),
  policy_id      int REFERENCES policies(id),
  carrier_id     int REFERENCES carriers(id),
  exported_batch text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_date ON ledger_entries (entry_date);
CREATE INDEX ledger_entries_account ON ledger_entries (account, entry_date);

CREATE TABLE accounting_periods (
  period    text PRIMARY KEY,                             -- YYYY-MM
  locked    boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  locked_by text
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE SEQUENCE doc_numbers START 1000;

-- ───────────────────────── Evidence tables are append-only
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE OR REPLACE FUNCTION login_events_geo_columns_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.occurred_at, NEW.username, NEW.success, NEW.method, NEW.ip, NEW.user_agent, NEW.accept_language, NEW.edge_region)
     IS DISTINCT FROM
     (OLD.id, OLD.occurred_at, OLD.username, OLD.success, OLD.method, OLD.ip, OLD.user_agent, OLD.accept_language, OLD.edge_region) THEN
    RAISE EXCEPTION 'login_events: only geo and geo_source may change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER login_events_no_delete BEFORE DELETE ON login_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER login_events_geo_only BEFORE UPDATE ON login_events FOR EACH ROW EXECUTE FUNCTION login_events_geo_columns_only();
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_change();
