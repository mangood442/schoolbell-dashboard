const SUPABASE_URL = "https://meeqat-api.tripleodoo.com";
const SUPABASE_KEY = "sb_publishable_D0YQfRkraujKgNEVpSNKhw_YMvm2oB7";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DAY_NAMES = ["اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت", "أحد"]; // ISO: bit 0 = الاثنين
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];                 // عرضًا: الأحد أولاً
const SOUNDS = { bell1: "جرس كهربائي", bell2: "جرس برونزي", bell3: "لحن ترحيبي", bell4: "دينغ دونغ", bell5: "غونغ هادئ" };

// Cloud sound library (shared demo + this school's uploads). Event/adhan sound
// keys reference a library entry as "url:<publicUrl>".
let library = [];
const libKey = l => "url:" + l.url;
function soundName(key) {
  if (!key) return "الافتراضي";
  if (SOUNDS[key]) return SOUNDS[key];
  if (key.startsWith("url:")) return (library.find(l => libKey(l) === key) || {}).name || "صوت من المكتبة";
  return key;
}
function fillSoundSelect(sel, selected) {
  sel.innerHTML = "";
  Object.entries(SOUNDS).forEach(([k, v]) => sel.add(new Option(v, k)));
  if (library.length) {
    const og = document.createElement("optgroup"); og.label = "مكتبة الأصوات";
    library.forEach(l => og.appendChild(new Option(l.name, libKey(l))));
    sel.appendChild(og);
  }
  if (selected && !SOUNDS[selected] && !library.some(l => libKey(l) === selected)) sel.add(new Option(selected, selected));
  sel.value = selected;
}
function soundOptionsHTML(selected) {
  let h = Object.entries(SOUNDS).map(([k, v]) => `<option value="${k}" ${selected === k ? "selected" : ""}>${v}</option>`).join("");
  if (library.length) h += `<optgroup label="مكتبة الأصوات">` +
    library.map(l => `<option value="${esc(libKey(l))}" ${selected === libKey(l) ? "selected" : ""}>${esc(l.name)}</option>`).join("") + `</optgroup>`;
  return h;
}
const ADHAN_METHODS = { UMM_AL_QURA: "أم القرى (السعودية)", MUSLIM_WORLD_LEAGUE: "رابطة العالم الإسلامي", EGYPTIAN: "الهيئة المصرية", KARACHI: "كراتشي", DUBAI: "دبي", QATAR: "قطر", KUWAIT: "الكويت" };
const CITIES = { "": "— اختر مدينة —", "مكة المكرمة": [21.3891, 39.8579], "الرياض": [24.7136, 46.6753], "جدة": [21.4858, 39.1925], "الدمام": [26.4207, 50.0888], "المدينة المنورة": [24.5247, 39.5692], "أبها": [18.2164, 42.5053], "تبوك": [28.3838, 36.5550] };
const PRAYER_NAMES = ["الفجر", "الظهر", "العصر", "المغرب", "العشاء"];
function defPrayer() { return { enabled: true, latitude: 24.7136, longitude: 46.6753, method: "UMM_AL_QURA", adhanMask: 0b11111, adhanSoundKey: "bell2", silenceAfterMin: 10 }; }

let schoolId = null, config = { v: 2, sections: [] }, configVersion = 0;
let me = null, myRole = "admin";
const canWrite = () => myRole === "admin" || myRole === "manager";
let curSection = 0, curSched = 0;
function sec() { return config.sections[curSection]; }
function secScheds() { return sec() ? sec().schedules : []; }

// ─── Auth ───────────────────────────────────────────────────────────────────
async function login() {
  const { error } = await db.auth.signInWithPassword({
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
  });
  if (error) return show("loginMsg", MQ.loginError(error), true);
  init();
}

async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return;
  me = session.user;
  // Scope to the signed-in user: super admins can see every membership row via
  // RLS, so without this filter maybeSingle() errors on multi-account schools.
  const { data: membership } = await db.from("school_users")
    .select("school_id, role").eq("user_id", session.user.id).maybeSingle();
  if (!membership) return showUnlinked();
  schoolId = membership.school_id;
  myRole = membership.role || "admin";
  applyRole();
  // Gate supervisors (ميقات – ولي الأمر) only use the gate board.
  if (myRole === "gate") { location.replace("./gate.html"); return; }

  const { data: school } = await db.from("schools").select("name, plan, subscription_until").maybeSingle();
  document.getElementById("schoolName").textContent =
    (school?.name || "") + (school?.subscription_until ? " — الاشتراك حتى " + school.subscription_until : "");

  document.getElementById("login").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("logoutBtn").style.display = "inline-block";
  document.getElementById("gateLink").style.display = "inline-block";
  await loadLibrary();
  await loadTuyaList();
  await loadConfig();
  loadLogs(); loadDevices(); loadCommands();
  if (typeof onboardingRefresh === "function") onboardingRefresh();   // ميقات v17: «ابدأ هنا» + الاشتراك
  if (typeof proInit === "function") proInit();                       // «ميقات برو» (plan feature `pro`)
}

document.getElementById("logoutBtn").onclick = async () => { await db.auth.signOut(); location.reload(); };

// ─── Config normalization (v2 sections; keeps scenes + cloud calendar) — common.js ──
function normalizeConfig(p) { return MQ.normalizeConfig(p); }

// ─── Role-aware UI (MQ-UX-08): viewers see everything, can change nothing ────
function applyRole() {
  const ro = !canWrite();
  document.body.classList.toggle("ro", ro);
  const b = document.getElementById("roBanner"); if (b) b.hidden = !ro;
  if (ro) lockReadOnly(document.getElementById("app"));
}
function lockReadOnly(root) {
  if (canWrite() || !root) return;
  root.querySelectorAll("section input, section select, section textarea, section button").forEach(el => {
    if (el.closest("[data-ro-ok]") || el.hasAttribute("data-ro-ok")) return;
    if (el.tagName === "BUTTON" && /^(تحديث|إغلاق|تم)$/.test(el.textContent.trim())) return;
    if (el.tagName === "BUTTON" && (el.classList.contains("sched-pill") || el.classList.contains("sec-pill"))) return;
    if (el.type === "file") return;
    el.disabled = true;
    if (el.tagName === "BUTTON") el.title = "للعرض فقط — اطلب التعديل من مدير الحساب";
  });
}
new MutationObserver(() => { if (document.body.classList.contains("ro")) lockReadOnly(document.getElementById("app")); })
  .observe(document.getElementById("app"), { childList: true, subtree: true });

async function loadConfig() {
  const { data } = await db.from("school_configs").select("version, payload").maybeSingle();
  configVersion = data?.version || 0;
  config = normalizeConfig(data?.payload);
  if (config.sections.length === 0) config.sections.push({ id: null, name: "عام", defaultSoundKey: "bell1", schedules: [] });
  config.sections.forEach(s => { if (s.schedules.length === 0) s.schedules.push({ name: "صباحي", isActive: true, events: [] }); });
  curSection = 0; curSched = Math.max(0, secScheds().findIndex(s => s.isActive));
  renderSectionBar(); renderSchedules(); fillTargets();
}

// ─── Sections ─────────────────────────────────────────────────────────────────
function renderSectionBar() {
  const bar = document.getElementById("sectionBar");
  bar.innerHTML = "";
  config.sections.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "sec-pill" + (i === curSection ? " active" : "");
    b.textContent = s.name;
    b.onclick = () => { curSection = i; curSched = Math.max(0, secScheds().findIndex(x => x.isActive)); renderSectionBar(); renderSchedules(); };
    bar.appendChild(b);
  });
  const add = document.createElement("button");
  add.className = "ghost"; add.innerHTML = MQ.icon("plus") + " قسم"; add.onclick = addSection; add.setAttribute("data-write", "");
  bar.appendChild(add);
  renderSectionMeta();
}
function renderSectionMeta() {
  const s = sec();
  const meta = document.getElementById("sectionMeta");
  if (!s) { meta.innerHTML = ""; return; }
  meta.innerHTML = "";
  const soundLabel = document.createElement("label"); soundLabel.className = "muted"; soundLabel.textContent = "الصوت الافتراضي للقسم:";
  const soundSel = document.createElement("select"); soundSel.id = "secDefSound"; soundLabel.htmlFor = "secDefSound";
  fillSoundSelect(soundSel, s.defaultSoundKey || "bell1");
  soundSel.onchange = () => { s.defaultSoundKey = soundSel.value; };
  const rename = document.createElement("button"); rename.className = "ghost"; rename.textContent = "تعديل اسم القسم"; rename.onclick = renameSection; rename.setAttribute("data-write", "");
  const del = document.createElement("button"); del.className = "ghost danger"; del.textContent = "حذف القسم"; del.onclick = deleteSection; del.setAttribute("data-write", "");
  const spacer = document.createElement("span"); spacer.style.flex = "1";
  meta.append(soundLabel, soundSel, spacer, rename, del);
}
async function addSection() {
  const name = prompt("اسم القسم الجديد (مثال: الابتدائي):");
  if (!name || !name.trim()) return;
  const { data, error } = await db.from("sections")
    .insert({ school_id: schoolId, name: name.trim(), sort_order: config.sections.length })
    .select("id").single();
  if (error) return show("msg", "فشل: " + MQ.err(error), true);
  config.sections.push({ id: data.id, name: name.trim(), defaultSoundKey: "bell1", prayer: null, schedules: [{ name: "صباحي", isActive: true, events: [] }] });
  curSection = config.sections.length - 1; curSched = 0;
  renderSectionBar(); renderSchedules(); fillTargets();
  saveConfig(true);
}
async function renameSection() {
  const s = sec(); const name = prompt("اسم القسم:", s.name);
  if (!name || !name.trim() || name.trim() === s.name) return;
  if (s.id) { const { error } = await db.from("sections").update({ name: name.trim() }).eq("id", s.id); if (error) return show("msg", "فشل: " + MQ.err(error), true); }
  s.name = name.trim(); renderSectionBar(); fillTargets(); saveConfig(true);
}
async function deleteSection() {
  if (config.sections.length <= 1) return show("msg", "يجب إبقاء قسم واحد على الأقل", true);
  const s = sec();
  if (s.id) {
    const { count } = await db.from("devices").select("id", { count: "exact", head: true }).eq("section_id", s.id);
    if (count) return show("msg", "لا يمكن حذف قسم مرتبط بأجهزة — أعد ربط الأجهزة أولًا", true);
  }
  if (!confirm(`حذف قسم "${s.name}" وكل جداوله؟`)) return;
  if (s.id) { const { error } = await db.from("sections").delete().eq("id", s.id); if (error) return show("msg", "فشل: " + MQ.err(error), true); }
  config.sections.splice(curSection, 1); curSection = 0; curSched = Math.max(0, secScheds().findIndex(x => x.isActive));
  renderSectionBar(); renderSchedules(); fillTargets(); saveConfig(true);
}

