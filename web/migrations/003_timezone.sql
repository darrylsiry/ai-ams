-- The agency works in one time zone: make it the database default so current_date and
-- timestamptz::date mean the agency's working day for every connection (including psql and
-- reporting tools). Ignored where the app's role doesn't own the database; db.ts also sets it per
-- connection. Change 'America/New_York' here and DISPLAY_TZ together.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/New_York');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'not the database owner; relying on per-connection SET TIME ZONE';
END $$;
