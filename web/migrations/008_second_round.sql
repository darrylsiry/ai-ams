-- Policies created in the app never had issued_at, which hid them from "commission not received" (CR-052).
UPDATE policies p SET issued_at = t.issued_at
  FROM policy_transactions t
 WHERE t.policy_id = p.id AND p.issued_at IS NULL AND t.kind IN ('new','renewal','rewrite') AND t.status = 'issued' AND t.issued_at IS NOT NULL;

-- No negative debit or credit from here on (CR-051). Older rows stay as they were: ledger rows can't be edited.
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_no_negative_amounts CHECK (debit >= 0 AND credit >= 0) NOT VALID;