// ─── Schedules editor (scoped to the current section) ─────────────────────────
function renderSchedules() {
  const list = document.getElementById("schedList");
  list.innerHTML = "";
  secScheds().forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "sched-pill" + (i === curSched ? " active" : "");
    b.textContent = s.name + (s.isActive ? " ✓" : "") + (s.activeFrom && s.activeTo ? " · " + MQ.isoToSlash(s.activeFrom).slice(5) + "–" + MQ.isoToSlash(s.activeTo).slice(5) : "");
    b.onclick = () => { curSched = i; renderSchedules(); };
    list.appendChild(b);
  });
  renderMeta();
  renderEvents();
  renderPrayer();
}

// ─── Per-section prayer (adhan) ───────────────────────────────────────────────
function renderPrayer() {
  const box = document.getElementById("prayerBox");
  if (!box || !sec()) return;
  const p = sec().prayer;
  const head = `<div class="row" style="margin-bottom:10px"><h2 style="flex:1;margin:0"><i data-ic=moon></i> أذان القسم «${esc(sec().name)}»</h2>
    <label><input type="checkbox" ${p ? "checked" : ""} data-onchange="h26"> إعدادات أذان مستقلة لهذا القسم</label></div>`;
  if (!p) {
    box.innerHTML = head + `<p class="muted">هذا القسم يستخدم إعدادات الأذان المحفوظة على جهاز التابلت. فعّل الخيار أعلاه لضبط أذان خاص بهذا القسم يُنشر لأجهزته.</p>`;
    return;
  }
  const methodOpts = Object.entries(ADHAN_METHODS).map(([k, v]) => `<option value="${k}" ${p.method === k ? "selected" : ""}>${v}</option>`).join("");
  const cityOpts = Object.keys(CITIES).map(c => `<option value="${c}">${c || CITIES[c]}</option>`).join("");
  const soundOpts = soundOptionsHTML(p.adhanSoundKey);
  const prayerChecks = PRAYER_NAMES.map((n, i) => `<label style="white-space:nowrap"><input type="checkbox" ${(p.adhanMask & (1 << i)) ? "checked" : ""} data-onchange="h27" data-h27a0="${esc(JSON.stringify(i))}"> ${n}</label>`).join(" ");
  box.innerHTML = head + `
    <div class="row subtle" style="gap:14px;margin-bottom:10px">
      <label><input type="checkbox" ${p.enabled ? "checked" : ""} data-onchange="h28"> تفعيل الأذان</label>
      <label class="muted">المدينة</label><select data-onchange="h29"><option value="">— اختر —</option>${cityOpts}</select>
      <label class="muted">خط العرض</label><input type="number" step="0.0001" value="${p.latitude}" style="width:110px" data-onchange="h30">
      <label class="muted">خط الطول</label><input type="number" step="0.0001" value="${p.longitude}" style="width:110px" data-onchange="h31">
    </div>
    <div class="row" style="gap:14px;margin-bottom:10px">
      <label class="muted">طريقة الحساب</label><select data-onchange="h32">${methodOpts}</select>
      <label class="muted">صوت الأذان</label><select data-onchange="h33">${soundOpts}</select>
      <label class="muted">إسكات الجرس بعد الأذان (دقائق)</label><input type="number" min="0" max="60" value="${p.silenceAfterMin}" style="width:70px" data-onchange="h34">
    </div>
    <div class="row" style="gap:14px"><span class="muted">الصلوات المفعّلة:</span>${prayerChecks}</div>`;
}
function togglePrayer(on) { sec().prayer = on ? defPrayer() : null; renderPrayer(); }
function setPrayer(k, v) { if (sec().prayer) sec().prayer[k] = v; }
function togglePrayerBit(i, on) { const p = sec().prayer; if (!p) return; p.adhanMask = on ? (p.adhanMask | (1 << i)) : (p.adhanMask & ~(1 << i)); }
function pickCity(name) { const c = CITIES[name]; if (Array.isArray(c) && sec().prayer) { sec().prayer.latitude = c[0]; sec().prayer.longitude = c[1]; renderPrayer(); } }

function renderMeta() {
  const s = secScheds()[curSched];
  const meta = document.getElementById("schedMeta");
  meta.innerHTML = "";
  if (!s) return;
  const nameInp = inp(s.name, v => { s.name = v; renderSchedules(); }); nameInp.setAttribute("aria-label", "اسم الجدول");
  meta.append(
    field("الاسم", nameInp),
    checkbox("الجدول النشط (المعتاد)", s.isActive, v => {
      if (v) secScheds().forEach((x, i) => x.isActive = i === curSched);
      else s.isActive = false;
      renderSchedules();
    }),
    periodEditor(s),
  );
  const del = document.createElement("button");
  del.setAttribute("data-write", "");
  del.className = "ghost danger"; del.textContent = "حذف الجدول";
  del.onclick = () => { if (secScheds().length > 1 && confirm("حذف " + s.name + "؟")) { secScheds().splice(curSched, 1); curSched = 0; renderSchedules(); } };
  meta.appendChild(del);
}

function renderEvents() {
  const s = secScheds()[curSched];
  const body = document.querySelector("#eventsTable tbody");
  body.innerHTML = "";
  if (!s) return;
  s.events.sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay);
  if (!s.events.length) {
    body.innerHTML = `<tr><td colspan="9" class="muted" style="padding:18px 8px">لا توجد أحداث في هذا الجدول بعد. أضف حدثاً، أو استخدم «تعبئة جدول نموذجي» من بطاقة «ابدأ هنا».</td></tr>`;
    return;
  }
  s.events.forEach((e, i) => {
    const tr = document.createElement("tr"); tr.className = "ev";
    const nm = inp(e.name, v => e.name = v); nm.setAttribute("aria-label", "اسم الحدث");
    const dur = numInp(e.durationMin ?? "", v => e.durationMin = v === "" ? null : Math.max(0, +v || 0), 72);
    dur.className = "ev-num"; dur.setAttribute("aria-label", "المدة بالدقائق"); dur.min = 0; dur.max = 600; dur.inputMode = "numeric"; dur.dir = "ltr";
    const vol = numInp(Math.round((e.volume ?? 1) * 100), v => e.volume = Math.min(100, Math.max(0, +v || 0)) / 100, 72);
    vol.className = "ev-num"; vol.setAttribute("aria-label", "مستوى الصوت بالمئة"); vol.min = 0; vol.max = 100; vol.inputMode = "numeric"; vol.dir = "ltr";
    const en = checkbox("مفعّل", e.enabled !== false, v => e.enabled = v);
    const snd = soundSelect(e); snd.setAttribute("aria-label", "النغمة");
    const del = delBtn(() => { s.events.splice(i, 1); renderEvents(); }); del.setAttribute("aria-label", "حذف الحدث «" + (e.name || "") + "»"); del.setAttribute("data-write", "");
    tr.append(
      tdl("الوقت (24 ساعة)", timeInput(e), "c-time"),
      tdl("الاسم", nm, "c-name"),
      tdl("المدة (د)", dur, "c-dur"),
      tdl("الأيام", daysBoxes(e), "c-days"),
      tdl("النغمة", snd, "c-sound"),
      tdl("الصوت %", vol, "c-vol"),
      tdl("الحالة", en, "c-en"),
      tdl("أجهزة ذكية", deviceActionsBtn(e), "c-dev"),
      ...(window.PRO_ON && typeof proTargetCell === "function" ? [tdl("المناطق", proTargetCell(e), "c-days")] : []),   // «ميقات برو»
      tdl("", del, "c-act"),
    );
    body.appendChild(tr);
  });
}

function addEvent() {
  const s = secScheds()[curSched]; if (!s) return;
  s.events.push({
    name: "حدث جديد", startMinuteOfDay: 420, durationMin: 45,
    daysOfWeek: 0b1001111, volume: 1, enabled: true, sortOrder: 0, soundKey: "",
  });
  renderEvents();
}

function addSchedule() {
  const name = prompt("اسم الجدول الجديد:", "جدول جديد");
  if (!name) return;
  secScheds().push({ name, isActive: false, events: [] });
  curSched = secScheds().length - 1;
  renderSchedules();
}

async function saveConfig(silent) {
  if (!canWrite()) return show("msg", "صلاحيتك مشاهدة فقط — اطلب التعديل من مدير الحساب.", true);
  const bad = timeErrors(); if (bad) return show("msg", bad, true);
  config.sections.forEach(sc => { if (sc.schedules.length && !sc.schedules.some(s => s.isActive)) sc.schedules[0].isActive = true; });
  const { error } = await db.from("school_configs")
    .update({ payload: MQ.compileCalendar(config), version: configVersion + 1, updated_at: new Date().toISOString() })
    .eq("school_id", schoolId);
  if (error) return show("msg", "تعذّر الحفظ: " + MQ.err(error), true);
  configVersion += 1;
  wakeTablets(schoolId);          // realtime nudge → tablets pull now (25 s poll is the fallback)
  watchDelivery(configVersion);
  if (!silent) show("msg", "✓ حُفظ الإصدار " + configVersion + " — " + MQ.SYNC_SHORT + ". تابع «وصل للتابلت ✓» أعلى الجدول.");
}

function fillTargets() {
  const sel = document.getElementById("announceTarget");
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = `<option value="">كل المدرسة</option>` +
    config.sections.filter(s => s.id).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  sel.value = keep;
}

// ─── Logs / Announce / Devices ──────────────────────────────────────────────
async function loadLogs() {
  const { data } = await db.from("device_logs")
    .select("event_name, planned_at, executed_at, status, error")
    .order("planned_at", { ascending: false }).limit(200);
  document.getElementById("logsBody").innerHTML = (data || []).map(l => {
    const ms = l.executed_at ? (new Date(l.executed_at) - new Date(l.planned_at)) : null;
    const drift = ms == null ? "—" : (Math.abs(ms) < 1000 ? ms + " ملّي ث" : (ms / 1000).toFixed(1) + " ث");
    return `<tr><td>${esc(l.event_name)}</td><td dir="ltr" class="mono">${fmt(l.planned_at)}</td><td dir="ltr" class="mono">${drift}</td>
      <td class="status-${esc(l.status)}">${esc(MQ.statusAr(l.status))}</td><td>${esc(l.error ? MQ.arText(l.error) : "")}</td></tr>`;
  }).join("") || '<tr><td colspan="5" class="muted">لا توجد سجلات بعد — تظهر هنا بعد أول جرس يقرعه التابلت.</td></tr>';
}

