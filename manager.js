const SUPABASE_URL = "https://tcdknoalnynnbuvlozwy.supabase.co";
const SUPABASE_KEY = "sb_publishable_D0YQfRkraujKgNEVpSNKhw_YMvm2oB7";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DAY_MS = 86400000;
let schoolId = null, config = { v: 2, sections: [] }, configVersion = 0, tab = "home";
let me = null, myRole = "admin";
let logs = [], commands = [], curSec = -1;   // -1 = whole school (all sections)

function normalizeConfig(p) {
  const normSec = s => ({ id: s.id ?? null, name: s.name || "قسم", defaultSoundKey: s.defaultSoundKey || "bell1", schedules: Array.isArray(s.schedules) ? s.schedules : [] });
  const scenes = p && Array.isArray(p.scenes) ? p.scenes : [];
  if (p && Array.isArray(p.sections)) return { v: 2, sections: p.sections.map(normSec), scenes };
  const scheds = p && Array.isArray(p.schedules) ? p.schedules : [];
  return { v: 2, sections: [normSec({ name: "عام", schedules: scheds })], scenes };
}
function secObj() { return curSec >= 0 ? config.sections[curSec] : null; }
function multiSection() { return config.sections.length > 1; }

// ─── Auth ───────────────────────────────────────────────────────────────────
async function login() {
  const { error } = await db.auth.signInWithPassword({
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
  });
  if (error) return show("loginMsg", "فشل الدخول: " + error.message, true);
  init();
}
async function logout() { await db.auth.signOut(); location.reload(); }

async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return;
  // Scope to the signed-in user: super admins see all membership rows via RLS,
  // so an unscoped maybeSingle() errors on schools with more than one account.
  const { data: m } = await db.from("school_users")
    .select("school_id, role").eq("user_id", session.user.id).maybeSingle();
  if (!m) return show("loginMsg", "الحساب غير مرتبط بمدرسة.", true);
  schoolId = m.school_id;
  me = session.user; myRole = m.role || "admin";
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;
  await refresh();
  showTab("home");
}

async function refresh() {
  const [{ data: school }, { data: cfg }, { data: lg }, { data: cmd }] = await Promise.all([
    db.from("schools").select("name").maybeSingle(),
    db.from("school_configs").select("version, payload").maybeSingle(),
    db.from("device_logs").select("event_name, planned_at, executed_at, status").order("planned_at", { ascending: false }).limit(60),
    db.from("commands").select("type, payload, created_at, delivered_at").order("id", { ascending: false }).limit(15),
  ]);
  document.getElementById("schoolName").textContent = school?.name || "—";
  configVersion = cfg?.version || 0;
  config = normalizeConfig(cfg?.payload);
  if (!multiSection()) curSec = 0;                       // single section → scope to it
  if (curSec >= config.sections.length) curSec = -1;
  logs = lg || []; commands = cmd || [];
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long" });
  const s = secObj();
  const active = s ? (s.schedules.find(x => x.isActive) || s.schedules[0]) : null;
  document.getElementById("todayLine").textContent = fmt.format(now) +
    (s ? " · " + s.name : "") + (active ? " · " + active.name : "");
}

// Section chips shown atop each tab (only when the school has more than one).
function sectionChips() {
  if (!multiSection()) return "";
  const chip = (label, idx) => `<span class="pill${curSec === idx ? " active" : ""}" data-onclick="h9" data-h9a0="${esc(JSON.stringify(idx))}">${esc(label)}</span>`;
  return `<div class="row" style="gap:8px; flex-wrap:wrap; margin-bottom:2px;">${chip("كل المدرسة", -1)}${config.sections.map((s, i) => chip(s.name, i)).join("")}</div>`;
}
function pickSection(i) { curSec = i; showTab(tab); }

// ─── Schedule maths (mirrors the app) ───────────────────────────────────────
function activeEvents() {
  const secs = curSec >= 0 ? [config.sections[curSec]] : config.sections;
  const isoDow = ((new Date().getDay() + 6) % 7); // 0=Mon..6=Sun
  return secs.filter(Boolean).flatMap(sc => {
    const s = (sc.schedules || []).find(x => x.isActive) || (sc.schedules || [])[0];
    return (s?.events || []).filter(e => e.enabled !== false && (e.daysOfWeek & (1 << isoDow)));
  }).sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay);
}
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function hhmm(min) { return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }
function logStatusFor(name) {
  const l = logs.find(x => x.event_name === name);
  return l ? l.status : null;
}

