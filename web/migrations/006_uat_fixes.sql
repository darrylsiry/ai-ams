-- An accepted commission variance is a decision, not something a re-run may undo.
ALTER TABLE commission_lines ADD COLUMN variance_accepted boolean NOT NULL DEFAULT false;
UPDATE commission_lines SET variance_accepted = true WHERE note LIKE '%Variance accepted%';
-- A logged reply belongs to the person who sent it, so it shows on their own Replies tab.
UPDATE emails e SET routed_user_id = u.id FROM users u
 WHERE e.direction = 'outbound' AND e.routed_user_id IS NULL AND lower(split_part(e.from_addr, '@', 1)) = lower(u.inbox_alias);
