#!/usr/bin/env python3
"""Update progress.json and regenerate progress.html.

Usage:
  progress.py item <id> <status> [note...]      set an item's status (and optional note)
  progress.py add <phase_id> <id> <title> [owner]  add an item to a phase
  progress.py agent <name> <status> [note...]   set an agent's status (idle|working|done)
  progress.py log <who> <message...>            append an activity log line
  progress.py report <file.json>                add or replace an agent report section
                                                (id, title, agent, model, status, date, summary,
                                                blocks[{heading, type list|table, open, items|rows}])
  progress.py render                            just regenerate progress.html

Item statuses: backlog, todo, in_progress, review, blocked, done
"""
import datetime
import html
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "progress.json"
OUT = ROOT / "progress.html"
STATUSES = ["backlog", "todo", "in_progress", "review", "blocked", "done"]


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def esc(s):
    return html.escape(str(s or ""))


def load():
    return json.loads(DATA.read_text())


def save(d):
    d["updated"] = now()
    DATA.write_text(json.dumps(d, indent=2))
    render(d)


def badge(s):
    return f'<span class="badge {esc(s)}">{esc(s.replace("_", " "))}</span>'


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>%%TITLE%% progress</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--ink:#1b2430;--mute:#677386;--line:#e2e6eb;
--backlog:#a7b0bd;--todo:#7b8794;--in_progress:#2563eb;--review:#9333ea;--blocked:#dc2626;--done:#16a34a}
@media (prefers-color-scheme:dark){:root{--bg:#11151b;--card:#1a2029;--ink:#e7ebf0;--mute:#93a0b1;--line:#29313c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
.sub{color:var(--mute);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:16px}
.bar{height:12px;background:var(--line);border-radius:6px;overflow:hidden;margin:10px 0 6px}
.bar>div{height:100%;background:var(--done);width:%%PCT%%%}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.stat{flex:1;min-width:90px;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.stat b{display:block;font-size:20px}.stat span{color:var(--mute);font-size:12px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 6px;border-top:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--mute);font-weight:600;border-top:0}
td.id{font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:nowrap}
.note{color:var(--mute);font-size:12px}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;white-space:nowrap}
.badge.backlog{background:var(--backlog)}.badge.todo{background:var(--todo)}
.badge.in_progress,.badge.working{background:var(--in_progress)}.badge.review{background:var(--review)}
.badge.blocked{background:var(--blocked)}.badge.done{background:var(--done)}.badge.idle{background:var(--backlog)}
.log{font-size:13px;max-height:360px;overflow:auto}
.log div{padding:4px 0;border-top:1px solid var(--line)}.log time{color:var(--mute);margin-right:8px}
.log b{margin-right:6px}
details{border-top:1px solid var(--line);padding:8px 0}
summary{cursor:pointer;font-weight:600}
details ul{margin:8px 0 0;padding-left:20px}
details li{margin:4px 0}
ul.subl{margin:4px 0;color:var(--mute);font-size:13px}
p.lead{margin:8px 0 4px}
</style></head><body><main>
<h1>%%TITLE%%</h1>
<div class="sub">%%SUMMARY%% &middot; updated %%UPDATED%% &middot; refreshes every 10s</div>
<div class="card"><h2>Overall: %%DONE%% of %%TOTAL%% active items done (%%PCT%%%)</h2>
<div class="bar"><div></div></div>
<div class="stats">%%STATS%%</div></div>
%%PHASES%%
%%REPORTS%%
<div class="card"><h2>Agents</h2><table><tr><th>Agent</th><th>Model</th><th>Status</th><th>Doing</th></tr>%%AGENTS%%</table></div>
<div class="card"><h2>Activity</h2><div class="log">%%LOG%%</div></div>
</main>
<script>
try{var S=JSON.parse(sessionStorage.getItem('jp-open')||'{}');
document.querySelectorAll('details[data-key]').forEach(function(d){var k=d.dataset.key;
if(k in S)d.open=S[k];
d.addEventListener('toggle',function(){S[k]=d.open;sessionStorage.setItem('jp-open',JSON.stringify(S))})})}catch(e){}
</script></body></html>
"""


def render_block(rid, idx, b):
    if b.get("type") == "table":
        head = "".join(f"<th>{esc(c)}</th>" for c in b["columns"])
        rows = "".join(
            "<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>" for r in b["rows"]
        )
        body = f"<table><tr>{head}</tr>{rows}</table>"
    else:
        lis = ""
        for it in b.get("items", []):
            label = f"<b>{esc(it['label'])}</b> " if it.get("label") else ""
            sub = ""
            if it.get("sub"):
                sub = "<ul class='subl'>" + "".join(f"<li>{esc(s)}</li>" for s in it["sub"]) + "</ul>"
            lis += f"<li>{label}{esc(it.get('text'))}{sub}</li>"
        body = f"<ul>{lis}</ul>"
    op = " open" if b.get("open") else ""
    return f'<details data-key="{esc(rid)}-{idx}"{op}><summary>{esc(b["heading"])}</summary>{body}</details>'


def render_reports(d):
    out = ""
    for r in d.get("reports", []):
        blocks = "".join(render_block(r["id"], i, b) for i, b in enumerate(r.get("blocks", [])))
        out += (
            f'<div class="card"><h2>{esc(r["title"])} {badge(r.get("status", "done"))}</h2>'
            f'<div class="note">{esc(r.get("agent"))} &middot; {esc(r.get("model"))} &middot; {esc(r.get("date"))}</div>'
            f'<p class="lead">{esc(r.get("summary"))}</p>{blocks}</div>'
        )
    return out


def render(d):
    items = [i for p in d["phases"] for i in p["items"]]
    active = [i for i in items if i["status"] != "backlog"]
    done = sum(1 for i in active if i["status"] == "done")
    pct = round(100 * done / len(active)) if active else 0
    stats = "".join(
        f'<div class="stat"><b>{sum(1 for i in items if i["status"] == s)}</b>'
        f'<span>{s.replace("_", " ")}</span></div>'
        for s in STATUSES
    )
    phases = ""
    for p in d["phases"]:
        rows = "".join(
            f'<tr><td class="id">{esc(i["id"])}</td>'
            f'<td>{esc(i["title"])}<div class="note">{esc(i.get("note"))}</div></td>'
            f'<td>{esc(i.get("owner"))}</td><td>{badge(i["status"])}</td></tr>'
            for i in p["items"]
        )
        phases += (
            f'<div class="card"><h2>{esc(p["name"])}</h2>'
            f"<table><tr><th>ID</th><th>Item</th><th>Owner</th><th>Status</th></tr>{rows}</table></div>"
        )
    agents = "".join(
        f'<tr><td>{esc(a["name"])}</td><td>{esc(a.get("model"))}</td>'
        f'<td>{badge(a.get("status", "idle"))}</td><td class="note">{esc(a.get("note"))}</td></tr>'
        for a in d.get("agents", [])
    )
    log = "".join(
        f'<div><time>{esc(l["time"])}</time><b>{esc(l["who"])}</b>{esc(l["msg"])}</div>'
        for l in reversed(d.get("log", [])[-60:])
    )
    out = (
        TEMPLATE.replace("%%TITLE%%", esc(d["project"]))
        .replace("%%SUMMARY%%", esc(d.get("summary", "")))
        .replace("%%UPDATED%%", esc(d.get("updated", "")))
        .replace("%%PCT%%", str(pct))
        .replace("%%DONE%%", str(done))
        .replace("%%TOTAL%%", str(len(active)))
        .replace("%%STATS%%", stats)
        .replace("%%PHASES%%", phases)
        .replace("%%REPORTS%%", render_reports(d))
        .replace("%%AGENTS%%", agents)
        .replace("%%LOG%%", log)
    )
    OUT.write_text(out)


def find_item(d, item_id):
    for p in d["phases"]:
        for i in p["items"]:
            if i["id"] == item_id:
                return i
    sys.exit(f"unknown item {item_id}")


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], argv[1:]
    d = load()
    if cmd == "render":
        render(d)
        return
    if cmd == "item" and len(args) >= 2:
        if args[1] not in STATUSES:
            sys.exit(f"status must be one of {STATUSES}")
        i = find_item(d, args[0])
        i["status"] = args[1]
        if len(args) > 2:
            i["note"] = " ".join(args[2:])
    elif cmd == "add" and len(args) >= 3:
        phase = next((p for p in d["phases"] if p["id"] == args[0]), None)
        if not phase:
            sys.exit(f"unknown phase {args[0]}")
        phase["items"].append(
            {"id": args[1], "title": args[2], "owner": args[3] if len(args) > 3 else "", "status": "todo"}
        )
    elif cmd == "agent" and len(args) >= 2:
        a = next((a for a in d["agents"] if a["name"] == args[0]), None)
        if not a:
            sys.exit(f"unknown agent {args[0]}")
        a["status"] = args[1]
        a["note"] = " ".join(args[2:])
    elif cmd == "report" and len(args) == 1:
        r = json.loads(pathlib.Path(args[0]).read_text())
        reports = d.setdefault("reports", [])
        for n, existing in enumerate(reports):
            if existing["id"] == r["id"]:
                reports[n] = r
                break
        else:
            reports.append(r)
    elif cmd == "log" and len(args) >= 2:
        d.setdefault("log", []).append({"time": now(), "who": args[0], "msg": " ".join(args[1:])})
    else:
        sys.exit(__doc__)
    save(d)


if __name__ == "__main__":
    main(sys.argv[1:])
