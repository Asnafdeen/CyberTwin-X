"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cfg = Object.assign({interval:2, cpu:85, ram:85, disk:90}, JSON.parse(localStorage.getItem("ctx") || "{}"));
let timer = null, chart = null, sort = "cpu", alerted = {};

async function api(url, opt) {
  try {
    const r = await fetch(url, opt), j = await r.json();
    $("banner").hidden = true;
    return j;
  } catch (e) {
    $("banner").hidden = false;
    $("banner").textContent = "Cannot reach the CyberTwin X backend. Make sure app.py is running. No data is being shown or invented.";
    return null;
  }
}
function log(msg) {
  const t = $("term"); t.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  t.scrollTop = t.scrollHeight;
}
const gb = b => (b / 1073741824).toFixed(1) + " GB";
const dur = s => `${Math.floor(s/86400)}d ${Math.floor(s%86400/3600)}h ${Math.floor(s%3600/60)}m`;

// ---- navigation ----
function show(v) {
  document.querySelectorAll(".view").forEach(e => e.classList.toggle("active", e.id === v));
  document.querySelectorAll(".sidebar a").forEach(a => a.classList.toggle("active", a.dataset.v === v));
  $("sidebar").classList.remove("open");
  if (v === "twin") initTwin(); if (v === "procs") loadProcs(); if (v === "net") loadNet(); if (v === "history") loadHist();
}
document.querySelectorAll(".sidebar a").forEach(a => a.addEventListener("click", e => { e.preventDefault(); show(a.dataset.v); }));
$("menuBtn").onclick = () => $("sidebar").classList.toggle("open");

// ---- charts ----
function initChart() {
  if (typeof Chart === "undefined") { $("chartMsg").hidden = false; return; }
  const ds = (l, c) => ({label:l, data:[], borderColor:c, backgroundColor:c + "22", fill:true, tension:.3, pointRadius:0});
  chart = new Chart($("chart1"), {type:"line", data:{labels:[], datasets:[ds("CPU %", "#22e6ff"), ds("RAM %", "#3dff9a")]},
    options:{responsive:true, maintainAspectRatio:false, animation:false, scales:{y:{min:0, max:100, ticks:{color:"#7f97ad"}}, x:{display:false}}, plugins:{legend:{labels:{color:"#d6e6f2"}}}}});
}
function pushChart(c, r) {
  if (!chart) return;
  const d = chart.data; d.labels.push(""); d.datasets[0].data.push(c); d.datasets[1].data.push(r);
  if (d.labels.length > 40) { d.labels.shift(); d.datasets.forEach(s => s.data.shift()); }
  chart.update();
}