// ─── Tabs ───────────────────────────────────────────────────────────────────
function showTab(name) {
  tab = name;
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  const c = document.getElementById("content");
  c.scrollTop = 0;
  if (name === "home") c.innerHTML = renderHome();
  else if (name === "announce") { c.innerHTML = renderAnnounce(); }
  else if (name === "schedules") c.innerHTML = renderSchedules();
  else if (name === "log") c.innerHTML = renderLog();
  else if (name === "devices") { c.innerHTML = renderTuyaDevices(); loadTuyaDevices(); }
  else if (name === "account") { c.innerHTML = renderAccount(); loadAccount(); }
}

// ─── Smart devices (Tuya) — control from the manager's phone ─────────────────
let tuyaDevices = [];
const TUYA_CATS = { light: "إنارة", curtain: "ستارة", switch: "مفتاح/مقبس", sensor: "حسّاس", lock: "قفل", thermostat: "منظّم حرارة", panel: "لوحة تحكم", other: "جهاز آخر" };
async function loadTuyaDevices() {
  const { data } = await db.from("tuya_devices").select("id,name,category,section_id,online").order("sort_order");
  tuyaDevices = data || [];
  const el = document.getElementById("tuyaBox"); if (el) el.innerHTML = tuyaDevicesHtml();
}
function tuyaSectionName(sid) { if (!sid) return "عام"; const s = config.sections.find(x => x.id === sid); return s ? s.name : "قسم"; }
function tuyaVisible() {
  // Respect the section chip selection: -1 = whole school shows all.
  if (curSec < 0) return tuyaDevices;
  const sid = config.sections[curSec] && config.sections[curSec].id;
  return tuyaDevices.filter(d => d.section_id === sid || !d.section_id);
}
function renderTuyaDevices() {
  return `<div class="card">${curSec >= 0 || multiSection() ? sectionChips() : ""}
    <h2 style="margin:6px 0">الأجهزة الذكية</h2>
    <p class="muted" style="margin:0 0 8px">تحكّم بالإنارة والستائر وأجهزة القسم. تُنفَّذ فورًا على تابلت القسم.</p>
    <div id="tuyaBox">جارٍ التحميل…</div>
    <p class="muted" id="tuyaMsg"></p></div>
    ${(config.scenes || []).length ? `<div class="card"><h2 style="margin:0 0 8px">المشاهد</h2><div id="sceneBox">${scenesHtml()}</div></div>` : ""}`;
}
function tuyaDevicesHtml() {
  const list = tuyaVisible();
  if (!list.length) return '<p class="muted">لا توجد أجهزة' + (tuyaDevices.length ? " في هذا القسم." : " بعد.") + '</p>';
  return list.map(d => {
    let ctl = "";
    if (d.category === "curtain") ctl = `<button class="btn-tonal" data-onclick="h10" data-h10a0="${esc(d.id)}">فتح</button>
      <button class="btn-tonal" data-onclick="h11" data-h11a0="${esc(d.id)}">إيقاف</button>
      <button class="btn-tonal" data-onclick="h12" data-h12a0="${esc(d.id)}">إغلاق</button>`;
    else if (d.category === "light" || d.category === "switch") ctl = `<button class="btn-primary" data-onclick="h13" data-h13a0="${esc(d.id)}">تشغيل</button>
      <button class="btn-tonal" data-onclick="h14" data-h14a0="${esc(d.id)}">إطفاء</button>`;
    else ctl = `<span class="muted">— يُدار من لوحة المدرسة —</span>`;
    return `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border);gap:8px;flex-wrap:wrap;align-items:center">
      <span style="flex:1;min-width:130px"><b>${esc(d.name)}</b> <span class="muted">· ${tuyaSectionName(d.section_id)}</span></span>${ctl}</div>`;
  }).join("");
}
function scenesHtml() {
  return (config.scenes || []).map(sc => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border);gap:8px;align-items:center">
    <span style="flex:1"><b>${esc(sc.name)}</b> <span class="muted">· ${(sc.actions || []).length} إجراء</span></span>
    <button class="btn-primary" data-onclick="h15" data-h15a0="${esc(sc.id)}">تشغيل</button></div>`).join("");
}
async function tuyaCtl(id, action, value) {
  const dev = tuyaDevices.find(x => x.id === id);
  const { error } = await db.from("commands").insert({ school_id: schoolId, type: "device",
    payload: { tuyaDeviceId: id, action, value: value ?? null }, section_id: dev?.section_id ?? null });
  if (!error) wakeTablets(schoolId);
  const m = document.getElementById("tuyaMsg"); if (m) m.textContent = error ? "فشل: " + error.message : "✓ أُرسل الأمر إلى التابلت";
}
async function runScene(id) {
  const sc = (config.scenes || []).find(x => x.id === id); if (!sc) return;
  let ok = 0;
  for (const a of (sc.actions || [])) {
    const dev = tuyaDevices.find(x => x.id === a.tuyaDeviceId);
    const { error } = await db.from("commands").insert({ school_id: schoolId, type: "device",
      payload: { tuyaDeviceId: a.tuyaDeviceId, action: a.action, value: a.value ?? null }, section_id: dev?.section_id ?? null });
    if (!error) ok++;
  }
  wakeTablets(schoolId);
  const m = document.getElementById("tuyaMsg"); if (m) m.textContent = `✓ «${sc.name}»: ${ok} إجراء`;
}

function renderAccount() {
  return `<div class="card" style="display:flex;flex-direction:column;gap:14px;max-width:520px">
    <h2 style="margin:0">حسابي</h2>
    <div class="row"><label class="muted" style="width:120px">البريد</label><span id="accEmail"></span></div>
    <div class="row"><label class="muted" style="width:120px">الدور</label><span id="accRole"></span></div>
    <label class="muted">الاسم الكامل</label><input id="accName" placeholder="اسمك الكامل">
    <label class="muted">رقم الجوال</label><input id="accPhone" dir="ltr" placeholder="05xxxxxxxx">
    <button class="btn-primary" data-onclick="h16">حفظ البيانات</button>
    <hr style="border:none;border-top:1px solid var(--line);margin:4px 0">
    <h2 style="margin:0;font-size:16px">تغيير كلمة المرور</h2>
    <input id="accPw1" type="password" dir="ltr" placeholder="كلمة مرور جديدة (6 أحرف على الأقل)">
    <input id="accPw2" type="password" dir="ltr" placeholder="تأكيد كلمة المرور">
    <button class="btn-primary" data-onclick="h17">تحديث كلمة المرور</button>
    <p class="muted" id="accMsg"></p>
  </div>`;
}
async function loadAccount() {
  document.getElementById("accEmail").textContent = me?.email || "";
  document.getElementById("accRole").textContent = myRole === "admin" ? "مدير المدرسة" : "مشاهد";
  const { data } = await db.from("profiles").select("full_name, phone").eq("user_id", me.id).maybeSingle();
  if (data) { document.getElementById("accName").value = data.full_name || ""; document.getElementById("accPhone").value = data.phone || ""; }
}
async function saveProfile() {
  const full_name = document.getElementById("accName").value.trim();
  const phone = document.getElementById("accPhone").value.trim();
  const { error } = await db.from("profiles").upsert({ user_id: me.id, full_name, phone, updated_at: new Date().toISOString() });
  document.getElementById("accMsg").textContent = error ? "فشل: " + error.message : "✓ حُفظت بياناتك.";
}
async function changePassword() {
  const p1 = document.getElementById("accPw1").value, p2 = document.getElementById("accPw2").value;
  const msg = document.getElementById("accMsg");
  if (p1.length < 6) { msg.textContent = "كلمة المرور 6 أحرف على الأقل."; return; }
  if (p1 !== p2) { msg.textContent = "كلمتا المرور غير متطابقتين."; return; }
  const { error } = await db.auth.updateUser({ password: p1 });
  msg.textContent = error ? "فشل: " + error.message : "✓ تم تحديث كلمة المرور.";
  if (!error) { document.getElementById("accPw1").value = ""; document.getElementById("accPw2").value = ""; }
}

function renderHome() {
  const evs = activeEvents();
  const nm = nowMin();
  let curIdx = -1;
  for (let i = 0; i < evs.length; i++) {
    const end = evs[i].durationMin ? evs[i].startMinuteOfDay + evs[i].durationMin
      : (evs[i + 1]?.startMinuteOfDay ?? evs[i].startMinuteOfDay + 45);
    if (nm >= evs[i].startMinuteOfDay && nm < end) { curIdx = i; }
  }
  const cur = evs[curIdx];
  let ring = "", curName = "لا حصة جارية", curSub = "";
  if (cur) {
    const end = cur.durationMin ? cur.startMinuteOfDay + cur.durationMin : (evs[curIdx + 1]?.startMinuteOfDay ?? cur.startMinuteOfDay + 45);
    const total = end - cur.startMinuteOfDay, elapsed = nm - cur.startMinuteOfDay;
    const deg = Math.max(0, Math.min(360, 360 * (1 - elapsed / total)));
    const rem = end - nm;
    ring = `background:conic-gradient(var(--green) 0deg ${deg}deg, var(--border) ${deg}deg 360deg);`;
    curName = cur.name; curSub = `متبقٍ ${rem} د`;
  } else {
    ring = "background:var(--border);";
    const next = evs.find(e => e.startMinuteOfDay > nm);
    curSub = next ? `التالي: ${next.name} · ${hhmm(next.startMinuteOfDay)}` : "انتهى اليوم";
  }
  const rows = evs.map(e => {
    const st = logStatusFor(e.name);
    const isNow = e === cur;
    let tag = `<span class="tag-dim">قادم</span>`;
    if (isNow) tag = `<span class="tag-green">جارية</span>`;
    else if (st === "EXECUTED") tag = `<span class="tag-green">نُفّذ</span>`;
    else if (st === "SILENCED") tag = `<span class="tag-amber">إسكات</span>`;
    else if (e.startMinuteOfDay < nm) tag = `<span class="tag-dim">فات</span>`;
    return `<div class="evt${isNow ? " now" : ""}"><span class="t mono">${hhmm(e.startMinuteOfDay)}</span><span style="flex:1; font-size:15px;">${esc(e.name)}</span>${tag}</div>`;
  }).join("");
  return `
    ${sectionChips()}
    <div class="card row" style="gap:18px;">
      <div class="ring" style="${ring}"><div><span class="big mono">${cur ? hhmm(evs[curIdx].durationMin ? (evs[curIdx].startMinuteOfDay + evs[curIdx].durationMin - nm) : 45).replace(/^0/, "") : "—"}</span><span class="muted" style="font-size:11px;">المتبقي</span></div></div>
      <div style="display:flex; flex-direction:column; gap:5px;">
        <span class="muted">الحصة الجارية</span>
        <span style="font-size:22px; font-weight:600;">${esc(curName)}</span>
        <span class="tag-green">${esc(curSub)}</span>
      </div>
    </div>
    <div class="row">
      <button class="btn-primary" data-onclick="h18">الجرس الآن</button>
      <button class="btn-tonal" data-onclick="h4">نداء</button>
    </div>
    <div class="msg" id="msg"></div>
    <span class="muted">مسار اليوم</span>
    <div style="display:flex; flex-direction:column; gap:8px;">${rows || '<span class="muted">لا أحداث اليوم</span>'}</div>
  `;
}

function renderAnnounce() {
  const dest = curSec >= 0 ? config.sections[curSec].name : "كل المدرسة";
  return `
    ${sectionChips()}
    ${multiSection() ? `<div class="muted">الوجهة: <b style="color:var(--green)">${esc(dest)}</b></div>` : ""}
    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <h2>نص النداء</h2>
      <textarea id="annText" rows="3" placeholder="يُنطق بالصوت العربي على مكبرات المدرسة…"></textarea>
      <div class="row" id="delayRow" style="gap:8px;">
        <span class="pill active" data-d="0" data-onclick="h19">الآن</span>
        <span class="pill" data-d="5" data-onclick="h19">5 د</span>
        <span class="pill" data-d="15" data-onclick="h19">15 د</span>
      </div>
      <button class="btn-send" data-onclick="h20">إرسال النداء</button>
    </div>
    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <h2>قوالب جاهزة</h2>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${["اصطفاف الطابور","انصراف مبكر","اجتماع معلمين","تنبيه إخلاء"].map(t =>
          `<span class="chip" data-onclick="h21" data-h21a0="${esc(t)}">${t}</span>`).join("")}
      </div>
    </div>
    <div class="card" style="display:flex; flex-direction:column; gap:8px;">
      <h2>آخر الأوامر</h2>
      ${commands.length ? commands.map(c => {
        const label = c.type === "bell" ? "🔔 جرس فوري" : "📢 " + esc(c.payload?.text || "نداء");
        const st = c.delivered_at ? `<span class="tag-green">وصل ✓</span>` : `<span class="tag-amber">بانتظار التابلت…</span>`;
        return `<div class="row" style="padding:6px 0; border-bottom:1px solid var(--border);"><span style="flex:1; font-size:14px;">${label}</span>${st}</div>`;
      }).join("") : '<span class="muted">لا أوامر بعد</span>'}
    </div>
    <div class="msg" id="msg"></div>
  `;
}

function renderSchedules() {
  if (curSec < 0 && multiSection()) {
    return `${sectionChips()}<div class="card"><span class="muted">اختر قسمًا لتبديل جداوله وإزاحة أوقاته.</span></div>`;
  }
  const s0 = secObj() || config.sections[0];
  const rows = (s0.schedules || []).map(s => `
    <div class="evt${s.isActive ? " now" : ""}" data-onclick="h22" data-h22a0="${esc(s.name)}">
      <span style="flex:1; font-size:16px; font-weight:${s.isActive ? 600 : 400};">${esc(s.name)}</span>
      ${s.isActive ? '<span class="tag-green">نشط</span>' : `<span class="tag-dim">${(s.events||[]).length} حدثًا</span>`}
    </div>`).join("");
  return `
    ${sectionChips()}
    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <h2>تبديل الجدول النشط${multiSection() ? " · " + esc(s0.name) : ""}</h2>
      <div style="display:flex; flex-direction:column; gap:8px;">${rows || '<span class="muted">لا جداول</span>'}</div>
    </div>
    <div class="card" style="display:flex; flex-direction:column; gap:12px;">
      <h2>إزاحة أوقات الجدول النشط</h2>
      <div class="row">
        <button class="chip" style="width:48px; font-size:22px;" data-onclick="h23">−</button>
        <span style="flex:1; text-align:center; font-size:22px; font-weight:600;" class="mono" id="shiftVal">+0 د</span>
        <button class="chip" style="width:48px; font-size:22px;" data-onclick="h24">+</button>
      </div>
      <button class="btn-ghost" data-onclick="h25">تطبيق الإزاحة</button>
      <span class="muted">تُطبَّق على كل أحداث الجدول النشط وتُنشر للتابلت.</span>
    </div>
    <div class="msg" id="msg"></div>
  `;
}

function renderLog() {
  const rows = logs.slice(0, 40).map(l => {
    const t = new Date(l.planned_at);
    const time = new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(t);
    const drift = l.executed_at ? (new Date(l.executed_at) - t) + " ms" : "—";
    const cls = l.status === "EXECUTED" ? "tag-green" : l.status === "SILENCED" ? "tag-amber" : "tag-dim";
    return `<div class="evt"><span style="flex:1; font-size:14px;">${esc(l.event_name)}</span><span class="muted mono" style="margin-inline-end:8px;">${time}</span><span class="${cls}">${esc(l.status)}</span></div>`;
  }).join("");
  return `<span class="muted">سجل التنفيذ (آخر 40)</span><div style="display:flex; flex-direction:column; gap:8px;">${rows || '<span class="muted">لا سجل بعد</span>'}</div>`;
}

// ─── Actions ────────────────────────────────────────────────────────────────
let delayMin = 0, shiftMin = 0;
function pickDelay(el) {
  document.querySelectorAll("#delayRow .pill").forEach(p => p.classList.remove("active"));
  el.classList.add("active"); delayMin = +el.dataset.d;
}
function fillTpl(t) { const ta = document.getElementById("annText"); ta.value = t; ta.focus(); }
function bumpShift(d) { shiftMin += d; document.getElementById("shiftVal").textContent = (shiftMin >= 0 ? "+" : "") + shiftMin + " د"; }

function cmdTarget() { return curSec >= 0 ? (config.sections[curSec].id || null) : null; }
async function sendBell() {
  const { error } = await db.from("commands").insert({ school_id: schoolId, type: "bell", payload: {}, section_id: cmdTarget() });
  if (!error) wakeTablets(schoolId);
  await refresh();
  toast(error ? "فشل: " + error.message : "✓ أُرسل أمر الجرس", !!error);
}
// Nudge the school's tablets to sync immediately (instant remote command).
function wakeTablets(sid) {
  try {
    const ch = db.channel("school:" + sid);
    ch.subscribe(s => {
      if (s === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event: "wake", payload: {} });
        setTimeout(() => db.removeChannel(ch), 1500);
      }
    });
  } catch (_) { /* realtime optional; the 25s poll still delivers */ }
}
async function sendAnnounce() {
  const text = document.getElementById("annText").value.trim();
  if (!text) return toast("اكتب نص النداء أولًا", true);
  const { error } = await db.from("commands").insert({ school_id: schoolId, type: "announce", payload: { text, delay: delayMin }, section_id: cmdTarget() });
  if (!error) { wakeTablets(schoolId); document.getElementById("annText").value = ""; }
  await refresh(); showTab("announce");
  toast(error ? "فشل: " + error.message : "✓ أُرسل النداء", !!error);
}
async function activateSchedule(name) {
  const s0 = secObj() || config.sections[0];
  (s0.schedules || []).forEach(s => s.isActive = s.name === name);
  await publishConfig("✓ تم تفعيل: " + name);
}
async function applyShift() {
  if (shiftMin === 0) return toast("لا إزاحة", true);
  const s0 = secObj() || config.sections[0];
  const s = (s0.schedules || []).find(x => x.isActive);
  if (!s) return toast("لا جدول نشط", true);
  s.events = (s.events || []).map(e => ({ ...e, startMinuteOfDay: Math.max(0, Math.min(1439, e.startMinuteOfDay + shiftMin)) }));
  const applied = shiftMin; shiftMin = 0;
  await publishConfig(`✓ أُزيحت الأوقات ${applied >= 0 ? "+" : ""}${applied} د ونُشرت`);
}
async function publishConfig(okMsg) {
  const { error } = await db.from("school_configs")
    .update({ payload: config, version: configVersion + 1, updated_at: new Date().toISOString() })
    .eq("school_id", schoolId);
  if (!error) configVersion++;
  await refresh(); showTab("schedules");
  toast(error ? "فشل: " + error.message : okMsg, !!error);
}

function toast(text, isError) {
  const el = document.getElementById("msg");
  if (!el) return;
  el.textContent = text; el.className = "msg " + (isError ? "err" : "ok");
  setTimeout(() => { if (el) el.className = "msg"; }, 5000);
}
function show(id, text, isError) {
  const el = document.getElementById(id);
  el.textContent = text; el.className = "msg " + (isError ? "err" : "ok");
}
function esc(s) { return String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])); }

init();

// ─── Delegated event handlers (replaces inline on*="" attributes for CSP) ───
function _hv(v) { if (v === undefined) return undefined; try { return JSON.parse(v); } catch (_) { return v; } }
const _H = {
  h1(event) { login() },
  h2(event) { logout() },
  h3(event) { showTab('home') },
  h4(event) { showTab('announce') },
  h5(event) { showTab('schedules') },
  h6(event) { showTab('devices') },
  h7(event) { showTab('log') },
  h8(event) { showTab('account') },
  h9(event) { pickSection(_hv(this.dataset.h9a0)) },
  h10(event) { tuyaCtl(this.dataset.h10a0,'open') },
  h11(event) { tuyaCtl(this.dataset.h11a0,'stop') },
  h12(event) { tuyaCtl(this.dataset.h12a0,'close') },
  h13(event) { tuyaCtl(this.dataset.h13a0,'on') },
  h14(event) { tuyaCtl(this.dataset.h14a0,'off') },
  h15(event) { runScene(this.dataset.h15a0) },
  h16(event) { saveProfile() },
  h17(event) { changePassword() },
  h18(event) { sendBell() },
  h19(event) { pickDelay(this) },
  h20(event) { sendAnnounce() },
  h21(event) { fillTpl(this.dataset.h21a0) },
  h22(event) { activateSchedule(this.dataset.h22a0) },
  h23(event) { bumpShift(-5) },
  h24(event) { bumpShift(5) },
  h25(event) { applyShift() }
};
["click", "change", "input"].forEach(type => document.addEventListener(type, ev => {
  for (let el = ev.target; el && el !== document; el = el.parentElement) {
    const name = el.getAttribute && el.getAttribute("data-on" + type);
    if (!name || !_H[name]) continue;
    if (_H[name].call(el, ev) === false) ev.preventDefault();
    if (ev.cancelBubble) break;
  }
}));