function announceTarget() { return document.getElementById("announceTarget").value || null; }
function targetLabel() { const el = document.getElementById("announceTarget"); return el.value ? el.options[el.selectedIndex].text : "كل المدرسة"; }

async function sendAnnounce() {
  const text = document.getElementById("announceText").value.trim();
  if (!text) return;
  const delay = +document.getElementById("announceDelay").value || 0;
  const { error } = await db.from("commands").insert({ school_id: schoolId, type: "announce", payload: { text, delay }, section_id: announceTarget() });
  if (!error) wakeTablets(schoolId);
  show("msg", error ? "فشل: " + MQ.err(error) : "✓ أُرسل النداء إلى " + targetLabel(), !!error);
  loadCommands();
}

async function sendBell() {
  const { error } = await db.from("commands").insert({ school_id: schoolId, type: "bell", payload: {}, section_id: announceTarget() });
  if (!error) wakeTablets(schoolId);
  show("msg", error ? "فشل: " + MQ.err(error) : "✓ أُرسل أمر الجرس إلى " + targetLabel(), !!error);
  loadCommands();
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

async function loadCommands() {
  const { data } = await db.from("commands")
    .select("type, payload, created_at, delivered_at")
    .order("id", { ascending: false }).limit(20);
  document.getElementById("cmdBody").innerHTML = (data || []).map(c =>
    `<tr><td>${c.type === "bell" ? "<i data-ic=bell></i> جرس" : "<i data-ic=megaphone></i> " + esc(c.payload?.text || "")}</td>
     <td dir="ltr">${fmt(c.created_at)}</td>
     <td>${c.delivered_at ? "✓ وصل " + fmt(c.delivered_at) : "بانتظار التابلت…"}</td></tr>`
  ).join("") || '<tr><td colspan="3" class="muted">لم تُرسل أوامر بعد.</td></tr>';
}

async function fetchDevices() {
  let r = await db.from("devices").select("id, name, app_version, last_seen_at, section_id, config_delivered_version, config_delivered_at").order("last_seen_at", { ascending: false });
  if (r.error) r = await db.from("devices").select("id, name, app_version, last_seen_at, section_id").order("last_seen_at", { ascending: false });
  return r.data || [];
}
// Per-device delivery chip: «وصل الإصدار N ✓ 10:24:05» / waiting / offline (MQ-UX-01)
function deliveryChip(d, want) {
  const online = d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < 90000;
  const got = d.config_delivered_version;
  if (got != null && got >= want) return `<span class="sync-chip ok">${MQ.icon("check")} وصل الإصدار ${got} · ${MQ.time(d.config_delivered_at, true)}</span>`;
  if (!online) return `<span class="sync-chip off">${MQ.icon("wifi")} غير متصل — آخر اتصال ${esc(MQ.ago(d.last_seen_at))}؛ سيستلم التعديل عند عودته</span>`;
  return `<span class="sync-chip wait">${MQ.icon("clock")} بانتظار المزامنة${got != null ? " (لديه الإصدار " + got + ")" : ""}</span>`;
}
async function loadDevices() {
  const data = await fetchDevices();
  const opts = sel => `<option value="">كل المدرسة</option>` +
    config.sections.filter(s => s.id).map(s => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  document.getElementById("devicesBody").innerHTML = data.map(d =>
    `<tr><td>${esc(d.name)}</td>
      <td><select aria-label="قسم الجهاز ${esc(d.name)}" data-onchange="h35" data-h35a0="${esc(d.id)}">${opts(d.section_id)}</select></td>
      <td dir="ltr" class="mono">${esc(d.app_version || "—")}</td>
      <td>${esc(MQ.ago(d.last_seen_at))}</td>
      <td>${deliveryChip(d, configVersion)}</td>
      <td><button class="ghost" data-onclick="h36" data-h36a0="${esc(d.id)}" data-h36a1="${esc(JSON.stringify(d.name))}">تسمية</button></td></tr>`
  ).join("") || '<tr><td colspan="6" class="muted">لا أجهزة مرتبطة بعد. ثبّت تطبيق ميقات على التابلت وأدخل رمز التفعيل — <a href="/download.html" target="_blank" rel="noopener">تنزيل التطبيق</a>.</td></tr>';
  renderSyncStatus(data);
}
function renderSyncStatus(devs) {
  const el = document.getElementById("syncStatus"); if (!el) return;
  if (!devs.length) { el.innerHTML = `<span class="sync-chip off">${MQ.icon("tablet")} لا يوجد تابلت مرتبط بعد</span>`; return; }
  el.innerHTML = `<span class="muted">التسليم للأجهزة:</span>` + devs.map(d => `<span title="${esc(d.name)}">${esc(d.name)}: ${deliveryChip(d, configVersion)}</span>`).join("");
}
let _watch = null;
function watchDelivery(version) {
  clearInterval(_watch);
  const t0 = Date.now();
  const tick = async () => {
    const devs = await fetchDevices();
    renderSyncStatus(devs);
    const pending = devs.filter(d => d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < 90000 && !(d.config_delivered_version >= version));
    if (!pending.length || Date.now() - t0 > 75000) clearInterval(_watch);
  };
  tick(); _watch = setInterval(tick, 3000);
}
async function assignDevice(id, section) {
  const { error } = await db.rpc("set_device_section", { p_device: id, p_section: section || null });
  if (error) return show("msg", "فشل: " + MQ.err(error), true);
  show("msg", "✓ حُدّث قسم الجهاز");
}
async function renameDevice(id, currentName) {
  const name = prompt("اسم الجهاز:", currentName || "");
  if (!name || !name.trim()) return;
  const { error } = await db.rpc("set_device_name", { p_device: id, p_name: name.trim() });
  if (error) return show("msg", "فشل: " + MQ.err(error), true);
  loadDevices(); show("msg", "✓ حُدّث اسم الجهاز");
}

// ── Reports ──
async function loadReports() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: logs }, { data: devs }, { count: cmdCount }] = await Promise.all([
    db.from("device_logs").select("event_name, planned_at, executed_at, status").gte("planned_at", since).order("planned_at", { ascending: false }).limit(3000),
    db.from("devices").select("last_seen_at"),
    db.from("commands").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);
  const L = logs || [];
  const done = L.filter(l => l.status === "EXECUTED");
  const missed = L.filter(l => l.status === "MISSED" || l.status === "ERROR");
  const dayMs = 86400000, now = Date.now();
  const inLast = d => L.filter(l => (now - new Date(l.planned_at)) < d * dayMs && l.status === "EXECUTED").length;
  const drifts = done.map(l => l.executed_at ? Math.abs(new Date(l.executed_at) - new Date(l.planned_at)) : null).filter(v => v != null);
  const avgDrift = drifts.length ? Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length) : null;
  const rate = L.length ? Math.round(done.length / L.length * 100) : null;
  const lastSeen = (devs || []).map(d => d.last_seen_at).filter(Boolean).sort().slice(-1)[0];

  document.getElementById("repKpis").innerHTML = `
    <div class="kpi"><div class="l">أجراس اليوم</div><div class="n good">${inLast(1)}</div></div>
    <div class="kpi"><div class="l">آخر 7 أيام</div><div class="n">${inLast(7)}</div></div>
    <div class="kpi"><div class="l">نسبة الالتزام</div><div class="n ${rate!=null&&rate<90?"warn":"good"}">${rate==null?"—":rate+"%"}</div></div>
    <div class="kpi"><div class="l">متوسط الدقّة</div><div class="n">${avgDrift==null?"—":"±"+avgDrift}<span class="muted" style="font-size:14px">${avgDrift==null?"":" ملّي ث"}</span></div></div>
    <div class="kpi"><div class="l">أحداث فائتة/أخطاء</div><div class="n ${missed.length?"bad":"good"}">${missed.length}</div></div>
    <div class="kpi"><div class="l">نداءات مرسلة (30ي)</div><div class="n">${cmdCount||0}</div></div>
    <div class="kpi"><div class="l">إجمالي أحداث (30ي)</div><div class="n">${L.length}</div></div>
    <div class="kpi"><div class="l">آخر ظهور للتابلت</div><div class="n" style="font-size:15px">${lastSeen?fmt(lastSeen):"—"}</div></div>`;

  // Top events
  const byName = {};
  done.forEach(l => byName[l.event_name] = (byName[l.event_name] || 0) + 1);
  const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top.length ? top[0][1] : 1;
  document.getElementById("repEvents").innerHTML = top.length ? top.map(([n, c]) =>
    `<div style="margin:8px 0"><div class="row" style="justify-content:space-between"><span>${esc(n)}</span><b class="mono">${c}</b></div>
     <div class="bar"><span style="width:${Math.round(c/max*100)}%"></span></div></div>`).join("")
    : '<p class="muted">لا بيانات بعد</p>';

  // Daily activity (last 14 days)
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(now - i * dayMs); days.push(d.toISOString().slice(0, 10)); }
  const perDay = Object.fromEntries(days.map(d => [d, 0]));
  done.forEach(l => { const k = new Date(l.planned_at).toISOString().slice(0, 10); if (k in perDay) perDay[k]++; });
  const dmax = Math.max(1, ...Object.values(perDay));
  document.getElementById("repDaily").innerHTML =
    `<div class="row" style="align-items:flex-end;gap:6px;height:130px">` +
    days.map(d => { const v = perDay[d]; const h = Math.round(v / dmax * 110) + 2;
      return `<div style="flex:1;text-align:center" title="${d}: ${v}">
        <div style="background:var(--green);border-radius:6px 6px 0 0;height:${h}px"></div>
        <div class="muted" style="font-size:10px;margin-top:4px">${d.slice(8)}/${d.slice(5,7)}</div></div>`; }).join("") +
    `</div>`;
}