// ---- 3D Digital Twin (three.js) ----
let T = null, lastM = null;
function initTwin() {
  if (T) { resizeTwin(); return; }
  const box = $("twin3d");
  if (typeof THREE === "undefined") { box.innerHTML = '<p class="empty">The 3D view needs three.js from the internet. All metrics still work.</p>'; return; }
  const w = box.clientWidth, h = box.clientHeight;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
  cam.position.set(0, 3.2, 8.5); cam.lookAt(0, 0.6, 0);
  const ren = new THREE.WebGLRenderer({antialias: true, alpha: true});
  ren.setSize(w, h); ren.setPixelRatio(Math.min(devicePixelRatio, 2)); box.appendChild(ren.domElement);
  scene.add(new THREE.AmbientLight(0x6688bb, 0.9));
  const pl = new THREE.PointLight(0x22e6ff, 1.6, 40); pl.position.set(3, 6, 6); scene.add(pl);
  const grid = new THREE.GridHelper(16, 32, 0x12304a, 0x0b1c33); grid.position.y = -0.35; scene.add(grid);
  const root = new THREE.Group(); scene.add(root);
  const edges = [];
  const solid = (geo, em) => new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: 0x0a1428, emissive: em, emissiveIntensity: 0.2, metalness: 0.6, roughness: 0.4}));
  const wire = (geo, parent) => { const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color: 0x22e6ff})); parent.add(l); edges.push(l.material); };
  const add = (geo, em, x, y, z, parent = root) => { const m = solid(geo, em); m.position.set(x, y, z); parent.add(m); wire(geo, m); return m; };

  add(new THREE.BoxGeometry(4.4, 0.2, 3), 0x0a2a4a, 0, 0, 0);                       // base
  const hinge = new THREE.Group(); hinge.position.set(0, 0.1, -1.5); hinge.rotation.x = -0.2; root.add(hinge);
  add(new THREE.BoxGeometry(4.4, 2.7, 0.12), 0x0a2a4a, 0, 1.35, 0, hinge);          // screen body
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 300;
  const tex = new THREE.CanvasTexture(cv);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 2.4), new THREE.MeshBasicMaterial({map: tex}));
  face.position.set(0, 1.35, 0.07); hinge.add(face);

  const cpu = add(new THREE.BoxGeometry(0.9, 0.16, 0.9), 0x22e6ff, -1.4, 0.18, 0.2);   // CPU chip
  const rams = [0, 1, 2, 3].map(i => add(new THREE.BoxGeometry(0.16, 0.12, 1.1), 0x3dff9a, -0.1 + i * 0.3, 0.16, 0.2));
  const disk = add(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 32), 0x22e6ff, 1.5, 0.16, 0.3);
  const fan = new THREE.Group(); fan.position.set(1.5, 0.2, -0.75); root.add(fan);
  for (let i = 0; i < 4; i++) { const b = solid(new THREE.BoxGeometry(0.5, 0.02, 0.12), 0x22e6ff); b.position.x = 0.25; const g = new THREE.Group(); g.rotation.y = i * Math.PI / 2; g.add(b); fan.add(g); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 8, 32), new THREE.MeshBasicMaterial({color: 0x22e6ff})); ring.rotation.x = Math.PI / 2; fan.add(ring); edges.push(ring.material);

  const pg = new THREE.BufferGeometry(), pts = new Float32Array(300 * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 14;
  pg.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  const stars = new THREE.Points(pg, new THREE.PointsMaterial({color: 0x3dff9a, size: 0.04})); scene.add(stars);

  let drag = false, lx = 0, vel = 0;
  ren.domElement.addEventListener("pointerdown", e => { drag = true; lx = e.clientX; });
  addEventListener("pointerup", () => drag = false);
  addEventListener("pointermove", e => { if (drag) { vel = (e.clientX - lx) * 0.01; root.rotation.y += vel; lx = e.clientX; } });
  T = {scene, cam, ren, cv, tex, edges, cpu, rams, disk, fan, ring, box};
  root.rotation.y = -0.5;

  (function loop() {
    requestAnimationFrame(loop);
    if (!box.offsetParent) return;                       // skip while the tab is hidden
    if (!drag) root.rotation.y += 0.0035;
    const c = lastM ? lastM.cpu : 0;
    fan.rotation.y += 0.03 + c * 0.004; stars.rotation.y += 0.0006;
    cpu.material.emissiveIntensity = 0.3 + (0.7 + 0.3 * Math.sin(Date.now() / 250)) * c / 100 * 2;
    ren.render(scene, cam);
  })();
  addEventListener("resize", resizeTwin); updateTwin();
}
function resizeTwin() {
  if (!T) return;
  const w = T.box.clientWidth, h = T.box.clientHeight;
  if (!w) return; T.ren.setSize(w, h); T.cam.aspect = w / h; T.cam.updateProjectionMatrix();
}
function updateTwin() {
  if (!T || !lastM) return;
  const m = lastM, hot = m.cpu > cfg.cpu || m.ram > cfg.ram, col = hot ? 0xff4d6d : 0x22e6ff;
  T.edges.forEach(e => e.color.setHex(col));
  T.cpu.material.emissive.setHex(col);
  T.rams.forEach((r, i) => { const on = m.ram > i * 25 + 5; r.material.emissiveIntensity = on ? 1.1 : 0.05; r.scale.y = on ? 1.6 : 1; });
  T.disk.material.emissiveIntensity = 0.2 + m.disk / 100 * 1.2; T.disk.scale.y = 1 + m.disk / 100;
  const x = T.cv.getContext("2d"); x.fillStyle = "#050c18"; x.fillRect(0, 0, 512, 300);
  x.font = "bold 22px Orbitron, monospace"; x.fillStyle = hot ? "#ff4d6d" : "#22e6ff";
  x.fillText(hot ? "HIGH LOAD" : m.cpu > 40 ? "BUSY" : "IDLE", 24, 42);
  [["CPU", m.cpu], ["RAM", m.ram], ["DISK", m.disk]].forEach(([n, v], i) => {
    const y = 86 + i * 62; x.font = "18px 'Share Tech Mono', monospace"; x.fillStyle = "#9fb6c9"; x.fillText(n, 24, y);
    x.fillStyle = "#0e2036"; x.fillRect(90, y - 18, 330, 22); x.fillStyle = v > 85 ? "#ff4d6d" : "#3dff9a"; x.fillRect(90, y - 18, 330 * v / 100, 22);
    x.fillStyle = "#fff"; x.fillText(v.toFixed(0) + "%", 432, y);
  });
  T.tex.needsUpdate = true;
}

