// ميقات – ولي الأمر: gate board (TV / tablet kiosk). Roles: gate, admin, manager (viewer = read-only).
// Live via Realtime postgres_changes on pickup_requests (RLS), with a polling fallback.
const SUPABASE_URL = "https://meeqat-api.tripleodoo.com";
const SUPABASE_KEY = "sb_publishable_D0YQfRkraujKgNEVpSNKhw_YMvm2oB7";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ACTIVE = ["requested", "announced", "released"];
const STATUS_AR = { requested: "بانتظار النداء", announced: "نُودي", released: "خرج إلى البوابة", picked_up: "تم التسليم" };
const POLL_LIVE_MS = 60_000, POLL_OFFLINE_MS = 10_000, TICK_MS = 20_000;

let schoolId = null, myRole = null, gates = ["1"], requests = [], done = [];
let live = false, pollTimer = null, reloadTimer = null, searchTimer = null, lastSeenMaxId = 0;
const canAct = () => ["gate", "admin", "manager"].includes(myRole);
const gateFilter = () => localStorage.getItem("meeqat.gate") || "";

// ─── auth ─────────────────────────────────────────────────────────────────────
async function login() {
  const { error } = await db.auth.signInWithPassword({
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
  });
  if (error) return msg("loginMsg", "فشل الدخول: " + error.message, true);
  init();
}

async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { document.getElementById("login").style.display = "flex"; return; }
  const { data: m } = await db.from("school_users").select("school_id, role").eq("user_id", session.user.id).maybeSingle();
  if (!m) {
    document.getElementById("login").style.display = "flex";
    return msg("loginMsg", "هذا الحساب غير مرتبط بمدرسة.", true);
  }
  schoolId = m.school_id; myRole = m.role;
  const { data: school } = await db.from("schools").select("name").eq("id", schoolId).maybeSingle();
  document.getElementById("schoolName").textContent = school?.name || "";
  const { data: ps } = await db.from("pickup_settings").select("gates").eq("school_id", schoolId).maybeSingle();
  gates = (ps?.gates || ["1"]).map(String);
  const sel = document.getElementById("gateFilter");
  sel.innerHTML = `<option value="">كل البوابات</option>` + gates.map(g => `<option value="${esc(g)}">البوابة ${esc(g)}</option>`).join("");
  sel.value = gates.includes(gateFilter()) ? gateFilter() : "";
  document.getElementById("login").style.display = "none";
  document.getElementById("app").style.display = "grid";
  document.getElementById("toolbar").style.display = "flex";
  if (new URLSearchParams(location.search).has("kiosk")) document.body.classList.add("kiosk");
  subscribe();
  await loadBoard();
  schedulePoll();
  if (canAct()) { tick(); setInterval(tick, TICK_MS); }
}

// ─── data ─────────────────────────────────────────────────────────────────────
async function loadBoard() {
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data, error } = await db.from("pickup_requests")
    .select("id, student_name, student_label, gate, source, status, requested_at, announced_at, released_at, picked_up_at")
    .eq("school_id", schoolId).gte("requested_at", since)
    .in("status", [...ACTIVE, "picked_up"]).order("id", { ascending: false }).limit(150);
  if (error) return msg("msg", "تعذّر التحديث: " + error.message, true);
  requests = (data || []).filter(r => ACTIVE.includes(r.status));
  done = (data || []).filter(r => r.status === "picked_up").sort((a, b) => (b.picked_up_at || "").localeCompare(a.picked_up_at || "")).slice(0, 8);
  render();
}

function render() {
  const g = gateFilter();
  const list = requests.filter(r => !g || r.gate === g);
  const newest = list.reduce((m, r) => Math.max(m, r.id), 0);
  const board = document.getElementById("board");
  board.innerHTML = list.map(r => `
    <article class="card${r.id === newest ? " newest" : ""}">
      <div class="name">${esc(r.student_name)}</div>
      <div class="label">${esc(r.student_label || "")}</div>
      <div class="meta"><span class="gate">البوابة ${esc(r.gate)}</span>
        <span class="status ${esc(r.status)}">${esc(STATUS_AR[r.status] || r.status)}</span>
        <span>${esc(ago(r.requested_at))}</span>${r.source === "manual" ? "<span>· نداء يدوي</span>" : ""}</div>
      ${canAct() ? `<div class="actions">
        ${r.status !== "released" ? `<button class="btn brass" data-onclick="g3" data-g3a0="${r.id}" data-g3a1="released">خرج الطالب</button>` : ""}
        <button class="btn mint" data-onclick="g3" data-g3a0="${r.id}" data-g3a1="picked_up">✓ تم التسليم</button></div>` : ""}
    </article>`).join("") || `<div class="empty">لا توجد نداءات الآن</div>`;
  document.getElementById("doneList").innerHTML = done.map(r =>
    `<div class="done"><span>${esc(r.student_name)}</span><span class="mono">${esc(clock(r.picked_up_at))}</span></div>`).join("")
    || `<div class="done"><span>—</span></div>`;
  if (newest > lastSeenMaxId && lastSeenMaxId) beep();
  lastSeenMaxId = Math.max(lastSeenMaxId, newest);
}

