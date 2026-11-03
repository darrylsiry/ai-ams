-- Who asked the AI assistant what, for how much, and what it looked at: the agency's record of what
-- went to Anthropic and what it cost. Questions are scrubbed of identifiers before they are stored.
CREATE TABLE assistant_log (
  id            bigserial PRIMARY KEY,
  user_id       int REFERENCES users(id),
  username      text NOT NULL,
  asked_at      timestamptz NOT NULL DEFAULT now(),
  question      text NOT NULL,
  tools         text[] NOT NULL DEFAULT '{}',
  rounds        int NOT NULL DEFAULT 0,
  input_tokens  int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cached_tokens int NOT NULL DEFAULT 0,
  ms            int NOT NULL DEFAULT 0,
  outcome       text NOT NULL
);
CREATE INDEX assistant_log_asked ON assistant_log (asked_at DESC);
CREATE INDEX assistant_log_user ON assistant_log (username, asked_at DESC);