// ---- monitoring ----
function setCard(id, val, limit) { const e = $(id); e.textContent = val.toFixed(1) + "%"; e.classList.toggle("warn", val > limit); }
function alertOnce(key, over, msg) {
  if (over && !alerted[key]) log("ALERT: " + msg);
  alerted[key] = over;
}
async function tick() {
  const j = await api("/api/metrics");
  if (!j || !j.ok) { if (j) log("Metrics error: " + j.error); return; }
  const m = j.data;
  setCard("mCpu", m.cpu, cfg.cpu); setCard("mRam", m.ram, cfg.ram); setCard("mDisk", m.disk, cfg.disk);
  $("mRamD").textContent = `${gb(m.ram_used)} of ${gb(m.ram_total)}`;
  $("mDiskD").textContent = `${gb(m.disk_free)} free of ${gb(m.disk_total)}`;
  $("mUp").textContent = dur(m.uptime_seconds);
  pushChart(m.cpu, m.ram);
  alertOnce("cpu", m.cpu > cfg.cpu, `CPU at ${m.cpu}% (limit ${cfg.cpu}%)`);
  alertOnce("ram", m.ram > cfg.ram, `Memory at ${m.ram}% (limit ${cfg.ram}%)`);
  alertOnce("disk", m.disk > cfg.disk, `Disk at ${m.disk}% (limit ${cfg.disk}%)`);
  lastM = m; updateTwin();
}
function start() {
  if (timer) return;
  timer = setInterval(tick, cfg.interval * 1000); tick();
  $("dot").classList.add("on"); $("monState").textContent = "Monitoring"; log("Monitoring started.");
}
function stop() {
  if (!timer) return;
  clearInterval(timer); timer = null;
  $("dot").classList.remove("on"); $("monState").textContent = "Stopped"; log("Monitoring stopped.");
}
async function loadSys() {
  const j = await api("/api/system");
  if (!j || !j.ok) return;
  const s = j.data;
  $("mHost").textContent = s.hostname;
  $("sysinfo").className = "";
  $("sysinfo").innerHTML = `<table><tr><td>Operating system</td><td>${esc(s.os)} (${esc(s.machine)})</td></tr>
    <tr><td>Cores</td><td>${s.cores_physical} physical, ${s.cores_logical} logical</td></tr>
    <tr><td>Booted</td><td>${esc(s.boot_time)}</td></tr><tr><td>Python</td><td>${esc(s.python)}</td></tr></table>`;
}
async function loadProcs() {
  const j = await api("/api/processes?sort=" + sort);
  if (!j || !j.ok) return;
  $("procTotal").textContent = `${j.total} running, top 50 shown`;
  $("procBody").innerHTML = j.data.map(p => `<tr><td>${p.pid}</td><td>${esc(p.name)}</td><td>${p.cpu}</td><td>${p.mem}</td></tr>`).join("");
}
async function loadNet() {
  const j = await api("/api/network");
  if (!j) return;
  if (!j.ok) { $("netBody").innerHTML = `<tr><td colspan="5" class="empty">${esc(j.error)}</td></tr>`; return; }
  $("netBody").innerHTML = j.data.length ? j.data.map(c => `<tr><td>${c.proto}</td><td>${esc(c.local)}</td><td>${esc(c.remote)}</td><td>${esc(c.status)}</td><td>${esc(c.process)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No connections found.</td></tr>`;
}

// ---- Dead Internet Detector ----
const SAMPLE = `Click the link in my bio to win a free prize today, limited time only!

Click the link in my bio to win a free prize today, don't miss out!

I walked the dog this morning and the fog over the river was beautiful.

Click the link in my bio to win a free prize today, limited time only!`;
function highlight(text, phrases) {
  let h = esc(text);
  phrases.forEach(p => {
    const re = new RegExp("\\b" + p.split(" ").join("\\W+") + "\\b", "gi");
    h = h.replace(re, m => `<mark>${m}</mark>`);
  });
  return h;
}
async function analyze() {
  const text = $("txt").value, box = $("result");
  box.hidden = false; box.innerHTML = '<p class="empty">Analyzing...</p>';
  const j = await api("/api/analyze", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text})});
  if (!j) { box.innerHTML = ""; return; }
  if (!j.ok) { box.innerHTML = `<p class="lvl-high">${esc(j.error)}</p>`; return; }
  const r = j.data, posts = text.split(/\n\s*\n|^---+$/m).map(s => s.trim()).filter(Boolean).slice(0, 50);
  box.innerHTML = `<div class="meters"><div><div class="big">${r.repetition_score}</div>Repetition score</div>
    <div><div class="big">${r.max_similarity}%</div>Highest similarity</div>
    <div><div class="big lvl-${r.level}">${r.level}</div>Indicator level</div></div>
    <h3>Why this was flagged</h3><ul>${r.reasons.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    <h3>Most similar pairs</h3>${r.pairs.length ? r.pairs.map(p => `<div>Post ${p.a} and post ${p.b}: ${p.similarity}%</div>`).join("") : "<div class='empty'>Add two or more posts to compare.</div>"}
    <h3>Posts with matching phrases highlighted</h3>${posts.map((p, i) => `<div class="post"><b>${i + 1}.</b> ${highlight(p, r.shared_phrases)}</div>`).join("")}
    <p class="note">${esc(r.disclaimer)}</p>`;
  log(`Analysis finished: ${r.posts} post(s), score ${r.repetition_score}.`);
}
async function loadHist() {
  const j = await api("/api/history");
  if (!j || !j.ok) return;
  $("histBody").innerHTML = j.data.length ? j.data.map(h => `<tr><td>${esc(h.time)}</td><td>${esc(h.preview)}</td><td>${h.posts}</td><td>${h.repetition_score}</td><td>${h.max_similarity}%</td><td class="lvl-${h.level}">${h.level}</td></tr>`).join("")
    : `<tr><td colspan="6" class="empty">No analyses yet. Run one in the Dead Internet Detector.</td></tr>`;
}