async function mark(id, status) {
  if (!canAct()) return;
  let { data, error } = await db.functions.invoke("pickup", { body: { action: "mark", request_id: Number(id), status } });
  if (error && error.name === "FunctionsHttpError") {
    let m = error.message;
    try { m = (await error.context.json()).error || m; } catch (_) { /* keep */ }
    return msg("msg", m, true);
  }
  if (error) {  // function unreachable → same RPC directly (no push to the guardian)
    ({ error } = await db.rpc("gate_mark", { p_request: Number(id), p_status: status }));
    if (error) return msg("msg", error.message, true);
  }
  msg("msg", status === "picked_up" ? "✓ تم التسليم" : "✓ خرج الطالب إلى البوابة");
  loadBoard();
}

async function search(q) {
  const box = document.getElementById("manualResults");
  if (q.trim().length < 2) { box.innerHTML = ""; return; }
  const { data, error } = await db.rpc("gate_search_students", { p_q: q.trim() });
  if (error) { box.innerHTML = `<div class="msg err">${esc(error.message)}</div>`; return; }
  box.innerHTML = (data || []).map(s => `<div class="result"><span>${esc(s.full_name)}
      <small style="color:var(--dim)">${esc([s.grade, s.class_name].filter(Boolean).join(" "))}</small></span>
      <button class="btn mint" data-onclick="g7" data-g7a0="${esc(s.id)}" ${s.has_active || !canAct() ? "disabled" : ""}>${s.has_active ? "نشط" : "📢 نداء"}</button></div>`).join("")
    || `<div class="result"><span style="color:var(--dim)">لا نتائج</span></div>`;
}

async function manualCall(studentId) {
  const { error } = await db.rpc("gate_manual_call", { p_student: studentId, p_gate: gateFilter() || null });
  if (error) return msg("msg", error.message, true);
  wakeTablets();
  document.getElementById("manualSearch").value = "";
  document.getElementById("manualResults").innerHTML = "";
  msg("msg", "✓ أُرسل النداء إلى التابلت");
  loadBoard();
}

// Expiry + one re-announce (also scheduled by pg_cron when available).
async function tick() {
  const { data } = await db.rpc("pickup_maintenance", { p_school: schoolId });
  if (data && (data.requeued > 0 || data.expired > 0)) { if (data.requeued > 0) wakeTablets(); loadBoard(); }
}

// ─── realtime + polling ───────────────────────────────────────────────────────
function subscribe() {
  db.channel("pickup:" + schoolId)
    .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests", filter: "school_id=eq." + schoolId },
      () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadBoard, 300); })
    .subscribe(status => {
      live = status === "SUBSCRIBED";
      document.getElementById("live").classList.toggle("on", live);
      document.getElementById("liveText").textContent = live ? "مباشر" : "تحديث دوري";
      schedulePoll();
      if (live) loadBoard();
    });
}
function schedulePoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(loadBoard, live ? POLL_LIVE_MS : POLL_OFFLINE_MS);
}
// Same "wake" broadcast the dashboard sends (index.js wakeTablets).
function wakeTablets() {
  try {
    const ch = db.channel("school:" + schoolId);
    ch.subscribe(s => { if (s === "SUBSCRIBED") { ch.send({ type: "broadcast", event: "wake", payload: {} }); setTimeout(() => db.removeChannel(ch), 1500); } });
  } catch (_) { /* tablets still poll */ }
}

// ─── ui helpers ───────────────────────────────────────────────────────────────
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new AudioContext();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.18);
  } catch (_) { /* autoplay blocked until the first click */ }
}
function msg(id, text, isErr) {
  const el = document.getElementById(id);
  el.textContent = text; el.className = "msg" + (isErr ? " err" : "");
  clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ""; }, 6000);
}
function clock(ts) { return ts ? new Date(ts).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : ""; }
function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  return m < 1 ? "الآن" : `منذ ${m} د`;
}
function esc(s) { return String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])); }
setInterval(() => { document.getElementById("clock").textContent = clock(new Date().toISOString()); }, 1000);
setInterval(() => { if (requests.length) render(); }, 30_000); // refresh "منذ … د"

// ─── delegated handlers (CSP: no inline on*=) ─────────────────────────────────
const _G = {
  g1() { login() },
  g2() { clearTimeout(searchTimer); const q = this.value; searchTimer = setTimeout(() => search(q), 250) },
  g3() { this.disabled = true; mark(this.dataset.g3a0, this.dataset.g3a1) },
  g4() { localStorage.setItem("meeqat.gate", this.value); render() },
  g5() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.() },
  async g6() { await db.auth.signOut(); location.reload() },
  g7() { this.disabled = true; manualCall(this.dataset.g7a0) },
};
["click", "change", "input"].forEach(type => document.addEventListener(type, ev => {
  for (let el = ev.target; el && el !== document; el = el.parentElement) {
    const name = el.getAttribute && el.getAttribute("data-on" + type);
    if (name && _G[name]) { _G[name].call(el, ev); break; }
  }
}));
document.getElementById("password").addEventListener("keydown", e => { if (e.key === "Enter") login(); });

init();
