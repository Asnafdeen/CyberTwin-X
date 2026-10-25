"""CyberTwin X - local-first monitoring + repetition analysis. Binds to 127.0.0.1 only."""
import itertools, json, re, time
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

import psutil
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
HISTORY_FILE = Path(__file__).with_name("history.json")
MAX_CHARS, MAX_POSTS = 20000, 50
BOOT = psutil.boot_time()
psutil.cpu_percent(None)  # prime the CPU counter


def err(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/system")
def system():
    import platform
    return jsonify({"ok": True, "data": {
        "os": f"{platform.system()} {platform.release()}", "machine": platform.machine(),
        "hostname": platform.node(), "python": platform.python_version(),
        "cores_physical": psutil.cpu_count(logical=False), "cores_logical": psutil.cpu_count(),
        "boot_time": datetime.fromtimestamp(BOOT).isoformat(timespec="seconds"),
        "uptime_seconds": int(time.time() - BOOT), "source": "real"}})


@app.route("/api/metrics")
def metrics():
    try:
        ram, disk = psutil.virtual_memory(), psutil.disk_usage(Path.home().anchor or "/")
        net = psutil.net_io_counters()
        return jsonify({"ok": True, "data": {
            "cpu": psutil.cpu_percent(None), "ram": ram.percent,
            "ram_used": ram.used, "ram_total": ram.total,
            "disk": disk.percent, "disk_free": disk.free, "disk_total": disk.total,
            "net_sent": net.bytes_sent, "net_recv": net.bytes_recv,
            "uptime_seconds": int(time.time() - BOOT), "ts": time.time(), "source": "real"}})
    except Exception as e:  # never leak a traceback to the browser
        return err(f"Could not read metrics: {e}", 500)


@app.route("/api/processes")
def processes():
    rows = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
        try:
            i = p.info
            rows.append({"pid": i["pid"], "name": i["name"] or "?",
                         "cpu": round(i["cpu_percent"] or 0, 1), "mem": round(i["memory_percent"] or 0, 2)})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    key = "mem" if request.args.get("sort") == "mem" else "cpu"
    rows.sort(key=lambda r: r[key], reverse=True)
    return jsonify({"ok": True, "total": len(rows), "data": rows[:50], "source": "real"})


@app.route("/api/network")
def network():
    try:
        conns = psutil.net_connections(kind="inet")
    except (psutil.AccessDenied, PermissionError):
        return jsonify({"ok": False, "denied": True,
                        "error": "Permission denied. Run the terminal as Administrator to list connections."}), 403
    names, out = {}, []
    for c in conns[:300]:
        if c.pid and c.pid not in names:
            try: names[c.pid] = psutil.Process(c.pid).name()
            except Exception: names[c.pid] = "?"
        out.append({"proto": "TCP" if c.type == 1 else "UDP", "local": f"{c.laddr.ip}:{c.laddr.port}" if c.laddr else "",
                    "remote": f"{c.raddr.ip}:{c.raddr.port}" if c.raddr else "-",
                    "status": c.status, "process": names.get(c.pid, "-")})
    return jsonify({"ok": True, "data": out, "source": "real"})


# ---------- Dead Internet Detector (indicators only, never proof) ----------
def words(t): return re.findall(r"\w+", t.lower())


def ngrams(w, n=4): return [" ".join(w[i:i + n]) for i in range(len(w) - n + 1)]


def analyze(text):
    posts = [p.strip() for p in re.split(r"\n\s*\n|^---+$", text, flags=re.M) if p.strip()][:MAX_POSTS]
    toks = [words(p) for p in posts]
    grams = [set(ngrams(w)) for w in toks]
    # phrases that appear in 2+ different posts
    seen = {}
    for idx, g in enumerate(grams):
        for ph in g: seen.setdefault(ph, set()).add(idx)
    shared = sorted((p for p, s in seen.items() if len(s) > 1), key=len, reverse=True)[:25]
    pairs = []
    for a, b in itertools.combinations(range(len(posts)), 2):
        r = SequenceMatcher(None, " ".join(toks[a]), " ".join(toks[b])).ratio()
        pairs.append({"a": a + 1, "b": b + 1, "similarity": round(r * 100, 1)})
    pairs.sort(key=lambda x: x["similarity"], reverse=True)
    allw = [w for t in toks for w in t]
    all_g = [g for t in toks for g in ngrams(t)] if False else [g for t in toks for g in ngrams(t)]
    rep = (1 - len(set(all_g)) / len(all_g)) * 100 if all_g else 0
    top_sim = pairs[0]["similarity"] if pairs else 0
    uniq = len(set(allw)) / len(allw) if allw else 1
    reasons = []
    if top_sim >= 80: reasons.append(f"Posts {pairs[0]['a']} and {pairs[0]['b']} are {top_sim}% similar - near-duplicate wording.")
    elif top_sim >= 50: reasons.append(f"Posts {pairs[0]['a']} and {pairs[0]['b']} share {top_sim}% of their wording.")
    if rep >= 30: reasons.append(f"{rep:.0f}% of 4-word sequences are repeated, which is higher than typical varied writing.")
    if shared: reasons.append(f"{len(shared)} phrase(s) appear in more than one post.")
    if len(allw) > 30 and uniq < 0.4: reasons.append(f"Low vocabulary variety ({uniq:.0%} unique words).")
    if len(posts) == 1 and not reasons: reasons.append("Only one post submitted - add more posts to compare similarity.")
    score = round(min(100, rep * 0.6 + top_sim * 0.4), 1)
    level = "high" if score >= 60 else "medium" if score >= 30 else "low"
    if not reasons: reasons.append("No strong repetition indicators found.")
    return {"posts": len(posts), "repetition_score": score, "max_similarity": top_sim, "level": level,
            "pairs": pairs[:10], "shared_phrases": shared, "reasons": reasons,
            "disclaimer": "These are indicators of repetition, not proof that content is AI-generated or written by a bot."}


def load_history():
    try: return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception: return []


@app.route("/api/analyze", methods=["POST"])
def analyze_route():
    body = request.get_json(silent=True) or {}
    text = body.get("text")
    if not isinstance(text, str) or not text.strip(): return err("Paste some text to analyze.")
    if len(text) > MAX_CHARS: return err(f"Text is too long (max {MAX_CHARS} characters).")
    res = analyze(text)  # text is only ever read as data, never executed
    entry = {"id": int(time.time() * 1000), "time": datetime.now().isoformat(timespec="seconds"),
             "preview": text.strip()[:80], **{k: res[k] for k in ("posts", "repetition_score", "max_similarity", "level")}}
    h = [entry] + load_history()[:49]
    try: HISTORY_FILE.write_text(json.dumps(h), encoding="utf-8")
    except OSError: pass
    return jsonify({"ok": True, "data": res})


@app.route("/api/history", methods=["GET", "DELETE"])
def history():
    if request.method == "DELETE":
        HISTORY_FILE.unlink(missing_ok=True)
        return jsonify({"ok": True, "data": []})
    return jsonify({"ok": True, "data": load_history()})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
