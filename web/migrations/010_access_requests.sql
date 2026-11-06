-- Requests for a login from the signed-out sign-in page. Each one is kept here and then emailed to the
-- owner; emailed_at and email_error say whether the email went out, so a request is never lost when mail
-- isn't set up or the mail server refuses. Listed under Reports > Users & sign-ins.
CREATE TABLE access_requests (
  id           bigserial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  name         text NOT NULL,
  email        text NOT NULL,
  company      text NOT NULL DEFAULT '',
  ip           text,                       -- the client address as the platform reported it (the throttle's key)
  user_agent   text,
  emailed_at   timestamptz,
  email_error  text
);
CREATE INDEX access_requests_time ON access_requests (created_at DESC);
