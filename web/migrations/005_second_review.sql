-- Second review round. An overpayment becomes a client credit tied to the receipt it came from (CR-027),
-- so reversing that receipt can take the credit back with it.
ALTER TABLE invoices ADD COLUMN source_receipt_id int REFERENCES receipts(id);
