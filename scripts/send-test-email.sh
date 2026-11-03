#!/usr/bin/env bash
# Send a sample forwarded email to the inbound webhook, the way a mail provider would.
#
#   scripts/send-test-email.sh                                   # local dev server (localhost:3200)
#   AMS_URL=https://siryous-ams.fly.dev INBOUND_EMAIL_TOKEN=... scripts/send-test-email.sh
#   scripts/send-test-email.sh path/to/message.eml              # post a saved message instead
#
# Prints the webhook's answer: the email id, the task it created, and how it was classified.
set -euo pipefail
URL="${AMS_URL:-http://localhost:3200}"
TOKEN="${INBOUND_EMAIL_TOKEN:-local-inbound-token}"
if [ $# -gt 0 ]; then
  curl -sS -X POST "$URL/api/inbound/email" -H "X-Inbound-Token: $TOKEN" -H "Content-Type: message/rfc822" --data-binary @"$1"; echo
  exit
fi
id="test-$(date +%s)@example.test"
curl -sS -X POST "$URL/api/inbound/email" -H "X-Inbound-Token: $TOKEN" -H "Content-Type: message/rfc822" --data-binary @- <<MSG; echo
From: Catherine Holloway <choll@siryousagency.example>
Authentication-Results: test.local; dkim=pass header.d=siryousagency.example
To: choll@${INBOUND_EMAIL_DOMAIN:-amsinbox.siryous.app}
Subject: Fwd: Certificate request - new GC job
Message-ID: <$id>
Date: $(date -R 2>/dev/null || date)
Content-Type: text/plain; charset=utf-8

---------- Forwarded message ---------
From: Dana Price <dprice@summitbuilders.example>
Subject: Certificate request - new GC job

Hi, we need a certificate of insurance naming Summit Builders LLC as additional insured,
primary and non-contributory with waiver of subrogation, for the Main Street job by Friday.
Thanks!
MSG
