-- Fixes from the code and security reviews.

-- SEC-003: a session carries the user's version; bumping it ends every session they hold. Signing out
-- ends just the one session, by recording its hash until the cookie would have expired anyway.
ALTER TABLE users ADD COLUMN session_version int NOT NULL DEFAULT 0;
CREATE TABLE revoked_sessions (
  token_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

-- SEC-012: a role that can look at everything it is allowed to and change nothing, for the UAT login.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','principal','account_manager','csr','producer','accounting','readonly'));
UPDATE users SET role = 'readonly' WHERE username = 'uat';

-- SEC-008: whether the provider's checks show the From address is genuine. NULL on older rows.
ALTER TABLE emails ADD COLUMN sender_verified boolean;

-- CR-006: which agency-bill line a producer statement paid, so each pays exactly once.
ALTER TABLE producer_statement_lines ADD COLUMN invoice_line_id int REFERENCES invoice_lines(id);
CREATE INDEX producer_statement_lines_invoice_line ON producer_statement_lines (invoice_line_id);
CREATE INDEX producer_statement_lines_commission_line ON producer_statement_lines (commission_line_id);