// ── Backup / restore (scoped to the current section) ──
function exportConfig() {
  const data = { section: sec().name, defaultSoundKey: sec().defaultSoundKey, schedules: secScheds() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `section-${sec().name}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  show("msg", "✓ تم تصدير جداول القسم");
}
function importConfig(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const scheds = Array.isArray(data.schedules) ? data.schedules : null;
      if (!scheds) throw new Error("ملف غير صالح");
      if (!confirm(`استبدال جداول قسم "${sec().name}" بمحتوى الملف؟ (لن يُحفظ إلا بعد ضغط "حفظ ونشر")`)) return;
      sec().schedules = scheds.length ? scheds : [{ name: "صباحي", isActive: true, events: [] }];
      if (data.defaultSoundKey) sec().defaultSoundKey = data.defaultSoundKey;
      curSched = Math.max(0, secScheds().findIndex(s => s.isActive));
      renderSectionBar(); renderSchedules();
      show("msg", "✓ استوردت جداول القسم — راجعها ثم اضغط \"حفظ ونشر\" للتطبيق");
    } catch (e) { show("msg", "تعذّر الاستيراد: " + MQ.err(e), true); }
  };
  reader.readAsText(file);
  document.getElementById("importFile").value = "";
}

// ─── UI helpers ─────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  ["schedules", "calendar", "reports", "logs", "announce", "devices", "sounds", "smart", "students", "pickup", "notices", "billing", "account",
   "pa_zones", "pa_devices", "pa_sched", "pa_emergency", "pa_streams", "pa_inputs"].forEach(t => {   // pa_* = «ميقات برو»
    const el = document.getElementById("tab-" + t); if (el) el.style.display = t === name ? "block" : "none"; });
  if (typeof proShowTab === "function") proShowTab(name);
  if (name === "reports") loadReports();
  if (name === "logs") loadLogs();
  if (name === "devices") loadDevices();
  if (name === "calendar") renderCalendar();
  if (name === "announce") loadCommands();
  if (name === "sounds") renderLibrary();
  if (name === "smart") loadTuya();
  if (name === "account") loadAccount();
  if (name === "students") loadStudents();
  if (name === "pickup") loadPickupSettings();
  if (name === "notices") loadNotices();
  if (name === "billing" && typeof renderBilling === "function") renderBilling();
}

// ─── Smart devices (Tuya) ───────────────────────────────────────────────────
let tuyaDevices = [];
const TUYA_CATS = { light: "إنارة", curtain: "ستارة", switch: "مفتاح/مقبس", sensor: "حسّاس", lock: "قفل", thermostat: "منظّم حرارة", panel: "لوحة تحكم", other: "جهاز آخر" };
const TUYA_BASIC = ["light", "curtain", "switch"];
const TUYA_DP_TEMPLATES = {
  light: '{"switch":"20","bright":"22","temp":"23"}',
  curtain: '{"control":"1","percent":"2","position":"3"}',
  switch: '{"switch":"1"}',
  sensor: '{}', lock: '{}', thermostat: '{}', panel: '{}', other: '{}'
};
async function loadTuyaList() {
  const { data } = await db.from("tuya_devices")
    .select("id,name,category,tuya_device_id,ip,protocol_version,dp_map,section_id,online,last_seen_at")
    .order("sort_order");
  tuyaDevices = data || [];
}
async function loadTuya() { await loadTuyaList(); window._tabletUp = await tabletOnline(); fillTuyaFilter(); renderTuya(); renderScenes(); }
function tuyaSectionName(sid) { if (!sid) return "عام (كل المدرسة)"; const s = config.sections.find(x => x.id === sid); return s ? s.name : "قسم"; }
function fillTuyaFilter() {
  const sel = document.getElementById("tuyaFilter"); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">كل الأقسام</option><option value="__none">عام (كل المدرسة)</option>'
    + config.sections.filter(s => s.id).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  sel.value = cur || "";
}
function tuyaFiltered() {
  const f = (document.getElementById("tuyaFilter") || {}).value || "";
  if (!f) return tuyaDevices;
  if (f === "__none") return tuyaDevices.filter(d => !d.section_id);
  return tuyaDevices.filter(d => d.section_id === f);
}
async function tuyaResync(id) {
  const msg = document.getElementById("tuyaMsg");
  msg.textContent = "جارٍ تحديث المفتاح…";
  const { data, error } = await db.functions.invoke("tuya", { body: { deviceId: id, action: "resync" } });
  if (error) msg.textContent = "فشل التحديث: " + (MQ.err(error));
  else if (data && data.error) msg.textContent = "التحديث: " + data.error;
  else { msg.textContent = "✓ حُدّث المفتاح من سحابة تويا"; await loadTuyaList(); }
}

// Generic device panel: works for ANY Tuya device — discovers its functions,
// renders a control for each (toggle/number/enum/text) and shows live status.
async function openDevicePanel(id) {
  const dev = tuyaDevices.find(x => x.id === id); if (!dev) return;
  const back = document.createElement("div");
  back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000";
  const card = document.createElement("div");
  card.style.cssText = "background:var(--card,#fff);color:var(--ink,#111);border-radius:14px;padding:18px;max-width:640px;width:92%;max-height:85vh;overflow:auto";
  back.appendChild(card); document.body.appendChild(back);
  back.onclick = e => { if (e.target === back) document.body.removeChild(back); };
  card.innerHTML = `<h2 style="margin:0 0 4px">${esc(dev.name)} <span class="muted" style="font-size:14px">· ${TUYA_CATS[dev.category] || dev.category}</span></h2>
    <p class="muted" id="dpMsg">جارٍ جلب القدرات والحالة من سحابة تويا…</p>`;
  const [fnsR, stR] = await Promise.all([
    db.functions.invoke("tuya", { body: { deviceId: id, action: "functions" } }),
    db.functions.invoke("tuya", { body: { deviceId: id, action: "status" } })
  ]);
  const fns = (fnsR.data && fnsR.data.functions) || [];
  const st = (stR.data && stR.data.status) || [];
  const stMap = {}; st.forEach(s => stMap[s.code] = s.value);
  const msg = document.getElementById("dpMsg");
  const err = (fnsR.data && fnsR.data.error) || (stR.data && stR.data.error);
  msg.textContent = err ? ("تعذّر: " + err) : (fns.length ? "" : "لا توجد وظائف قابلة للتحكم لهذا الجهاز.");
  const ctl = document.createElement("div");
  ctl.innerHTML = '<div class="subtle" style="margin:8px 0 4px"><b>التحكم</b></div>';
  fns.forEach(f => {
    const row = document.createElement("div"); row.className = "row";
    row.style.cssText = "padding:6px 0;border-bottom:1px solid var(--line);gap:8px;align-items:center;flex-wrap:wrap";
    const label = document.createElement("span"); label.style.cssText = "flex:1;min-width:150px"; label.textContent = f.code; label.title = f.type;
    row.appendChild(label);
    let p = {}; try { p = JSON.parse(f.values || "{}"); } catch (_) {}
    if (f.type === "Boolean") {
      const on = document.createElement("button"); on.className = "primary"; on.textContent = "تشغيل"; on.onclick = () => rawCmd(id, f.code, true, msg);
      const off = document.createElement("button"); off.className = "ghost"; off.textContent = "إطفاء"; off.onclick = () => rawCmd(id, f.code, false, msg);
      row.append(on, off);
    } else if (f.type === "Integer") {
      const inp = document.createElement("input"); inp.type = "number"; inp.style.width = "90px";
      if (p.min != null) inp.min = p.min; if (p.max != null) inp.max = p.max; inp.value = stMap[f.code] ?? p.min ?? 0;
      const b = document.createElement("button"); b.className = "ghost"; b.textContent = "ضبط"; b.onclick = () => rawCmd(id, f.code, +inp.value, msg);
      row.append(inp, b);
    } else if (f.type === "Enum") {
      const sel = document.createElement("select"); (p.range || []).forEach(v => sel.add(new Option(v, v))); if (stMap[f.code]) sel.value = stMap[f.code];
      const b = document.createElement("button"); b.className = "ghost"; b.textContent = "ضبط"; b.onclick = () => rawCmd(id, f.code, sel.value, msg);
      row.append(sel, b);
    } else if (f.type === "String") {
      const inp = document.createElement("input"); inp.style.flex = "1"; inp.value = stMap[f.code] ?? "";
      const b = document.createElement("button"); b.className = "ghost"; b.textContent = "ضبط"; b.onclick = () => rawCmd(id, f.code, inp.value, msg);
      row.append(inp, b);
    } else { const s = document.createElement("span"); s.className = "muted"; s.textContent = f.type; row.append(s); }
    ctl.appendChild(row);
  });
  const stw = document.createElement("div");
  stw.innerHTML = '<div class="subtle" style="margin:14px 0 4px"><b>الحالة والقراءات</b></div>';
  if (st.length) st.forEach(s => { const r = document.createElement("div"); r.className = "row"; r.style.cssText = "padding:4px 0;border-bottom:1px solid var(--line)"; r.innerHTML = `<span style="flex:1" class="muted">${esc(s.code)}</span><span class="mono">${esc(String(s.value))}</span>`; stw.appendChild(r); });
  else stw.innerHTML += '<p class="muted">لا توجد قراءات.</p>';
  const footer = document.createElement("div"); footer.className = "row"; footer.style.marginTop = "14px";
  const close = document.createElement("button"); close.className = "ghost"; close.textContent = "إغلاق"; close.onclick = () => document.body.removeChild(back);
  footer.append(close);
  if (fns.length) card.appendChild(ctl);
  card.appendChild(stw); card.appendChild(footer);
}
async function rawCmd(id, code, value, msgEl) {
  const { data, error } = await db.functions.invoke("tuya", { body: { deviceId: id, action: "raw", commands: [{ code, value }] } });
  if (msgEl) msgEl.textContent = error ? ("فشل: " + MQ.err(error)) : ((data && data.error) ? data.error : ((data && data.ok) ? ("✓ " + code) : "لم يُقبل الأمر"));
}

// ─── Scenes: one tap runs several devices (stored in the config payload) ──────
function scenes() { return (config.scenes = config.scenes || []); }
function renderScenes() {
  const box = document.getElementById("sceneList");
  if (!scenes().length) { box.innerHTML = '<p class="muted">لا توجد مشاهد بعد.</p>'; return; }
  box.innerHTML = scenes().map(sc => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line);gap:10px;flex-wrap:wrap">
      <span style="flex:1"><b>${esc(sc.name)}</b> <span class="muted">· ${(sc.actions || []).length} إجراء</span></span>
      <button class="primary" data-onclick="h37" data-h37a0="${esc(sc.id)}"><i data-ic=play></i> تشغيل</button>
      <button class="ghost" data-onclick="h38" data-h38a0="${esc(sc.id)}">تعديل</button>
      <button class="ghost danger" data-onclick="h39" data-h39a0="${esc(sc.id)}">✕</button>
    </div>`).join("");
}
async function runScene(id) {
  const sc = scenes().find(x => x.id === id); if (!sc) return;
  const msg = document.getElementById("tuyaMsg");
  const online = await tabletOnline();
  let ok = 0, fail = 0;
  for (const a of (sc.actions || [])) {
    const dev = tuyaDevices.find(x => x.id === a.tuyaDeviceId);
    if (online) {
      const { error } = await db.from("commands").insert({ school_id: schoolId, type: "device",
        payload: { tuyaDeviceId: a.tuyaDeviceId, action: a.action, value: a.value ?? null }, section_id: dev?.section_id ?? null });
      error ? fail++ : ok++;
    } else {
      const { data, error } = await db.functions.invoke("tuya", { body: { deviceId: a.tuyaDeviceId, action: a.action, value: a.value ?? null } });
      (error || (data && data.error)) ? fail++ : ok++;
    }
  }
  if (online) wakeTablets(schoolId);
  msg.textContent = `✓ «${sc.name}»: ${ok} إجراء` + (fail ? ` · ${fail} فشل` : "") + (online ? " (عبر التابلت)" : " (سحابي)");
}
function showSceneForm(id) {
  const sc = id ? scenes().find(x => x.id === id) : { id: "sc-" + Date.now(), name: "", actions: [] };
  sc.actions = sc.actions || [];
  const f = document.getElementById("sceneForm"); f.style.display = "block";
  const catOf = did => (tuyaDevices.find(d => d.id === did) || {}).category;
  const draw = () => {
    f.innerHTML = "";
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px;max-width:600px";
    const nameRow = document.createElement("div"); nameRow.className = "row"; nameRow.style.marginBottom = "8px";
    const nl = document.createElement("label"); nl.className = "muted"; nl.style.width = "80px"; nl.textContent = "الاسم";
    const ni = document.createElement("input"); ni.style.flex = "1"; ni.value = sc.name; ni.placeholder = "وضع الاختبارات"; ni.oninput = () => sc.name = ni.value;
    nameRow.append(nl, ni); card.appendChild(nameRow);
    sc.actions.forEach((a, idx) => {
      const row = document.createElement("div"); row.className = "row"; row.style.cssText = "padding:6px 0;gap:8px;flex-wrap:wrap;align-items:center";
      const dsel = document.createElement("select");
      tuyaDevices.forEach(d => dsel.add(new Option(d.name + " · " + (TUYA_CATS[d.category] || d.category), d.id)));
      dsel.value = a.tuyaDeviceId || (tuyaDevices[0] && tuyaDevices[0].id) || "";
      dsel.onchange = () => { a.tuyaDeviceId = dsel.value; a.action = tuyaActionsFor(catOf(a.tuyaDeviceId))[0]; draw(); };
      const asel = document.createElement("select");
      tuyaActionsFor(catOf(a.tuyaDeviceId)).forEach(x => asel.add(new Option(TUYA_ACTION_LABELS[x], x)));
      asel.value = a.action || tuyaActionsFor(catOf(a.tuyaDeviceId))[0]; asel.onchange = () => { a.action = asel.value; draw(); };
      row.append(dsel, asel);
      if (a.action === "set") { const v = document.createElement("input"); v.type = "number"; v.min = 0; v.max = 100; v.style.width = "72px"; v.value = a.value ?? 100; v.onchange = () => a.value = Math.max(0, Math.min(100, +v.value || 0)); row.append(v); }
      const del = document.createElement("button"); del.className = "ghost danger"; del.textContent = "✕"; del.onclick = () => { sc.actions.splice(idx, 1); draw(); };
      row.append(del); card.appendChild(row);
    });
    const footer = document.createElement("div"); footer.className = "row"; footer.style.marginTop = "12px";
    const add = document.createElement("button"); add.className = "ghost"; add.textContent = "+ إجراء"; add.disabled = !tuyaDevices.length;
    add.onclick = () => { const d = tuyaDevices[0]; sc.actions.push({ tuyaDeviceId: d.id, action: tuyaActionsFor(d.category)[0] }); draw(); };
    const save = document.createElement("button"); save.className = "primary"; save.textContent = "حفظ المشهد";
    save.onclick = () => saveScene(sc, !!id);
    const cancel = document.createElement("button"); cancel.className = "ghost"; cancel.textContent = "إلغاء"; cancel.onclick = () => { f.style.display = "none"; };
    footer.append(save, add, cancel); card.appendChild(footer);
    f.appendChild(card);
  };
  draw();
}
async function saveScene(sc, existing) {
  if (!sc.name.trim()) { document.getElementById("tuyaMsg").textContent = "أدخل اسم المشهد"; return; }
  if (!existing) scenes().push(sc);
  await saveConfig(true);
  document.getElementById("sceneForm").style.display = "none";
  renderScenes();
  document.getElementById("tuyaMsg").textContent = "✓ حُفظ المشهد";
}
async function deleteScene(id) {
  if (!confirm("حذف هذا المشهد؟")) return;
  config.scenes = scenes().filter(x => x.id !== id);
  await saveConfig(true); renderScenes();
}
const TUYA_ACTION_LABELS = { on: "تشغيل", off: "إطفاء", open: "فتح", close: "إغلاق", stop: "إيقاف", set: "ضبط" };
function tuyaActionsFor(cat) {
  return cat === "curtain" ? ["open", "close", "stop", "set"] : (cat === "light" ? ["on", "off", "set"] : ["on", "off"]);
}
function renderTuya() {
  const box = document.getElementById("tuyaList");
  const status = window._tabletUp
    ? '<div class="subtle" style="margin-bottom:10px"><i data-ic=dot data-ic-class=on></i> التابلت متصل — التحكم فوري عبر الشبكة المحلية</div>'
    : '<div class="subtle" style="margin-bottom:10px"><i data-ic=dot data-ic-class=off></i> التابلت غير متصل — سيُستخدم التحكم السحابي (يتطلب إعداد اعتماد تويا)</div>';
  const list = tuyaFiltered();
  if (!list.length) { box.innerHTML = status + '<p class="muted">' + (tuyaDevices.length ? "لا أجهزة في هذا القسم." : "لا توجد أجهزة بعد. أضف جهازًا للبدء.") + '</p>'; return; }
  box.innerHTML = status + list.map(d => {
    let controls = "";
    if (d.category === "curtain") {
      controls = `<button class="ghost" data-onclick="h40" data-h40a0="${esc(d.id)}"><i data-ic=up></i> فتح</button>
        <button class="ghost" data-onclick="h41" data-h41a0="${esc(d.id)}"><i data-ic=stop></i> إيقاف</button>
        <button class="ghost" data-onclick="h42" data-h42a0="${esc(d.id)}"><i data-ic=down></i> إغلاق</button>`;
    } else if (d.category === "light" || d.category === "switch") {
      controls = `<button class="primary" data-onclick="h43" data-h43a0="${esc(d.id)}">تشغيل</button>
        <button class="ghost" data-onclick="h44" data-h44a0="${esc(d.id)}">إطفاء</button>`;
    }
    return `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line);gap:10px;flex-wrap:wrap">
      <span style="min-width:150px;flex:1"><b>${esc(d.name)}</b> <span class="muted">· ${TUYA_CATS[d.category] || d.category} · ${esc(tuyaSectionName(d.section_id))}</span></span>
      ${controls}
      <button class="ghost" data-onclick="h45" data-h45a0="${esc(d.id)}" title="تحكم متقدّم وقراءة الحالة (كل الوظائف)"><i data-ic=sliders></i> لوحة</button>
      <button class="ghost" data-onclick="h46" data-h46a0="${esc(d.id)}" title="فحص الاتصال">فحص</button>
      <button class="ghost" data-onclick="h47" data-h47a0="${esc(d.id)}" title="تحديث المفتاح من سحابة تويا" aria-label="تحديث المفتاح من سحابة تويا"><i data-ic=refresh></i></button>
      <button class="ghost" data-onclick="h48" data-h48a0="${esc(d.id)}">تعديل</button>
      <button class="ghost danger" data-onclick="h49" data-h49a0="${esc(d.id)}" aria-label="حذف ${esc(d.name)}"><i data-ic=trash></i></button>
    </div>`;
  }).join("");
}
// Control routing: use the tablet over the LAN when it's online; otherwise fall
// back to Tuya's cloud (OpenAPI) via the `tuya` edge function.
async function tuyaCtl(id, action, value) {
  const dev = tuyaDevices.find(x => x.id === id);
  const msg = document.getElementById("tuyaMsg");
  if (await tabletOnline()) {
    const { error } = await db.from("commands").insert({ school_id: schoolId, type: "device",
      payload: { tuyaDeviceId: id, action, value: value ?? null }, section_id: dev?.section_id ?? null });
    if (!error) wakeTablets(schoolId);
    msg.textContent = error ? "فشل: " + MQ.err(error) : "✓ أُرسل الأمر عبر التابلت";
  } else {
    const { data, error } = await db.functions.invoke("tuya", { body: { deviceId: id, action, value: value ?? null } });
    if (error) msg.textContent = "التابلت غير متصل، وتعذّر التحكم السحابي: " + (MQ.err(error));
    else if (data && data.error) msg.textContent = "التابلت غير متصل — التحكم السحابي: " + data.error;
    else msg.textContent = "✓ عبر سحابة تويا (التابلت غير متصل)";
  }
}
async function tabletOnline() {
  const { data } = await db.from("devices").select("last_seen_at").eq("school_id", schoolId);
  return (data || []).some(d => d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < 120000);
}
function showTuyaForm(id) {
  const d = id ? tuyaDevices.find(x => x.id === id) : null;
  const secOpts = ['<option value="">عام (كل المدرسة)</option>']
    .concat(config.sections.filter(s => s.id).map(s => `<option value="${s.id}" ${d && d.section_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`)).join("");
  const catOpts = Object.entries(TUYA_CATS).map(([k, v]) => `<option value="${k}" ${d && d.category === k ? "selected" : ""}>${v}</option>`).join("");
  const f = document.getElementById("tuyaForm");
  f.style.display = "block";
  f.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;max-width:560px;border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px">
    <div class="row"><label class="muted" style="width:120px">الاسم</label><input id="tzName" style="flex:1" value="${d ? esc(d.name) : ""}" placeholder="إنارة الممر"></div>
    <div class="row"><label class="muted" style="width:120px">الفئة</label><select id="tzCat" data-onchange="h50">${catOpts}</select>
      <label class="muted">القسم</label><select id="tzSection">${secOpts}</select></div>
    <div class="row"><label class="muted" style="width:120px">Device ID</label><input id="tzDevId" dir="ltr" style="flex:1" value="${d ? esc(d.tuya_device_id) : ""}"></div>
    <div class="row"><label class="muted" style="width:120px">Local Key</label><input id="tzKey" dir="ltr" style="flex:1" value="" placeholder="${d ? "(محفوظ — اترك فارغًا للإبقاء)" : "16 حرفًا"}"></div>
    <div class="row"><label class="muted" style="width:120px">IP (اختياري)</label><input id="tzIp" dir="ltr" value="${d && d.ip ? esc(d.ip) : ""}" placeholder="192.168.1.x">
      <label class="muted">البروتوكول</label><select id="tzProto">${["3.3","3.1","3.4","3.5"].map(v => `<option ${d && d.protocol_version === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="row"><label class="muted" style="width:120px">dp_map</label><input id="tzDp" dir="ltr" style="flex:1" value='${d ? esc(JSON.stringify(d.dp_map)) : TUYA_DP_TEMPLATES.light}'></div>
    <div class="row"><span style="width:120px"></span>
      <button class="primary" data-onclick="h51" data-h51a0="${esc(id || "")}"><i data-ic=save></i> حفظ</button>
      <button class="ghost" data-onclick="h52">إلغاء</button></div>
  </div>`;
  document.getElementById("tzCat").value = d ? d.category : "light";
}
function tuyaFillDp() {
  const cat = document.getElementById("tzCat").value;
  document.getElementById("tzDp").value = TUYA_DP_TEMPLATES[cat] || "{}";
}
async function saveTuya(id) {
  const row = {
    school_id: schoolId,
    name: document.getElementById("tzName").value.trim(),
    category: document.getElementById("tzCat").value,
    tuya_device_id: document.getElementById("tzDevId").value.trim(),
    ip: document.getElementById("tzIp").value.trim() || null,
    protocol_version: document.getElementById("tzProto").value,
    section_id: document.getElementById("tzSection").value || null,
  };
  try { row.dp_map = JSON.parse(document.getElementById("tzDp").value || "{}"); }
  catch (_) { document.getElementById("tuyaMsg").textContent = "dp_map ليس JSON صالحًا"; return; }
  const key = document.getElementById("tzKey").value.trim();
  if (key) row.local_key = key;
  if (!row.name || !row.tuya_device_id) { document.getElementById("tuyaMsg").textContent = "الاسم و Device ID مطلوبان"; return; }
  let error;
  if (id) { ({ error } = await db.from("tuya_devices").update(row).eq("id", id)); }
  else {
    if (!row.local_key) { document.getElementById("tuyaMsg").textContent = "Local Key مطلوب"; return; }
    ({ error } = await db.from("tuya_devices").insert(row));
  }
  if (error) { document.getElementById("tuyaMsg").textContent = "فشل: " + MQ.err(error); return; }
  document.getElementById("tuyaForm").style.display = "none";
  await loadTuya();
  document.getElementById("tuyaMsg").textContent = "✓ حُفظ الجهاز";
}
async function deleteTuya(id) {
  if (!confirm("حذف هذا الجهاز؟")) return;
  const { error } = await db.from("tuya_devices").delete().eq("id", id);
  if (error) { document.getElementById("tuyaMsg").textContent = "فشل: " + MQ.err(error); return; }
  await loadTuya();
}

// ─── Sound library ──────────────────────────────────────────────────────────
async function loadLibrary() {
  const { data } = await db.from("sound_library")
    .select("id, name, url, storage_path, school_id, duration_ms, sort_order")
    .order("school_id", { nullsFirst: true }).order("sort_order");
  library = data || [];
}
function renderLibrary() {
  const box = document.getElementById("soundLibList");
  const rows = [];
  rows.push(`<div class="subtle" style="margin:10px 0 4px"><b>النغمات المدمجة</b></div>`);
  rows.push(Object.entries(SOUNDS).map(([k, v]) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span style="flex:1">${v}</span><span class="muted mono">مدمج</span></div>`).join(""));
  const demo = library.filter(l => !l.school_id), mine = library.filter(l => l.school_id);
  const renderRow = l => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
      <span style="flex:1">${esc(l.name)}</span>
      <audio controls preload="none" src="${esc(l.url)}" style="height:34px;max-width:100%" aria-label="استماع: ${esc(l.name)}"></audio>
      ${l.school_id ? `<button class="ghost danger" data-onclick="h53" data-h53a0="${esc(l.id)}" data-h53a1="${esc(l.storage_path)}">✕</button>` : `<span class="muted mono">مشترك</span>`}
    </div>`;
  rows.push(`<div class="subtle" style="margin:14px 0 4px"><b>المكتبة المشتركة</b></div>`);
  rows.push(demo.length ? demo.map(renderRow).join("") : `<p class="muted">لا توجد.</p>`);
  rows.push(`<div class="subtle" style="margin:14px 0 4px"><b>أصوات مدرستك</b></div>`);
  rows.push(mine.length ? mine.map(renderRow).join("") : `<p class="muted">لم ترفع أصواتًا بعد.</p>`);
  box.innerHTML = rows.join("");
}
async function uploadSound(file) {
  if (!file) return;
  const msg = document.getElementById("soundMsg");
  if (file.size > 5 * 1024 * 1024) { msg.textContent = "الملف أكبر من 5MB."; return; }
  msg.textContent = "جارٍ الرفع…";
  const ext = (file.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "mp3";
  const path = `school/${schoolId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from("sounds").upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
  if (upErr) { msg.textContent = "فشل الرفع: " + MQ.err(upErr); return; }
  const { data: pub } = db.storage.from("sounds").getPublicUrl(path);
  const name = (file.name.replace(/\.[^.]+$/, "") || "صوت").slice(0, 60);
  const { error: insErr } = await db.from("sound_library").insert({ school_id: schoolId, name, storage_path: path, url: pub.publicUrl, sort_order: 100 });
  if (insErr) { msg.textContent = "فشل الحفظ: " + MQ.err(insErr); return; }
  document.getElementById("soundFile").value = "";
  await loadLibrary(); renderLibrary(); renderSchedules();
  msg.textContent = "✓ أُضيف الصوت إلى المكتبة.";
}
async function deleteSound(id, path) {
  if (!confirm("حذف هذا الصوت من المكتبة؟")) return;
  await db.storage.from("sounds").remove([path]);
  const { error } = await db.from("sound_library").delete().eq("id", id);
  if (error) { document.getElementById("soundMsg").textContent = "فشل الحذف: " + MQ.err(error); return; }
  await loadLibrary(); renderLibrary(); renderSchedules();
}

// ─── Account / profile ──────────────────────────────────────────────────────
async function loadAccount() {
  document.getElementById("accEmail").textContent = me?.email || "";
  document.getElementById("accRole").textContent = ({ admin: "مدير المدرسة", manager: "مشغّل", viewer: "مشاهد", gate: "مشرف البوابة" })[myRole] || myRole;
  const { data } = await db.from("profiles").select("full_name, phone").eq("user_id", me.id).maybeSingle();
  document.getElementById("accName").value = data?.full_name || "";
  document.getElementById("accPhone").value = data?.phone || "";
}
async function saveProfile() {
  const full_name = document.getElementById("accName").value.trim();
  const phone = document.getElementById("accPhone").value.trim();
  const { error } = await db.from("profiles").upsert({ user_id: me.id, full_name, phone, updated_at: new Date().toISOString() });
  document.getElementById("accMsg").textContent = error ? "فشل: " + MQ.err(error) : "✓ حُفظت بياناتك.";
}
async function changePassword() {
  const p1 = document.getElementById("accPw1").value, p2 = document.getElementById("accPw2").value;
  const msg = document.getElementById("accMsg");
  if (p1.length < 6) { msg.textContent = "كلمة المرور 6 أحرف على الأقل."; return; }
  if (p1 !== p2) { msg.textContent = "كلمتا المرور غير متطابقتين."; return; }
  const { error } = await db.auth.updateUser({ password: p1 });
  if (error) { msg.textContent = "فشل: " + MQ.err(error); return; }
  document.getElementById("accPw1").value = ""; document.getElementById("accPw2").value = "";
  msg.textContent = "✓ تم تحديث كلمة المرور.";
}
// Success: 5 s. Errors stay until the next message (quality standard §4).
function show(id, text, isError) {
  const el = document.getElementById(id);
  el.textContent = MQ.arText(text); el.className = "msg " + (isError ? "err" : "ok");
  clearTimeout(el._t);
  if (!isError) el._t = setTimeout(() => { el.className = "msg"; }, 5000);
}
// Unlinked account: guide new schools to self-onboarding instead of a dead end.
function showUnlinked() {
  const el = document.getElementById("loginMsg");
  el.className = "msg err";
  el.innerHTML = 'هذا الحساب غير مرتبط بمدرسة. مدرسة جديدة؟ ' +
    '<a href="./signup.html" style="color:inherit;font-weight:700;text-decoration:underline">ابدأ تجربة مجانية 14 يومًا</a>' +
    '، أو تواصل مع مزوّد الخدمة.';
}
function td(child) { const c = document.createElement("td"); c.appendChild(child); return c; }
function inp(value, onChange, width) {
  const i = document.createElement("input"); i.value = value ?? "";
  if (width) i.style.width = width + "px";
  i.onchange = () => onChange(i.value); return i;
}
function numInp(value, onChange, width) { const i = inp(value, onChange, width); i.type = "number"; return i; }
// 24-hour «HH:MM» text field: never shows AM/PM, never clipped (MQ-UX-07).
function parseHHMM(v) {
  const m = String(v || "").trim().replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[.\s]/g, ":").match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null; const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
function timeInput(e) {
  const i = document.createElement("input"); i.type = "text"; i.className = "ev-time";
  i.inputMode = "numeric"; i.dir = "ltr"; i.maxLength = 5; i.placeholder = "07:30"; i.autocomplete = "off";
  i.setAttribute("aria-label", "وقت الحدث بنظام 24 ساعة");
  i.value = String(Math.floor(e.startMinuteOfDay / 60)).padStart(2, "0") + ":" + String(e.startMinuteOfDay % 60).padStart(2, "0");
  i.onchange = () => {
    const v = parseHHMM(i.value);
    if (v == null) { i.setAttribute("aria-invalid", "true"); i.style.borderColor = "var(--red)"; show("msg", "اكتب الوقت بصيغة 24 ساعة مثل 07:30 أو 13:05.", true); return; }
    i.removeAttribute("aria-invalid"); i.style.borderColor = ""; e.startMinuteOfDay = v; renderEvents();
  };
  return i;
}
function timeErrors() {
  const bad = document.querySelector('#eventsTable input[aria-invalid="true"]');
  return bad ? "صحّح الوقت المظلل بالأحمر (صيغة 24 ساعة مثل 07:30) ثم احفظ." : "";
}
function daysBoxes(e) {
  const wrap = document.createElement("div"); wrap.className = "chips"; wrap.setAttribute("role", "group"); wrap.setAttribute("aria-label", "أيام الحدث");
  DAY_ORDER.forEach(bit => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip-day";
    const on = () => !!(e.daysOfWeek & (1 << bit));
    b.textContent = DAY_NAMES[bit]; b.setAttribute("aria-pressed", String(on()));
    b.onclick = () => { e.daysOfWeek = on() ? (e.daysOfWeek & ~(1 << bit)) : (e.daysOfWeek | (1 << bit)); b.setAttribute("aria-pressed", String(on())); };
    wrap.appendChild(b);
  });
  return wrap;
}
function tdl(label, child, cls) { const c = document.createElement("td"); if (label) c.setAttribute("data-label", label); if (cls) c.className = cls; c.appendChild(child); return c; }
function soundSelect(e) {
  const s = document.createElement("select");
  const defName = soundName(sec()?.defaultSoundKey);
  s.add(new Option("افتراضي القسم (" + defName + ")", ""));
  Object.entries(SOUNDS).forEach(([k, v]) => s.add(new Option(v, k)));
  if (library.length) {
    const og = document.createElement("optgroup"); og.label = "مكتبة الأصوات";
    library.forEach(l => og.appendChild(new Option(l.name, libKey(l))));
    s.appendChild(og);
  }
  if (e.soundKey && !SOUNDS[e.soundKey] && !library.some(l => libKey(l) === e.soundKey)) s.add(new Option(soundName(e.soundKey), e.soundKey));
  s.value = e.soundKey || "";
  s.onchange = () => e.soundKey = s.value;
  return s;
}
// Per-event Tuya device actions (survive cloud sync via the payload).
function deviceActionsBtn(e) {
  const b = document.createElement("button"); b.className = "ghost";
  const n = (e.deviceActions || []).length;
  b.innerHTML = MQ.icon("zap") + (n ? " " + n : " لا شيء");
  b.title = "إجراءات الأجهزة الذكية عند هذا الحدث";
  b.setAttribute("aria-label", "إجراءات الأجهزة الذكية عند «" + (e.name || "") + "»: " + n);
  b.onclick = () => editDeviceActions(e);
  return b;
}
function editDeviceActions(e) {
  e.deviceActions = e.deviceActions || [];
  const back = document.createElement("div");
  back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000";
  const card = document.createElement("div");
  card.style.cssText = "background:var(--card,#fff);color:var(--ink,#111);border-radius:14px;padding:18px;max-width:600px;width:92%;max-height:82vh;overflow:auto";
  const close = () => { document.body.removeChild(back); renderEvents(); };
  const draw = () => {
    card.innerHTML = `<h2 style="margin:0 0 4px">إجراءات الأجهزة عند «${esc(e.name)}»</h2>
      <p class="muted" style="margin:0 0 12px">تُنفَّذ على التابلت وقت الحدث (مثل تشغيل الإنارة أو فتح الستائر).</p>`;
    if (!tuyaDevices.length) {
      card.innerHTML += '<p class="muted">لا توجد أجهزة ذكية. أضِفها أولًا من تبويب «الأجهزة الذكية».</p>';
    }
    e.deviceActions.forEach((a, idx) => {
      const row = document.createElement("div"); row.className = "row";
      row.style.cssText = "padding:8px 0;border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap;align-items:center";
      const dsel = document.createElement("select");
      tuyaDevices.forEach(d => dsel.add(new Option(d.name + " · " + (TUYA_CATS[d.category] || d.category), d.id)));
      dsel.value = a.tuyaDeviceId || (tuyaDevices[0] && tuyaDevices[0].id) || "";
      dsel.onchange = () => { a.tuyaDeviceId = dsel.value; a.action = tuyaActionsFor(catOf(a.tuyaDeviceId))[0]; draw(); };
      const asel = document.createElement("select");
      tuyaActionsFor(catOf(a.tuyaDeviceId)).forEach(x => asel.add(new Option(TUYA_ACTION_LABELS[x], x)));
      asel.value = a.action || tuyaActionsFor(catOf(a.tuyaDeviceId))[0];
      asel.onchange = () => { a.action = asel.value; draw(); };
      row.append(dsel, asel);
      if (a.action === "set") {
        const v = document.createElement("input"); v.type = "number"; v.min = 0; v.max = 100; v.style.width = "72px";
        v.value = a.value ?? 100; v.title = catOf(a.tuyaDeviceId) === "curtain" ? "الموضع %" : "السطوع %";
        v.onchange = () => a.value = Math.max(0, Math.min(100, +v.value || 0));
        row.append(v);
      }
      const del = document.createElement("button"); del.className = "ghost danger"; del.textContent = "✕";
      del.onclick = () => { e.deviceActions.splice(idx, 1); draw(); };
      row.append(del);
      card.appendChild(row);
    });
    const footer = document.createElement("div"); footer.className = "row"; footer.style.marginTop = "14px";
    const add = document.createElement("button"); add.className = "ghost"; add.textContent = "+ إجراء"; add.disabled = !tuyaDevices.length;
    add.onclick = () => { const d = tuyaDevices[0]; e.deviceActions.push({ tuyaDeviceId: d.id, action: tuyaActionsFor(d.category)[0] }); draw(); };
    const done = document.createElement("button"); done.className = "primary"; done.textContent = "تم"; done.onclick = close;
    footer.append(done, add);
    card.appendChild(footer);
  };
  const catOf = id => (tuyaDevices.find(d => d.id === id) || {}).category;
  draw();
  back.onclick = ev => { if (ev.target === back) close(); };
  back.appendChild(card);
  document.body.appendChild(back);
}
function checkbox(label, checked, onChange) {
  const wrap = document.createElement("label");
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked;
  cb.onchange = () => onChange(cb.checked);
  wrap.append(cb, " " + label);
  return wrap;
}
function field(label, input) { const w = document.createElement("label"); w.append(label + ": ", input); return w; }
function delBtn(onClick) { const b = document.createElement("button"); b.className = "ghost danger"; b.innerHTML = MQ.icon("trash"); b.setAttribute("aria-label", "حذف"); b.onclick = onClick; return b; }
function fmt(ts) { return MQ.dt(ts); }
function esc(s) { return String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])); }

init();

// ─── Delegated event handlers (replaces inline on*="" attributes for CSP) ───
function _hv(v) { if (v === undefined) return undefined; try { return JSON.parse(v); } catch (_) { return v; } }
const _H = {
  h1(event) { login() },
  h2(event) { showTab('schedules') },
  h3(event) { showTab('reports') },
  h4(event) { showTab('logs') },
  h5(event) { showTab('announce') },
  h6(event) { showTab('devices') },
  h7(event) { showTab('sounds') },
  h8(event) { showTab('smart') },
  h9(event) { showTab('account') },
  h10(event) { addSchedule() },
  h11(event) { exportConfig() },
  h12(event) { document.getElementById('importFile').click() },
  h13(event) { importConfig(this.files[0]) },
  h14(event) { saveConfig() },
  h15(event) { addEvent() },
  h16(event) { loadReports() },
  h17(event) { loadLogs() },
  h18(event) { sendAnnounce() },
  h19(event) { sendBell() },
  h20(event) { uploadSound(this.files[0]) },
  h21(event) { renderTuya() },
  h22(event) { showTuyaForm() },
  h23(event) { showSceneForm() },
  h24(event) { saveProfile() },
  h25(event) { changePassword() },
  h26(event) { togglePrayer(this.checked) },
  h27(event) { togglePrayerBit(_hv(this.dataset.h27a0), this.checked) },
  h28(event) { setPrayer('enabled', this.checked) },
  h29(event) { pickCity(this.value) },
  h30(event) { setPrayer('latitude', +this.value) },
  h31(event) { setPrayer('longitude', +this.value) },
  h32(event) { setPrayer('method', this.value) },
  h33(event) { setPrayer('adhanSoundKey', this.value) },
  h34(event) { setPrayer('silenceAfterMin', Math.max(0, +this.value||0)) },
  h35(event) { assignDevice(this.dataset.h35a0, this.value) },
  h36(event) { renameDevice(this.dataset.h36a0, _hv(this.dataset.h36a1)) },
  h37(event) { runScene(this.dataset.h37a0) },
  h38(event) { showSceneForm(this.dataset.h38a0) },
  h39(event) { deleteScene(this.dataset.h39a0) },
  h40(event) { tuyaCtl(this.dataset.h40a0,'open') },
  h41(event) { tuyaCtl(this.dataset.h41a0,'stop') },
  h42(event) { tuyaCtl(this.dataset.h42a0,'close') },
  h43(event) { tuyaCtl(this.dataset.h43a0,'on') },
  h44(event) { tuyaCtl(this.dataset.h44a0,'off') },
  h45(event) { openDevicePanel(this.dataset.h45a0) },
  h46(event) { tuyaCtl(this.dataset.h46a0,'test') },
  h47(event) { tuyaResync(this.dataset.h47a0) },
  h48(event) { showTuyaForm(this.dataset.h48a0) },
  h49(event) { deleteTuya(this.dataset.h49a0) },
  h50(event) { tuyaFillDp() },
  h51(event) { saveTuya(this.dataset.h51a0) },
  h52(event) { document.getElementById('tuyaForm').style.display='none' },
  h53(event) { deleteSound(this.dataset.h53a0,this.dataset.h53a1) },
  h54(event) { showTab('students') },
  h55(event) { showTab('pickup') },
  h56(event) { showTab('notices') },
  c1(event) { showTab('calendar') },
  c2(event) { addCalendarEntry() },
  c3(event) { removeCalendarEntry(this.dataset.c3a0) },
  c4(event) { preset(this.dataset.c4a0) },
  c5(event) { templateRamadan() },
  c6(event) { templateExams() },
  c7(event) { syncCalType() }
};
["click", "change", "input"].forEach(type => document.addEventListener(type, ev => {
  for (let el = ev.target; el && el !== document; el = el.parentElement) {
    const name = el.getAttribute && el.getAttribute("data-on" + type);
    if (!name || !_H[name]) continue;
    if (_H[name].call(el, ev) === false) ev.preventDefault();
    if (ev.cancelBubble) break;
  }
}));


// ─── Cloud calendar (MQ-UX-03) ────────────────────────────────────────────────
// Holidays and special days live in payload.calendar and are compiled into dated
// schedules on publish (common.js MQ.compileCalendar) — every tablet honours them.
function allScheduleNames() {
  const set = new Set();
  config.sections.forEach(sc => sc.schedules.forEach(s => set.add(s.name)));
  return [...set];
}
function nextDate(mmdd) {
  const d = new Date(); const y = d.getFullYear();
  const iso = `${y}-${mmdd}`; return iso >= MQ.todayIso() ? iso : `${y + 1}-${mmdd}`;
}
function renderCalendar() {
  config.calendar = config.calendar || [];
  const names = allScheduleNames();
  document.getElementById("calForm").innerHTML = canWrite() ? `<div class="cal-form" data-write>
      <label>النوع<select id="calType" data-onchange="c7"><option value="holiday">إجازة — بلا أجراس</option><option value="special">يوم خاص — جدول بديل</option></select></label>
      <label>الاسم<input id="calName" placeholder="مثال: إجازة منتصف الفصل" maxlength="60"></label>
      <label>من<input id="calFrom" type="date" dir="ltr"></label>
      <label>إلى<input id="calTo" type="date" dir="ltr"></label>
      <label id="calSchedWrap" hidden>الجدول البديل<select id="calSched">${names.map(n => `<option>${esc(n)}</option>`).join("")}</select></label>
      <button class="primary" data-onclick="c2"><i data-ic=plus></i> أضف إلى التقويم</button>
    </div>
    <div class="row" style="margin:-4px 0 12px" data-write><span class="muted">إضافة سريعة:</span>
      <button class="ghost sm" data-onclick="c4" data-c4a0="national">اليوم الوطني</button>
      <button class="ghost sm" data-onclick="c4" data-c4a0="founding">يوم التأسيس</button>
    </div>` : "";
  const cal = [...config.calendar].sort((a, b) => (a.from || "").localeCompare(b.from || ""));
  const today = MQ.todayIso();
  document.getElementById("calList").innerHTML = cal.length ? cal.map(c => {
    const past = c.to < today, now = c.from <= today && today <= c.to;
    const days = Math.round((new Date(c.to) - new Date(c.from)) / 86400000) + 1;
    const missing = c.type === "special" && !allScheduleNames().includes(c.scheduleName);
    return `<div class="cal-item" style="${past ? "opacity:.55" : ""}">
      <span class="k ${c.type === "holiday" ? "" : "sp"}">${c.type === "holiday" ? "إجازة" : "يوم خاص"}</span>
      <b>${esc(c.name)}</b>${now ? ' <span class="sync-chip ok">جارية اليوم</span>' : ""}
      <span class="mono" dir="ltr">${MQ.isoToSlash(c.from)}${c.to !== c.from ? " → " + MQ.isoToSlash(c.to) : ""}</span>
      <span class="hj">${MQ.hijri(c.from)}${c.to !== c.from ? " → " + MQ.hijri(c.to) : ""} · ${days} ${days === 1 ? "يوم" : "أيام"}</span>
      ${c.type === "special" ? `<span class="muted">يرنّ: «${esc(c.scheduleName || "")}»${missing ? ' <b style="color:var(--red)">— الجدول غير موجود</b>' : ""}</span>` : ""}
      <span style="flex:1"></span>
      <button class="ghost danger sm" data-write data-onclick="c3" data-c3a0="${esc(c.id)}" aria-label="حذف ${esc(c.name)}"><i data-ic=trash></i></button>
    </div>`; }).join("") : '<p class="muted">لا توجد إجازات أو أيام خاصة بعد. أضف أول إجازة من النموذج أعلاه.</p>';
  // dated schedule periods across sections
  const rows = [];
  config.sections.forEach(sc => sc.schedules.forEach(s => { if (s.activeFrom && s.activeTo) rows.push({ sec: sc.name, s }); }));
  document.getElementById("calPeriods").innerHTML = rows.length ? rows.map(r =>
    `<div class="cal-item"><span class="k sp">فترة جدول</span><b>${esc(r.s.name)}</b><span class="muted">${esc(r.sec)}</span>
      <span class="mono" dir="ltr">${MQ.isoToSlash(r.s.activeFrom)} → ${MQ.isoToSlash(r.s.activeTo)}</span>
      <span class="hj">${MQ.hijri(r.s.activeFrom)} → ${MQ.hijri(r.s.activeTo)}</span></div>`).join("")
    : '<p class="muted">لا توجد جداول بفترة تفعيل بعد.</p>';
}
function syncCalType() { const sp = document.getElementById("calType").value === "special"; document.getElementById("calSchedWrap").hidden = !sp; }
function addCalendarEntry() {
  const type = document.getElementById("calType").value;
  const name = document.getElementById("calName").value.trim();
  const from = document.getElementById("calFrom").value, to = document.getElementById("calTo").value || from;
  if (!name) return show("msg", "اكتب اسماً للإجازة أو اليوم الخاص.", true);
  if (!from) return show("msg", "اختر تاريخ البداية.", true);
  if (to < from) return show("msg", "تاريخ النهاية قبل تاريخ البداية.", true);
  const entry = { id: "cal-" + Date.now().toString(36), type, name, from, to };
  if (type === "special") { entry.scheduleName = document.getElementById("calSched").value; if (!entry.scheduleName) return show("msg", "أنشئ الجدول البديل أولاً من تبويب «الجداول».", true); }
  config.calendar.push(entry);
  renderCalendar();
  show("msg", "أُضيف «" + name + "» — اضغط «حفظ ونشر للتابلت» ليصل للأجهزة.");
}
function removeCalendarEntry(id) {
  const c = config.calendar.find(x => x.id === id); if (!c) return;
  if (!confirm("حذف «" + c.name + "» من التقويم؟")) return;
  config.calendar = config.calendar.filter(x => x.id !== id); renderCalendar();
  show("msg", "حُذف — اضغط «حفظ ونشر للتابلت» لتطبيق الحذف على الأجهزة.");
}
function preset(kind) {
  const p = kind === "national" ? { name: "اليوم الوطني", mmdd: "09-23" } : { name: "يوم التأسيس", mmdd: "02-22" };
  const d = nextDate(p.mmdd);
  document.getElementById("calType").value = "holiday"; syncCalType();
  document.getElementById("calName").value = p.name;
  document.getElementById("calFrom").value = d; document.getElementById("calTo").value = d;
  show("msg", "عبّأنا «" + p.name + "» (" + MQ.isoToSlash(d) + ") — عدّل الأيام إن أعلنت الجهة إجازة أطول ثم اضغط «أضف».");
}
function periodEditor(s) {
  const w = document.createElement("div"); w.className = "period";
  const lab = document.createElement("span"); lab.className = "muted"; lab.textContent = "فترة التفعيل (اختياري):";
  const mk = (val, aria, set) => { const i = document.createElement("input"); i.type = "date"; i.dir = "ltr"; i.value = val || ""; i.setAttribute("aria-label", aria); i.onchange = () => { set(i.value || null); renderSchedules(); }; return i; };
  const f = mk(s.activeFrom, "بداية فترة الجدول", v => { s.activeFrom = v; if (v && (!s.activeTo || s.activeTo < v)) s.activeTo = v; });
  const t = mk(s.activeTo, "نهاية فترة الجدول", v => { s.activeTo = v; });
  const hint = document.createElement("span"); hint.className = "hj";
  hint.textContent = s.activeFrom && s.activeTo ? `${MQ.hijri(s.activeFrom)} → ${MQ.hijri(s.activeTo)} — يحلّ محل الجدول النشط خلال الفترة فقط` : "مثل رمضان أو أسبوع الاختبارات";
  const clr = document.createElement("button"); clr.type = "button"; clr.className = "ghost sm"; clr.textContent = "بلا فترة";
  clr.onclick = () => { s.activeFrom = null; s.activeTo = null; renderSchedules(); };
  w.append(lab, f, document.createTextNode("→"), t, hint);
  if (s.activeFrom || s.activeTo) w.append(clr);
  return w;
}
function templateRamadan() {
  const base = secScheds().find(x => x.isActive) || secScheds()[0];
  if (!base) return;
  const from = prompt("بداية رمضان (YYYY-MM-DD):", ""); if (!from) return;
  const to = prompt("نهاية الدوام الرمضاني (YYYY-MM-DD):", from); if (!to) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return show("msg", "اكتب التاريخين بصيغة 2027-02-08 والنهاية بعد البداية.", true);
  const evs = (base.events || []).map(e => ({ ...e, startMinuteOfDay: Math.min(1439, e.startMinuteOfDay + 120), durationMin: e.durationMin && e.durationMin > 35 ? 35 : e.durationMin }));
  secScheds().push({ name: "رمضان", isActive: false, activeFrom: from, activeTo: to, events: evs });
  curSched = secScheds().length - 1; showTab("schedules"); renderSchedules();
  show("msg", "أنشأنا «رمضان» من الجدول الحالي متأخراً ساعتين والحصة 35 د — راجع الأوقات ثم «حفظ ونشر».");
}
function templateExams() {
  const ev = (name, h, m, dur) => ({ name, startMinuteOfDay: h * 60 + m, durationMin: dur, daysOfWeek: 0b1001111, volume: 1, enabled: true, sortOrder: 0, soundKey: "" });
  secScheds().push({ name: "أيام الاختبارات", isActive: false, events: [
    ev("دخول القاعات", 7, 15, 15), ev("بداية الاختبار الأول", 7, 30, 120), ev("نهاية الاختبار الأول", 9, 30, 5),
    ev("بداية الاختبار الثاني", 10, 0, 90), ev("نهاية الاختبار الثاني", 11, 30, 5), ev("الانصراف", 11, 45, 5) ] });
  curSched = secScheds().length - 1; showTab("schedules"); renderSchedules();
  show("msg", "أُضيف قالب «أيام الاختبارات» — عدّل الأوقات، ثم حدّد فترته أو أضف «يوم خاص» في التقويم، ثم «حفظ ونشر».");
}
