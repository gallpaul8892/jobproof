#!/usr/bin/env bash
# Asserts the WAF module's rule scopes (no terraform needed; run by hand or from CI):
#  1. the sign-in rate rule is a STARTS_WITH match on /api/v1/auth/ with URL_DECODE + LOWERCASE
#     and POST, so it covers POST /api/v1/auth/login AND POST /api/v1/auth/sessions;
#  2. photo upload (PUT /api/v1/operative/jobs/*/photos/*/content) has a count-only override of
#     SizeRestrictions_BODY (T-003 design risk R9).
set -euo pipefail
python3 -I - "$(dirname "${BASH_SOURCE[0]}")/main.tf" <<'PY'
import re, sys
t = open(sys.argv[1]).read()
m = re.search(r'search_string\s*=\s*"(/api/v1/auth/)"\s*positional_constraint\s*=\s*"STARTS_WITH"(.*?)\n\s*statement \{', t, re.S)
errs = []
if not m:
    errs.append("rate rule: no STARTS_WITH /api/v1/auth/ match")
else:
    prefix = m.group(1)
    for p in ("/api/v1/auth/login", "/api/v1/auth/sessions", "/api/v1/auth/sessions/refresh"):
        if not p.startswith(prefix):
            errs.append("rate rule prefix does not cover " + p)
    block = t[m.start():m.start() + 700]
    for need in ("URL_DECODE", "LOWERCASE"):
        if need not in block:
            errs.append("rate rule lacks " + need)
if not re.search(r'search_string\s*=\s*"POST"', t):
    errs.append("rate rule lacks the POST method match")
o = re.search(r'rule_action_override\s*\{\s*name\s*=\s*"SizeRestrictions_BODY"\s*action_to_use\s*\{\s*count\s*\{\}', t)
if not o:
    errs.append("no count-only SizeRestrictions_BODY override")
for needle in ('"/api/v1/operative/jobs/"', '"/photos/"', '"/content"', '"PUT"'):
    if t.count(needle) < 2:
        errs.append("photo upload scope %s should appear in both common-rule rules" % needle)
if errs:
    print("\n".join("check-scope: " + e for e in errs), file=sys.stderr); sys.exit(1)
print("check-scope: ok")
PY
