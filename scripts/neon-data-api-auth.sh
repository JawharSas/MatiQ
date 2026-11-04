#!/usr/bin/env bash
# Makes the branch's Data API check tokens against the Clerk instance in
# CLERK_ISSUER, then proves it.
#
# `neon deploy` sets the JWKS URL only when it creates the Data API: after
# switching from Clerk's development instance to production it kept the old
# URL, and every sign-in failed right after Clerk's screen. So this replaces
# the provider through the Neon API (one provider at a time: the old one is
# removed first), then sends the Data API a token naming Clerk's current key.
# The answer must be a signature error (key found, fake signature), not
# "jwk not found".
#
# Needs NEON_API_KEY, NEON_PROJECT_ID, NEON_BRANCH (name or ID) and
# CLERK_ISSUER. NEON_API_BASE and CHECK_ATTEMPTS are for tests.
set -euo pipefail

: "${NEON_API_KEY:?}" "${NEON_PROJECT_ID:?}" "${NEON_BRANCH:?}" "${CLERK_ISSUER:?}"
api="${NEON_API_BASE:-https://console.neon.tech/api/v2}/projects/$NEON_PROJECT_ID"
want="${CLERK_ISSUER%/}/.well-known/jwks.json"
attempts="${CHECK_ATTEMPTS:-18}"

# Reads are retried; writes are not (a repeated DELETE or POST isn't safe).
neon_get() { curl -fsS --retry 3 --retry-all-errors -H "Authorization: Bearer $NEON_API_KEY" -H 'Accept: application/json' "$1"; }
neon_write() { curl -fsS -H "Authorization: Bearer $NEON_API_KEY" -H 'Accept: application/json' "$@" >/dev/null; }

branch_id=$(neon_get "$api/branches" | jq -r --arg b "$NEON_BRANCH" '[.branches[] | select(.name == $b or .id == $b)][0].id // empty')
if [ -z "$branch_id" ]; then
  echo "::error::Neon branch $NEON_BRANCH not found in project $NEON_PROJECT_ID."
  exit 1
fi

# The providers this branch's Data API uses: scoped to it, or to every branch.
providers=$(neon_get "$api/jwks" | jq -c --arg b "$branch_id" '[.jwks[]? | select(.branch_id == $b or .branch_id == null or .branch_id == "")]')
if jq -e --arg u "$want" 'length == 1 and .[0].jwks_url == $u' <<<"$providers" >/dev/null; then
  echo "The Data API already checks tokens against $want."
else
  while IFS=$'\t' read -r id url; do
    [ -n "$id" ] || continue
    echo "Removing the Data API's old token provider: $url"
    neon_write -X DELETE "$api/jwks/$id"
  done < <(jq -r --arg u "$want" '.[] | select(.jwks_url != $u) | [.id, .jwks_url] | @tsv' <<<"$providers")
  if ! jq -e --arg u "$want" 'any(.[]; .jwks_url == $u)' <<<"$providers" >/dev/null; then
    echo "Adding $want"
    neon_write -X POST -H 'Content-Type: application/json' \
      -d "$(jq -n --arg u "$want" --arg b "$branch_id" '{jwks_url: $u, provider_name: "Clerk", branch_id: $b}')" \
      "$api/jwks"
  fi
fi

# The proof: a token naming Clerk's current signing key.
data_api=$(neon_get "$api/branches/$branch_id/data-api/neondb" | jq -r '.url // empty')
kid=$(curl -fsS --retry 3 --retry-all-errors "$want" | jq -r '.keys[0].kid // empty')
if [ -z "$data_api" ] || [ -z "$kid" ]; then
  echo "::error::Could not read the Data API's address or Clerk's signing key ($want)."
  exit 1
fi
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
token="$(printf '{"alg":"RS256","kid":"%s","typ":"JWT"}' "$kid" | b64url).$(printf '{"sub":"deploy-check"}' | b64url).c2ln"
answer=''
for attempt in $(seq 1 "$attempts"); do
  answer=$(curl -sS --max-time 20 -H "Authorization: Bearer $token" "$data_api/rpc/am_i_owner" || true)
  if grep -qi 'signature' <<<"$answer" && ! grep -qi 'jwk not found' <<<"$answer"; then
    echo "The Data API knows Clerk's key $kid from $want."
    exit 0
  fi
  [ "$attempt" -lt "$attempts" ] && sleep "${CHECK_INTERVAL:-10}"
done
echo "::error::The Data API does not accept tokens from $CLERK_ISSUER (it answered: $answer). Sign-in would fail right after Clerk's screen."
exit 1
