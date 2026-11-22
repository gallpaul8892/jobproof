#!/bin/sh
# Runs at container start (nginx image runs /docker-entrypoint.d/*.sh as the nginx user).
# Writes the runtime config.js and the security-header include from API_BASE_URL and PHOTO_ORIGIN.
set -eu
# Byte-wise character classes: A-Z must never match accented or look-alike letters.
LC_ALL=C
export LC_ALL

API_BASE_URL="${API_BASE_URL-http://localhost:8000}"  # unset -> default; empty is rejected below
DIST_DIR="${DIST_DIR:-/usr/share/nginx/html}"
HEADERS_FILE="${HEADERS_FILE:-/tmp/jobproof-headers.conf}"

# An origin goes into a CSP header (and, for the API, a JS string), so accept only a plain
# scheme://host[:port] origin. Control characters (newline, CR, tab, ...) are rejected by the
# character-class check below, which allows only [A-Za-z0-9.:-] after the scheme. (Do not use
# `tr -d '[:print:]'` here: busybox tr, as in Alpine, does not support that class.)
# check_origin NAME VALUE: exits 1 (writing nothing) unless VALUE is a valid origin; NAME is the
# environment variable, used in the messages. Anchored over the whole string; the character
# classes exclude quotes, backslash, semicolon, whitespace, path, query and fragment characters.
check_origin() {
  NAME="$1"
  VALUE="$2"
  case "$VALUE" in
    http://*|https://*) ;;
    *) echo "jobproof-config: $NAME must start with http:// or https://" >&2; exit 1 ;;
  esac
  case "${VALUE#*://}" in
    ""|*[!A-Za-z0-9.:-]*)
      echo "jobproof-config: $NAME must be an origin like https://api.example.com (no path)" >&2
      exit 1 ;;
  esac
  # Structure: each host label is 1-63 characters, starts and ends with a letter or digit (hyphens
  # only inside), so "http://-", "http://.", "http://a..b" and "http://-a-.com" are refused. An
  # optional port is 1-5 digits with no leading zero.
  LABEL='[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
  if ! printf '%s' "$VALUE" | grep -Eq "^https?://$LABEL(\\.$LABEL)*(:[1-9][0-9]{0,4})?\$"; then
    echo "jobproof-config: $NAME must be an origin like https://api.example.com (no path, valid host and port)" >&2
    exit 1
  fi
  HOSTPORT="${VALUE#*://}"
  HOST="${HOSTPORT%%:*}"
  case "$HOSTPORT" in
    *:*)
      PORT="${HOSTPORT#*:}"
      if [ "$PORT" -gt 65535 ]; then
        echo "jobproof-config: $NAME port must be between 1 and 65535" >&2
        exit 1
      fi ;;
  esac
  # 253 is the longest valid DNS name; the cap applies to the host only (not scheme or port).
  if [ "${#HOST}" -gt 253 ]; then
    echo "jobproof-config: $NAME host must be at most 253 characters" >&2
    exit 1
  fi
  # A host made only of digits and dots must be a valid dotted-quad IPv4 address (no leading zeros).
  case "$HOST" in
    *[!0-9.]*) ;;
    *)
      OCTET='(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])'
      if ! printf '%s' "$HOST" | grep -Eq "^$OCTET(\\.$OCTET){3}\$"; then
        echo "jobproof-config: $NAME host looks numeric but is not a valid IPv4 address" >&2
        exit 1
      fi ;;
  esac
}

ORIGIN="${API_BASE_URL%/}"
check_origin API_BASE_URL "$ORIGIN"
# Where uploaded photos are served from (object storage): added to img-src only (T-003g).
PHOTO_ORIGIN="${PHOTO_ORIGIN-http://localhost:8333}"  # unset -> default; empty is rejected
PHOTO_ORIGIN="${PHOTO_ORIGIN%/}"
check_origin PHOTO_ORIGIN "$PHOTO_ORIGIN"

# JSON-escape backslashes and double quotes (the validation above already excludes both).
ESCAPED=$(printf '%s' "$ORIGIN" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

printf 'window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "%s"};\n' "$ESCAPED" > "$DIST_DIR/config.js"

cat > "$HEADERS_FILE" <<HEADERS
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: $ORIGIN $PHOTO_ORIGIN; connect-src 'self' $ORIGIN; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
HEADERS

echo "jobproof-config: wrote config.js and security headers for API origin $ORIGIN and photos origin $PHOTO_ORIGIN"
