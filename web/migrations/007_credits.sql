-- BIL-23: a client credit can be applied to an open invoice. An application moves no cash and posts no
-- journal, so it is a zero-amount receipt with method 'credit' holding the pair of applications.
ALTER TABLE receipts DROP CONSTRAINT receipts_method_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_method_check CHECK (method IN ('check','ach','card','cash','wire','credit'));

-- CR-036: daily automation chased unrefunded credits as past-due invoices. Close the tasks it made.
UPDATE activities a SET status = 'cancelled', outcome = 'Raised in error: this was a client credit, not money owed', completed_at = now(), updated_at = now()
  FROM invoices i
 WHERE a.auto_key = 'pastdue:' || i.id AND i.total < 0 AND a.status IN ('open','waiting');