// ---- wiring ----
$("bStart").onclick = start; $("bStop").onclick = stop;
$("bRefresh").onclick = () => { tick(); loadSys(); loadProcs(); loadNet(); log("Manual refresh."); };
$("sortCpu").onclick = () => { sort = "cpu"; loadProcs(); }; $("sortMem").onclick = () => { sort = "mem"; loadProcs(); };
$("bAnalyze").onclick = analyze; $("bSample").onclick = () => { $("txt").value = SAMPLE; };
$("bClear").onclick = () => { $("txt").value = ""; $("result").hidden = true; };
$("bClearHist").onclick = async () => { if (confirm("Delete all analysis history?")) { await api("/api/history", {method:"DELETE"}); loadHist(); } };
$("sSave").onclick = () => {
  const n = (id, lo, hi, d) => Math.min(hi, Math.max(lo, +$(id).value || d));
  Object.assign(cfg, {interval:n("sInt", 1, 30, 2), cpu:n("sCpu", 10, 100, 85), ram:n("sRam", 10, 100, 85), disk:n("sDisk", 10, 100, 90)});
  localStorage.setItem("ctx", JSON.stringify(cfg));
  if (timer) { stop(); start(); }
  log("Settings saved.");
};
$("sInt").value = cfg.interval; $("sCpu").value = cfg.cpu; $("sRam").value = cfg.ram; $("sDisk").value = cfg.disk;
initChart(); loadSys(); log("CyberTwin X ready. Press Start to begin monitoring."); show((location.hash || "#overview").slice(1));
