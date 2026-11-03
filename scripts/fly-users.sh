#!/usr/bin/env bash
# Add sign-in logins to the deployed siryous AMS (one password per user).
#
#   scripts/fly-users.sh choll mrivera jbrooks     # add these users
#   scripts/fly-users.sh                           # just re-sync the secret from the file
#
# Logins live in .fly-credentials (git-ignored, mode 600) as name=password lines. New names get a
# generated password; then BASIC_AUTH_USERS is set from the whole file, which restarts the machine.
# Passwords are never printed: share them from the file.
#
# A login name is the username in Admin > Users (the seeded staff are admin, choll, mrivera, jbrooks,
# apatel, tnguyen, kowens, dharris, rcallahan, bwhitaker, sfoster, lmorgan). Signing in with a name
# that has no profile creates a CSR profile an admin can then set up.
set -euo pipefail
APP="${FLY_APP:-siryous-ams}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRED="$ROOT/.fly-credentials"
umask 077
[ -f "$CRED" ] || { echo "No .fly-credentials: run scripts/fly-deploy.sh first (it creates admin)"; exit 1; }

for name in "$@"; do
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Bad username '$name' (letters, digits, . _ - only)"; exit 1; }
done
for name in "$@"; do
  if grep -q "^$name=" "$CRED"; then echo "$name already exists"; continue; fi
  echo "$name=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)" >> "$CRED"
  echo "added $name"
done

users="$(grep -v '^url=' "$CRED" | sed 's/=/:/' | paste -sd, -)"
[ -n "$users" ] || { echo "No users in $CRED"; exit 1; }
printf 'BASIC_AUTH_USERS=%s\n' "$users" | fly secrets import -a "$APP"
echo "$APP now has $(grep -vc '^url=' "$CRED") sign-in logins (see $CRED)"
