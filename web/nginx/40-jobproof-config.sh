#!/bin/sh
# Runs at container start (nginx image runs /docker-entrypoint.d/*.sh as the nginx user).
# Writes the runtime config.js and the security-header include from API_BASE_URL.
set -eu
# Byte-wise character classes: A-Z must never match accented or look-alike letters.
LC_ALL=C
export LC_ALL

API_BASE_URL="${API_BASE_URL-http://localhost:8000}"  # unset -> default; empty is rejected below
DIST_DIR="${DIST_DIR:-/usr/share/nginx/html}"
HEADERS_FILE="${HEADERS_FILE:-/tmp/jobproof-headers.conf}"

# The API origin goes into a CSP header and a JS string, so accept only a plain
# scheme://host[:port] origin. Control characters (newline, CR, tab, ...) are rejected by the
# character-class check below, which allows only [A-Za-z0-9.:-] after the scheme. (Do not use
# `tr -d '[:print:]'` here: busybox tr, as in Alpine, does not support that class.)
ORIGIN="${API_BASE_URL%/}"
# Anchored over the whole string; the character classes exclude quotes, backslash, semicolon,
# whitespace, path, query and fragment characters.
case "$ORIGIN" in
  http://*|https://*) ;;
  *) echo "jobproof-config: API_BASE_URL must start with http:// or https://" >&2; exit 1 ;;
esac
case "${ORIGIN#*://}" in
  ""|*[!A-Za-z0-9.:-]*)
    echo "jobproof-config: API_BASE_URL must be an origin like https://api.example.com (no path)" >&2
    exit 1 ;;
esac
# Structure: each host label is 1-63 characters, starts and ends with a letter or digit (hyphens
# only inside), so "http://-", "http://.", "http://a..b" and "http://-a-.com" are refused. An
# optional port is 1-5 digits with no leading zero.
LABEL='[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
if ! printf '%s' "$ORIGIN" | grep -Eq "^https?://$LABEL(\\.$LABEL)*(:[1-9][0-9]{0,4})?\$"; then
  echo "jobproof-config: API_BASE_URL must be an origin like https://api.example.com (no path, valid host and port)" >&2
  exit 1
fi
HOSTPORT="${ORIGIN#*://}"
HOST="${HOSTPORT%%:*}"
case "$HOSTPORT" in
  *:*)
    PORT="${HOSTPORT#*:}"
    if [ "$PORT" -gt 65535 ]; then
      echo "jobproof-config: API_BASE_URL port must be between 1 and 65535" >&2
      exit 1
    fi ;;
esac
# 253 is the longest valid DNS name; the cap applies to the host only (not scheme or port).
if [ "${#HOST}" -gt 253 ]; then
  echo "jobproof-config: API_BASE_URL host must be at most 253 characters" >&2
  exit 1
fi
# A host made only of digits and dots must be a valid dotted-quad IPv4 address (no leading zeros).
case "$HOST" in
  *[!0-9.]*) ;;
  *)
    OCTET='(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])'
    if ! printf '%s' "$HOST" | grep -Eq "^$OCTET(\\.$OCTET){3}\$"; then
      echo "jobproof-config: API_BASE_URL host looks numeric but is not a valid IPv4 address" >&2
      exit 1
    fi ;;
esac

# JSON-escape backslashes and double quotes (the validation above already excludes both).
ESCAPED=$(printf '%s' "$ORIGIN" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

printf 'window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "%s"};\n' "$ESCAPED" > "$DIST_DIR/config.js"

cat > "$HEADERS_FILE" <<HEADERS
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: $ORIGIN; connect-src 'self' $ORIGIN; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
HEADERS

echo "jobproof-config: wrote config.js and security headers for API origin $ORIGIN"
