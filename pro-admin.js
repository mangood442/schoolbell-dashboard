// «ميقات برو» — school dashboard pages for the Pro plan: zones & groups, speakers/devices, zone
// schedules + industrial shift generator, emergency (log + remote trigger), streaming, fire-panel
// inputs. Loaded after index.js and shares its globals (db, schoolId, me, myRole, config, esc, show,
// fmt, _H, saveConfig, renderEvents, showTab). Tabs stay hidden unless the plan has feature `pro`.
// No inline handlers (CSP): buttons use data-onclick="xN" routed through index.js's delegated _H.

const PRO = {
  on: false, role: "viewer", zones: [], groups: [], members: [], endpoints: [], health: {}, streams: [], triggers: [],
  emergency: null, loaded: false, timer: null,
};
window.PRO_ON = false;
const PRO_LIMITS = { zones: 100, groups: 20 };
const PRESETS = { EVACUATE: "إخلاء", FIRE: "حريق", SHELTER: "احتماء", ALL_CLEAR: "انتهاء الطوارئ" };
const SOURCES = { UI: "شاشة التحكم", API: "واجهة محلية", INPUT: "مدخل خارجي", DASHBOARD: "لوحة التحكم عن بُعد", WEBHOOK: "لوحة الحريق (Webhook)", MQTT: "لوحة الحريق (MQTT)" };
const KINDS = { NODE: "سماعة ميقات", MULTICAST_SPEAKER: "سماعة شبكية (بث متعدد)", SIP: "سماعة SIP", HTTP_API: "سماعة بواجهة HTTP", STROBE_RELAY: "وماض / مرحّل" };
const VENDORS = { axis: "Axis (VAPIX)", algo: "Algo (REST)", generic: "عام" };
const STREAM_KINDS = { RADIO: "إذاعة إنترنت (رابط)", PLAYLIST: "قائمة تشغيل من المكتبة", LINE_IN: "دخل الصوت / الميكروفون" };
const ONLINE_MS = 90_000;   // health is reported on each tablet sync (≤25 s) → allow 3 missed syncs
const isAdmin = () => myRole === "admin";
const canTrigger = () => myRole === "admin" || myRole === "manager";
const zoneName = slot => (PRO.zones.find(z => z.slot === slot) || {}).name || `منطقة ${slot}`;
const groupName = gid => (PRO.groups.find(g => g.gid === gid) || {}).name || `مجموعة ${gid}`;
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const DAY_AR = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]; // bit 0 = الاثنين
const DAY_SHOW = [6, 0, 1, 2, 3, 4, 5];
// Unambiguous short names (MQ-UX-11: «الأ» was both الأحد and الأربعاء)
const DAY_SHORT = ["اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت", "أحد"];

// ─── target spec helpers (`all` | `z:1,2` | `g:3` | `z:1;g:2`; zones by slot, groups by gid) ───
function parseTarget(t) {
  const out = { all: false, z: [], g: [] };
  if (!t || t === "all") { out.all = true; return out; }
  String(t).split(";").forEach(p => {
    const ids = p.slice(2).split(",").map(Number).filter(n => n > 0);
    if (p.startsWith("z:")) out.z.push(...ids);
    if (p.startsWith("g:")) out.g.push(...ids);
  });
  if (!out.z.length && !out.g.length) out.all = true;
  return out;
}
function encodeTarget(o) {
  if (o.all || (!o.z.length && !o.g.length)) return "all";
  const parts = [];
  if (o.z.length) parts.push("z:" + [...new Set(o.z)].sort((a, b) => a - b).join(","));
  if (o.g.length) parts.push("g:" + [...new Set(o.g)].sort((a, b) => a - b).join(","));
  return parts.join(";");
}
function targetLabel(t) {
  const o = parseTarget(t);
  if (o.all) return "كل المبنى";
  return [...o.g.map(groupName), ...o.z.map(zoneName)].join("، ") || "كل المبنى";
}

// Target picker in a small dialog; calls back with the new spec.
function openTargetPicker(current, onPick, title) {
  const o = parseTarget(current);
  const box = document.getElementById("proDialog");
  const chips = (list, kind, sel) => list.map(x => {
    const id = kind === "z" ? x.slot : x.gid;
    return `<label class="tp-chip"><input type="checkbox" data-k="${kind}" value="${id}" ${sel.includes(id) ? "checked" : ""}> ${esc(x.name)}</label>`;
  }).join("");
  box.innerHTML = `<div class="pro-modal" role="dialog" aria-modal="true" aria-labelledby="tpTitle">
    <h2 id="tpTitle">${esc(title || "اختيار المناطق")}</h2>
    <label class="tp-chip tp-all"><input type="checkbox" id="tpAll" ${o.all ? "checked" : ""}> كل المبنى</label>
    <h3>المجموعات</h3><div class="tp-list">${chips(PRO.groups, "g", o.g) || '<span class="muted">لا توجد مجموعات بعد</span>'}</div>
    <h3>المناطق</h3><div class="tp-list">${chips(PRO.zones, "z", o.z) || '<span class="muted">لا توجد مناطق بعد</span>'}</div>
    <div class="row" style="margin-top:16px"><button class="primary" id="tpOk">تم</button><button class="ghost" id="tpCancel">إلغاء</button></div></div>`;
  box.style.display = "flex";
  const close = () => { box.style.display = "none"; box.innerHTML = ""; };
  box.querySelector("#tpCancel").onclick = close;
  box.querySelector("#tpOk").onclick = () => {
    const all = box.querySelector("#tpAll").checked;
    const pick = { all, z: [], g: [] };
    if (!all) box.querySelectorAll(".tp-list input:checked").forEach(i => pick[i.dataset.k].push(+i.value));
    close(); onPick(encodeTarget(pick));
  };
  box.querySelectorAll(".tp-list input").forEach(i => i.onchange = () => { if (i.checked) box.querySelector("#tpAll").checked = false; });
}

// Typed confirmation dialog (emergency). Resolves true only if the user typed `word`.
function confirmTyped(title, body, word, danger) {
  return new Promise(resolve => {
    const box = document.getElementById("proDialog");
    box.innerHTML = `<div class="pro-modal ${danger ? "danger" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="ctTitle">
      <h2 id="ctTitle">${esc(title)}</h2><p>${esc(body)}</p>
      <label class="fl" for="ctIn">اكتب «${esc(word)}» للتأكيد</label>
      <input id="ctIn" autocomplete="off" style="width:100%">
      <div class="row" style="margin-top:16px"><button class="${danger ? "primary danger-fill" : "primary"}" id="ctOk" disabled>تأكيد</button><button class="ghost" id="ctNo">إلغاء</button></div></div>`;
    box.style.display = "flex";
    const inp = box.querySelector("#ctIn"), ok = box.querySelector("#ctOk");
    inp.oninput = () => { ok.disabled = inp.value.trim() !== word; };
    const done = v => { box.style.display = "none"; box.innerHTML = ""; resolve(v); };
    ok.onclick = () => done(inp.value.trim() === word);
    box.querySelector("#ctNo").onclick = () => done(false);
    setTimeout(() => inp.focus(), 30);
  });
}

function stateBox(id, kind, text) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = kind === "loading" ? `<div class="pro-state"><span class="spin" aria-hidden="true"></span> ${esc(text || "جارٍ التحميل…")}</div>`
    : kind === "error" ? `<div class="pro-state err"><i data-ic=alert></i> ${esc(text)} <button class="ghost sm" data-onclick="x1">إعادة المحاولة</button></div>`
    : `<div class="pro-state empty">${text}</div>`;
}

// ─── init / data ──────────────────────────────────────────────────────────────────────────────
async function proInit() {
  try {
    const { data, error } = await db.functions.invoke("pro", { body: { action: "status" } });
    if (error || !data) return;           // function missing (non-Pro deployment) → stay hidden
    PRO.on = data.pro === true; PRO.role = data.role; PRO.emergency = data.emergency;
  } catch (_) { return; }
  window.PRO_ON = PRO.on;
  document.querySelectorAll(".pro-only").forEach(el => el.style.display = PRO.on ? "" : "none");
  if (!PRO.on) return;
  document.getElementById("eventsTargetTh")?.style.removeProperty("display");
  await proLoad();
  renderEvents();          // adds the «المناطق» column to the schedule editor
  renderEmergencyBanner();
}

async function proLoad() {
  const [z, g, m, e, h] = await Promise.all([
    db.from("pa_zones").select("id, slot, name, multicast_address, port, codec, volume, local_output, enabled, sort_order").eq("school_id", schoolId).order("slot"),
    db.from("pa_zone_groups").select("id, gid, name").eq("school_id", schoolId).order("gid"),
    db.from("pa_zone_group_members").select("group_id, zone_id"),
    db.from("pa_endpoints").select("id, zone_id, kind, name, address, transport, volume, vendor, config, device_id, local_id, updated_at").eq("school_id", schoolId).order("name"),
    db.from("pa_endpoint_health").select("endpoint_id, ip, version, mcast_ok, online, playing, last_seen_at, reported_at").eq("school_id", schoolId),
  ]);
  const err = [z, g, m, e, h].find(r => r.error);
  if (err) throw new Error(err.MQ.err(error));
  PRO.zones = z.data || []; PRO.groups = g.data || []; PRO.members = m.data || []; PRO.endpoints = e.data || [];
  PRO.health = Object.fromEntries((h.data || []).map(x => [x.endpoint_id, x]));
  PRO.loaded = true;
}

function proShowTab(name) {
  clearInterval(PRO.timer); PRO.timer = null;
  if (!PRO.on) return;
  if (name === "pa_zones") loadZonesTab();
  if (name === "pa_devices") { loadDevicesTab(); PRO.timer = setInterval(() => loadDevicesTab(true), 15000); }
  if (name === "pa_sched") renderZoneSched();
  if (name === "pa_emergency") { loadEmergencyTab(); PRO.timer = setInterval(() => loadEmergencyTab(true), 10000); }
  if (name === "pa_streams") loadStreamsTab();
  if (name === "pa_inputs") loadInputsTab();
}

async function reloadCurrent() {
  const active = document.querySelector(".tabs button.active");
  if (active) proShowTab(active.dataset.tab);
}

// ─── المناطق والمجموعات ────────────────────────────────────────────────────────────────────────
async function loadZonesTab() {
  stateBox("paZonesBox", "loading");
  try { await proLoad(); } catch (e) { return stateBox("paZonesBox", "error", "تعذّر تحميل المناطق: " + MQ.err(e)); }
  renderZones();
}

function renderZones() {
  const box = document.getElementById("paZonesBox");
  const used = PRO.zones.length, gUsed = PRO.groups.length;
  const ro = !isAdmin();
  const zoneRows = PRO.zones.map(z => `<tr class="${z.enabled ? "" : "inactive"}">
      <td class="mono">${z.slot}</td>
      <td><input value="${esc(z.name)}" maxlength="60" ${ro ? "disabled" : ""} data-onchange="x2" data-x2a0="${esc(z.id)}" data-x2a1="name" aria-label="اسم المنطقة"></td>
      <td><input dir="ltr" class="mono" style="min-width:150px;width:150px" value="${esc(z.multicast_address || "")}" placeholder="239.255.10.${z.slot}" ${ro ? "disabled" : ""} data-onchange="x2" data-x2a0="${esc(z.id)}" data-x2a1="multicast_address" aria-label="عنوان البث المتعدد"></td>
      <td><select ${ro ? "disabled" : ""} data-onchange="x2" data-x2a0="${esc(z.id)}" data-x2a1="codec" aria-label="الترميز">
        ${["PCMU", "PCMA", "G722"].map(c => `<option value="${c}" ${z.codec === c ? "selected" : ""}>${c === "G722" ? "G.722 (صوت عريض)" : c === "PCMU" ? "G.711 µ" : "G.711 A"}</option>`).join("")}</select></td>
      <td><input type="range" min="0" max="100" value="${Math.round(z.volume * 100)}" ${ro ? "disabled" : ""} data-onchange="x2" data-x2a0="${esc(z.id)}" data-x2a1="volume" aria-label="مستوى الصوت"> <span class="muted">${Math.round(z.volume * 100)}٪</span></td>
      <td><label class="switch"><input type="checkbox" ${z.local_output ? "checked" : ""} ${ro ? "disabled" : ""} data-onchange="x2" data-x2a0="${esc(z.id)}" data-x2a1="local_output"> ${z.local_output ? "● مخرج التابلت" : "—"}</label></td>
      <td><label class="switch"><input type="checkbox" ${z.enabled ? "checked" : ""} ${ro ? "disabled" : ""} data-onchange="x2" data-x2a0="${esc(z.id)}" data-x2a1="enabled"> ${z.enabled ? "● مُفعّلة" : "غير مُفعّلة"}</label></td>
      <td>${PRO.endpoints.filter(e => e.zone_id === z.id).length}</td>
      <td>${ro ? "" : `<button class="ghost danger sm" data-onclick="x3" data-x3a0="${esc(z.id)}" data-x3a1="${esc(z.name)}" aria-label="حذف المنطقة">حذف</button>`}</td></tr>`).join("");
  const groupCards = PRO.groups.map(g => {
    const ids = PRO.members.filter(m => m.group_id === g.id).map(m => m.zone_id);
    return `<div class="pro-card"><div class="row"><b style="flex:1">${esc(g.name)}</b><span class="muted mono">g:${g.gid}</span></div>
      <div class="tp-list">${PRO.zones.map(z => `<label class="tp-chip"><input type="checkbox" ${ids.includes(z.id) ? "checked" : ""} ${ro ? "disabled" : ""} data-onchange="x5" data-x5a0="${esc(g.id)}" data-x5a1="${esc(z.id)}"> ${esc(z.name)}</label>`).join("") || '<span class="muted">أضف مناطق أولًا</span>'}</div>
      ${ro ? "" : `<div class="row" style="margin-top:8px"><button class="ghost sm" data-onclick="x6" data-x6a0="${esc(g.id)}" data-x6a1="${esc(g.name)}">تسمية</button><button class="ghost danger sm" data-onclick="x7" data-x7a0="${esc(g.id)}" data-x7a1="${esc(g.name)}">حذف</button></div>`}</div>`;
  }).join("");
  box.innerHTML = `
    <div class="row" style="margin-bottom:8px"><h2 style="flex:1;margin:0">المناطق <span class="badge">${used} / ${PRO_LIMITS.zones}</span></h2>
      ${ro ? "" : `<input id="newZoneName" placeholder="اسم المنطقة (مثال: خط الإنتاج 3)" maxlength="60" style="min-width:240px">
      <label class="switch"><input type="checkbox" id="newZoneLocal"> مخرج التابلت</label>
      <button class="primary" data-onclick="x4" ${used >= PRO_LIMITS.zones ? "disabled" : ""}>+ إضافة منطقة</button>`}</div>
    <p class="muted" style="margin-top:0">كل منطقة = بث صوتي مستقل (عنوان بث متعدد + منفذ). السماعات الشبكية وسماعات ميقات في المنطقة تسمع ما يُرسل لها فقط. «مخرج التابلت» = مكبّر الصوت الموصول بجهاز التحكم.</p>
    ${used ? `<div class="tbl-wrap"><table><thead><tr><th>الخانة</th><th>الاسم</th><th>عنوان البث المتعدد</th><th>الترميز</th><th>الصوت</th><th>مخرج التابلت</th><th>الحالة</th><th>السماعات</th><th></th></tr></thead><tbody>${zoneRows}</tbody></table></div>`
      : `<div class="pro-state empty">لا توجد مناطق بعد. أضف أول منطقة (مثل «الساحة» أو «خط الإنتاج 1») لتوجيه الأجراس والنداءات إليها.</div>`}
    <hr class="sep">
    <div class="row" style="margin-bottom:8px"><h2 style="flex:1;margin:0">المجموعات <span class="badge">${gUsed} / ${PRO_LIMITS.groups}</span></h2>
      ${ro ? "" : `<input id="newGroupName" placeholder="اسم المجموعة (مثال: الوردية أ)" maxlength="60" style="min-width:220px">
      <button class="primary" data-onclick="x8" ${gUsed >= PRO_LIMITS.groups ? "disabled" : ""}>+ إضافة مجموعة</button>`}</div>
    <p class="muted" style="margin-top:0">المجموعة تجمع عدة مناطق تحت اسم واحد (الوردية أ، كل المستودعات…) لاستخدامها في الجداول والطوارئ والبث.</p>
    ${gUsed ? `<div class="pro-grid">${groupCards}</div>` : `<div class="pro-state empty">لا توجد مجموعات بعد.</div>`}
    ${ro ? `<p class="muted">عرض فقط — التعديل لمدير المنشأة.</p>` : ""}`;
}

async function zoneField(id, field, el) {
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (field === "volume") v = Math.max(0, Math.min(100, +v)) / 100;
  if (field === "multicast_address") {
    v = String(v).trim() || null;
    if (v && !/^(22[4-9]|23\d)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) { show("msg", "عنوان البث المتعدد يجب أن يكون بين 224.0.0.0 و239.255.255.255", true); return renderZones(); }
  }
  if (field === "name" && !String(v).trim()) { show("msg", "اسم المنطقة مطلوب", true); return renderZones(); }
  const { error } = await db.from("pa_zones").update({ [field]: v }).eq("id", id);
  if (error) show("msg", "تعذّر الحفظ: " + MQ.err(error), true); else { wakeTablets(schoolId); show("msg", "✓ حُفظ — " + MQ.SYNC_SHORT); }
  await proLoad(); renderZones();
}

async function addZone() {
  const name = document.getElementById("newZoneName").value.trim();
  if (!name) return show("msg", "اكتب اسم المنطقة", true);
  const usedSlots = new Set(PRO.zones.map(z => z.slot));
  let slot = 1; while (usedSlots.has(slot) && slot <= 100) slot++;
  if (slot > 100) return show("msg", "وصلت للحد الأقصى (100 منطقة)", true);
  const { error } = await db.from("pa_zones").insert({ school_id: schoolId, slot, name, multicast_address: `239.255.10.${slot}`, local_output: document.getElementById("newZoneLocal").checked, sort_order: slot });
  if (error) return show("msg", String(error.message || "").includes("limit") ? "وصلت للحد الأقصى (100 منطقة)" : "تعذّرت الإضافة: " + MQ.err(error), true);
  show("msg", `✓ أُضيفت المنطقة «${name}» (الخانة ${slot})`);
  loadZonesTab();
}
async function deleteZone(id, name) {
  if (!confirm(`حذف المنطقة «${name}»؟ ستُحذف سماعاتها من القائمة وتُزال من المجموعات.`)) return;
  const { error } = await db.from("pa_zones").delete().eq("id", id);
  if (error) return show("msg", "تعذّر الحذف: " + MQ.err(error), true);
  show("msg", "✓ حُذفت المنطقة"); loadZonesTab();
}
async function toggleMember(groupId, zoneId, on) {
  const r = on ? await db.from("pa_zone_group_members").insert({ group_id: groupId, zone_id: zoneId })
    : await db.from("pa_zone_group_members").delete().eq("group_id", groupId).eq("zone_id", zoneId);
  if (r.error) show("msg", "تعذّر الحفظ: " + MQ.err(r.error), true);
  await proLoad(); renderZones();
}
async function addGroup() {
  const name = document.getElementById("newGroupName").value.trim();
  if (!name) return show("msg", "اكتب اسم المجموعة", true);
  if (PRO.groups.some(g => g.name.trim() === name)) return show("msg", `توجد مجموعة باسم «${name}» — اختر اسماً مختلفاً.`, true);
  const { error } = await db.from("pa_zone_groups").insert({ school_id: schoolId, name });
  if (error) return show("msg", String(error.message || "").includes("limit") ? "وصلت للحد الأقصى (20 مجموعة)" : "تعذّرت الإضافة: " + MQ.err(error), true);
  show("msg", `✓ أُضيفت المجموعة «${name}»`); loadZonesTab();
}
async function renameGroup(id, old) {
  const name = (prompt("اسم المجموعة:", old) || "").trim(); if (!name || name === old) return;
  if (PRO.groups.some(g => g.id !== id && g.name.trim() === name)) return show("msg", `توجد مجموعة باسم «${name}» — اختر اسماً مختلفاً.`, true);
  const { error } = await db.from("pa_zone_groups").update({ name }).eq("id", id);
  if (error) return show("msg", MQ.err(error), true); loadZonesTab();
}
async function deleteGroup(id, name) {
  if (!confirm(`حذف المجموعة «${name}»؟ الأحداث الموجّهة لها ستتوقف عن الوصول لمناطقها.`)) return;
  const { error } = await db.from("pa_zone_groups").delete().eq("id", id);
  if (error) return show("msg", MQ.err(error), true); loadZonesTab();
}

// ─── السماعات والأجهزة ─────────────────────────────────────────────────────────────────────────
async function loadDevicesTab(quiet) {
  if (!quiet) stateBox("paDevicesBox", "loading");
  try { await proLoad(); } catch (e) { return quiet ? null : stateBox("paDevicesBox", "error", "تعذّر تحميل الأجهزة: " + MQ.err(e)); }
  renderDevices();
}
function ago(ts) {
  if (!ts) return "لم يظهر بعد";
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `قبل ${s} ث`;
  if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
  return fmt(ts);
}
function renderDevices() {
  const box = document.getElementById("paDevicesBox");
  const ro = !isAdmin();
  const zoneOpts = sel => PRO.zones.map(z => `<option value="${esc(z.id)}" ${z.id === sel ? "selected" : ""}>${esc(z.name)}</option>`).join("");
  const rows = PRO.endpoints.map(e => {
    const h = PRO.health[e.id];
    const seen = h?.last_seen_at;
    const fresh = h && h.reported_at && Date.now() - new Date(h.reported_at).getTime() < ONLINE_MS;
    const online = e.kind === "NODE" ? !!(h?.online && fresh) : null;
    const status = online === null ? `<span class="dot dot-na"></span> ${e.kind === "STROBE_RELAY" ? "يعمل عند الطوارئ" : "بدون نبض (جهاز خارجي)"}`
      : online ? `<span class="dot dot-on"></span> متصل${h.playing ? " · يشغّل الآن" : ""}` : `<span class="dot dot-off"></span> غير متصل`;
    return `<tr>
      <td><input value="${esc(e.name)}" maxlength="60" ${ro ? "disabled" : ""} data-onchange="x9" data-x9a0="${esc(e.id)}" data-x9a1="name" aria-label="اسم الجهاز"></td>
      <td>${esc(KINDS[e.kind] || e.kind)}${e.vendor ? ` <span class="muted">· ${esc(VENDORS[e.vendor] || e.vendor)}</span>` : ""}</td>
      <td><select ${ro ? "disabled" : ""} data-onchange="x9" data-x9a0="${esc(e.id)}" data-x9a1="zone_id" aria-label="المنطقة">${zoneOpts(e.zone_id)}</select></td>
      <td>${status}<div class="muted">${esc(ago(seen))}</div></td>
      <td class="mono" dir="ltr">${esc(h?.version || "—")}</td>
      <td class="mono" dir="ltr">${esc(h?.ip || e.address || "—")}${h && e.kind === "NODE" ? `<div class="muted">${h.mcast_ok ? "بث متعدد ✓" : "إرسال مباشر"}</div>` : ""}</td>
      <td><input type="range" min="0" max="100" value="${Math.round((e.volume ?? 1) * 100)}" ${ro ? "disabled" : ""} data-onchange="x9" data-x9a0="${esc(e.id)}" data-x9a1="volume" aria-label="الصوت"> <span class="muted">${Math.round((e.volume ?? 1) * 100)}٪</span></td>
      <td>${ro ? "" : `<button class="ghost danger sm" data-onclick="x10" data-x10a0="${esc(e.id)}" data-x10a1="${esc(e.name)}">${e.kind === "NODE" ? "فك الربط" : "حذف"}</button>`}</td></tr>`;
  }).join("");
  const onlineN = PRO.endpoints.filter(e => { const h = PRO.health[e.id]; return e.kind === "NODE" && h?.online && Date.now() - new Date(h.reported_at).getTime() < ONLINE_MS; }).length;
  const nodesN = PRO.endpoints.filter(e => e.kind === "NODE").length;
  box.innerHTML = `
    <div class="kpis"><div class="kpi"><div class="l">الأجهزة</div><div class="n">${PRO.endpoints.length}</div></div>
      <div class="kpi"><div class="l">سماعات ميقات المتصلة</div><div class="n ${onlineN < nodesN ? "warn" : "good"}">${onlineN} / ${nodesN}</div></div>
      <div class="kpi"><div class="l">المناطق</div><div class="n">${PRO.zones.length}</div></div>
      <div class="kpi"><div class="l">آخر تحديث</div><div class="n" style="font-size:18px">${MQ.time(new Date(), true)}</div></div></div>
    <div class="row" style="margin-bottom:8px"><h2 style="flex:1;margin:0">السماعات والأجهزة</h2>
      ${ro || !PRO.zones.length ? "" : `<button class="ghost" data-onclick="x11">+ سماعة شبكية / SIP / Axis / Algo</button>`}
      <button class="ghost" data-onclick="x1">تحديث</button></div>
    <p class="muted" style="margin-top:0">«سماعة ميقات» تُربط من جهاز التحكم (رمز من 6 أرقام أو مسح QR) وتظهر هنا تلقائيًا. الحالة تُحدَّث مع كل مزامنة لجهاز التحكم (كل 25 ثانية تقريبًا).</p>
    <div id="epForm" style="display:none"></div>
    ${PRO.endpoints.length ? `<div class="tbl-wrap"><table><thead><tr><th>الاسم</th><th>النوع</th><th>المنطقة</th><th>الحالة / آخر ظهور</th><th>الإصدار</th><th>العنوان</th><th>الصوت</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="pro-state empty">${PRO.zones.length ? "لا توجد سماعات بعد. اربط «سماعة ميقات» من شاشة «المناطق» في جهاز التحكم، أو أضف سماعة شبكية هنا." : "أضف المناطق أولًا من تبويب «المناطق والمجموعات»."}</div>`}`;
}
async function endpointField(id, field, el) {
  let v = el.value;
  if (field === "volume") v = Math.max(0, Math.min(100, +v)) / 100;
  if (field === "name" && !v.trim()) { show("msg", "الاسم مطلوب", true); return renderDevices(); }
  const { error } = await db.from("pa_endpoints").update({ [field]: v }).eq("id", id);
  if (error) show("msg", "تعذّر الحفظ: " + MQ.err(error), true); else show("msg", "✓ حُفظ — " + MQ.SYNC_SHORT);
  loadDevicesTab(true);
}
async function removeEndpoint(id, name) {
  if (!confirm(`فك ربط «${name}»؟ سيتوقف عن استقبال الصوت ويحتاج ربطًا جديدًا برمز.`)) return;
  const { error } = await db.from("pa_endpoints").delete().eq("id", id);
  if (error) return show("msg", "تعذّر: " + MQ.err(error), true);
  wakeTablets(schoolId); show("msg", "✓ أُزيل — " + MQ.SYNC_SHORT); loadDevicesTab(true);
}
function showEndpointForm() {
  const f = document.getElementById("epForm");
  f.style.display = "block";
  f.innerHTML = `<div class="subtle" style="margin-bottom:12px"><div class="row">
    <input id="epName" placeholder="الاسم (مثال: بوق المستودع)" maxlength="60">
    <select id="epZone" aria-label="المنطقة">${PRO.zones.map(z => `<option value="${esc(z.id)}">${esc(z.name)}</option>`).join("")}</select>
    <select id="epKind" aria-label="النوع">${["MULTICAST_SPEAKER", "SIP", "HTTP_API", "STROBE_RELAY"].map(k => `<option value="${k}">${KINDS[k]}</option>`).join("")}</select>
    <select id="epVendor" aria-label="الشركة"><option value="">—</option>${Object.entries(VENDORS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
    <input id="epAddr" dir="ltr" placeholder="IP / sip:page@10.0.0.5 / http://10.0.0.7" style="min-width:240px">
    <input id="epUser" dir="ltr" placeholder="المستخدم (اختياري)" style="width:140px">
    <input id="epClip" dir="ltr" placeholder="رقم المقطع / النغمة" style="width:150px">
    <button class="primary" data-onclick="x12">حفظ</button><button class="ghost" data-onclick="x13">إلغاء</button></div>
    <p class="muted" style="margin:6px 0 0">كلمة مرور السماعة تُدخل على جهاز التحكم فقط ولا تُحفظ في السحابة.</p></div>`;
}
async function saveEndpoint() {
  const name = document.getElementById("epName").value.trim();
  if (!name) return show("msg", "اكتب اسم السماعة", true);
  const row = {
    school_id: schoolId, zone_id: document.getElementById("epZone").value, kind: document.getElementById("epKind").value,
    name, address: document.getElementById("epAddr").value.trim(), vendor: document.getElementById("epVendor").value || null,
    config: { user: document.getElementById("epUser").value.trim() || undefined, clip: document.getElementById("epClip").value.trim() || undefined },
  };
  const { error } = await db.from("pa_endpoints").insert(row);
  if (error) return show("msg", "تعذّرت الإضافة: " + MQ.err(error), true);
  show("msg", "✓ أُضيفت السماعة"); loadDevicesTab();
}

// ─── جداول المناطق + مولّد الورديات ────────────────────────────────────────────────────────────
function proTargetCell(e) {
  const b = document.createElement("button");
  b.className = "ghost sm target-btn"; b.type = "button";
  b.textContent = "<i data-ic=pin></i> " + targetLabel(e.target);
  b.title = "المناطق التي يرنّ فيها هذا الحدث";
  b.onclick = () => openTargetPicker(e.target || "all", t => { e.target = t; b.textContent = "<i data-ic=pin></i> " + targetLabel(t); }, `مناطق «${e.name}»`);
  return b;
}
window.proTargetCell = proTargetCell;

function renderZoneSched() {
  const box = document.getElementById("paSchedBox");
  const rows = [];
  config.sections.forEach((s, si) => s.schedules.forEach((sc, ci) => sc.events.forEach((e, ei) => rows.push({ s, sc, e, key: `${si}.${ci}.${ei}` }))));
  rows.sort((a, b) => a.e.startMinuteOfDay - b.e.startMinuteOfDay);
  const byZone = {};
  rows.forEach(r => { const t = parseTarget(r.e.target); const label = targetLabel(r.e.target); (byZone[label] = byZone[label] || []).push(r); });
  box.innerHTML = `
    <div class="row" style="margin-bottom:6px"><h2 style="flex:1;margin:0">جداول المناطق</h2>
      <button class="primary" data-onclick="x14"><i data-ic=save></i> حفظ ونشر للتابلت</button></div>
    <p class="muted" style="margin-top:0">لكل حدث «مناطق» يرنّ فيها فقط — مثال: جرس الوردية أ في خطوط الإنتاج 1 و2 فقط، والاستراحة في المستودع. يمكن أيضًا تعديل المناطق من عمود «المناطق» في تبويب الجداول.</p>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>الحدث</th><th>الجدول</th><th>الأيام</th><th>المناطق</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="mono" dir="ltr">${hhmm(r.e.startMinuteOfDay)}</td><td>${esc(r.e.name)}</td><td class="muted">${esc(r.s.name)} · ${esc(r.sc.name)}${r.sc.isActive ? " ✓" : ""}</td>
        <td class="muted">${DAY_SHOW.filter(d => r.e.daysOfWeek & (1 << d)).map(d => DAY_SHORT[d]).join(" ") || "—"}</td>
        <td><button class="ghost sm target-btn" data-onclick="x15" data-x15a0="${r.key}"><i data-ic=pin></i> ${esc(targetLabel(r.e.target))}</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="pro-state empty">لا توجد أحداث بعد. أنشئها من «الجداول» أو بمولّد الورديات أدناه.</div>`}
    <hr class="sep">
    <h2>مولّد جدول الورديات (للمصانع والمستودعات)</h2>
    <p class="muted" style="margin-top:0">أدخل الورديات واستراحاتها وسيُنشأ جدول كامل بأجراس البداية والاستراحات والنهاية، موجّهًا لمناطق كل وردية. الورديات الليلية التي تتجاوز منتصف الليل مدعومة.</p>
    <div id="shiftRows"></div>
    <div class="row" style="margin:8px 0"><button class="ghost" data-onclick="x16">+ وردية</button>
      <label class="muted">اسم الجدول</label><input id="shiftSchedName" value="جدول الورديات" maxlength="60">
      <label class="switch"><input type="checkbox" id="shiftActivate" checked> اجعله الجدول النشط</label>
      <button class="primary" data-onclick="x17"><i data-ic=sliders></i> إنشاء الجدول</button></div>
    <div id="shiftPreview"></div>`;
  if (!PRO.shifts) PRO.shifts = [
    { name: "الوردية أ", start: "06:00", end: "14:00", breaks: "10:00-10:30", target: "all", days: 0b0011111 | (1 << 6) },
    { name: "الوردية ب", start: "14:00", end: "22:00", breaks: "18:00-18:30", target: "all", days: 0b0011111 | (1 << 6) },
  ];
  renderShiftRows();
}
function renderShiftRows() {
  document.getElementById("shiftRows").innerHTML = PRO.shifts.map((s, i) => `<div class="pro-card shift-card">
    <div class="row"><input value="${esc(s.name)}" data-onchange="x18" data-x18a0="${i}" data-x18a1="name" aria-label="اسم الوردية" style="width:150px">
      <label class="muted">من</label><input type="time" value="${esc(s.start)}" data-onchange="x18" data-x18a0="${i}" data-x18a1="start" dir="ltr">
      <label class="muted">إلى</label><input type="time" value="${esc(s.end)}" data-onchange="x18" data-x18a0="${i}" data-x18a1="end" dir="ltr">
      <label class="muted">الاستراحات</label><input value="${esc(s.breaks)}" placeholder="10:00-10:30, 12:00-12:45" dir="ltr" data-onchange="x18" data-x18a0="${i}" data-x18a1="breaks" style="width:210px">
      <button class="ghost sm target-btn" data-onclick="x19" data-x19a0="${i}"><i data-ic=pin></i> ${esc(targetLabel(s.target))}</button>
      <button class="ghost danger sm" data-onclick="x20" data-x20a0="${i}" aria-label="حذف الوردية">✕</button></div>
    <div class="row days" style="margin-top:6px">${DAY_SHOW.map(d => `<label><input type="checkbox" ${s.days & (1 << d) ? "checked" : ""} data-onchange="x21" data-x21a0="${i}" data-x21a1="${d}"> ${DAY_AR[d]}</label>`).join("")}</div></div>`).join("")
    || `<div class="pro-state empty">أضف وردية واحدة على الأقل.</div>`;
}
// Pure generator (also unit-tested in tools/pro-e2e): shifts → events with targets; overnight wraps.
function generateShiftEvents(shifts, sound) {
  const out = [];
  const push = (name, min, days, target, key) => out.push({ name, startMinuteOfDay: ((min % 1440) + 1440) % 1440, durationMin: null, daysOfWeek: days, volume: 1, enabled: true, sortOrder: 0, soundKey: key || sound || "", target });
  const shiftDays = (days, k) => { if (!k) return days; let d = 0; for (let b = 0; b < 7; b++) if (days & (1 << b)) d |= 1 << ((b + k) % 7); return d; };
  for (const s of shifts) {
    const start = toMin(s.start); let end = toMin(s.end); if (end <= start) end += 1440;
    push(`بداية ${s.name}`, start, s.days, s.target);
    String(s.breaks || "").split(/[,،]/).map(x => x.trim()).filter(Boolean).forEach((b, i) => {
      const [a, z] = b.split("-").map(t => toMin(t.trim()));
      let bs = a, be = z; if (bs < start) bs += 1440; if (be <= bs) be += 1440;
      if (bs >= start && be <= end) {
        push(`استراحة ${i + 1} — ${s.name}`, bs, shiftDays(s.days, bs >= 1440 ? 1 : 0), s.target, "bell3");
        push(`نهاية الاستراحة ${i + 1} — ${s.name}`, be, shiftDays(s.days, be >= 1440 ? 1 : 0), s.target);
      }
    });
    push(`نهاية ${s.name}`, end, shiftDays(s.days, end >= 1440 ? 1 : 0), s.target, "bell4");
  }
  return out.sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay);
}
window.generateShiftEvents = generateShiftEvents;
function buildShiftSchedule() {
  if (!PRO.shifts.length) return show("msg", "أضف وردية واحدة على الأقل", true);
  const events = generateShiftEvents(PRO.shifts, sec()?.defaultSoundKey);
  const name = document.getElementById("shiftSchedName").value.trim() || "جدول الورديات";
  const activate = document.getElementById("shiftActivate").checked;
  const scheds = sec().schedules;
  const existing = scheds.findIndex(s => s.name === name);
  const sched = { name, isActive: activate, events };
  if (existing >= 0) scheds[existing] = sched; else scheds.push(sched);
  if (activate) scheds.forEach(s => s.isActive = s === sched);
  document.getElementById("shiftPreview").innerHTML = `<div class="msg ok" style="display:block">✓ أُنشئ «${esc(name)}» بـ ${events.length} حدثًا في قسم «${esc(sec().name)}». راجعها في الجدول أعلاه ثم اضغط «حفظ ونشر».</div>`;
  renderZoneSched();
  document.getElementById("shiftPreview").innerHTML = `<div class="msg ok" style="display:block">✓ أُنشئ «${esc(name)}» بـ ${events.length} حدثًا — اضغط «حفظ ونشر للتابلت» للتطبيق.</div>`;
}

// ─── الطوارئ ──────────────────────────────────────────────────────────────────────────────────
async function loadEmergencyTab(quiet) {
  if (!quiet) stateBox("paEmergencyLog", "loading");
  const [{ data: st }, { data: log, error }] = await Promise.all([
    db.functions.invoke("pro", { body: { action: "status" } }),
    db.from("pa_emergency_log").select("id, preset, target, source, started_at, stopped_at, triggered_by").eq("school_id", schoolId).order("started_at", { ascending: false }).limit(100),
  ]);
  if (st) PRO.emergency = st.emergency;
  renderEmergencyBanner();
  renderEmergencyControls();
  if (error) return stateBox("paEmergencyLog", "error", "تعذّر تحميل السجل: " + MQ.err(error));
  const dur = r => { if (!r.stopped_at) return r.preset === "ALL_CLEAR" ? "—" : "مستمرة"; const s = Math.round((new Date(r.stopped_at) - new Date(r.started_at)) / 1000); return s < 60 ? `${s} ث` : `${Math.floor(s / 60)} د ${s % 60} ث`; };
  document.getElementById("paEmergencyLog").innerHTML = (log || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>النوع</th><th>المناطق</th><th>المصدر</th><th>البداية</th><th>الإيقاف</th><th>المدة</th></tr></thead><tbody>
    ${log.map(r => `<tr class="${!r.stopped_at && r.preset !== "ALL_CLEAR" ? "bad" : ""}"><td><b>${esc(PRESETS[r.preset] || r.preset)}</b></td><td>${esc(targetLabel(r.target))}</td>
      <td>${esc(SOURCES[r.source] || r.source)}${r.triggered_by ? `<div class="muted">${esc(r.triggered_by)}</div>` : ""}</td>
      <td dir="ltr">${fmt(r.started_at)}</td><td dir="ltr">${r.stopped_at ? fmt(r.stopped_at) : "—"}</td><td>${dur(r)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="pro-state empty">لم تُسجَّل أي حالة طوارئ. كل تشغيل (من جهاز التحكم أو لوحة الحريق أو من هنا) يظهر في هذا السجل مع وقت الإيقاف.</div>`;
}
function renderEmergencyBanner() {
  const el = document.getElementById("proEmergencyBanner"); if (!el) return;
  const em = PRO.emergency;
  el.style.display = em ? "flex" : "none";
  if (em) el.innerHTML = `<span class="pulse" aria-hidden="true"></span><b>طوارئ نشطة: ${esc(PRESETS[em.preset] || em.preset)}</b> — ${esc(targetLabel(em.target))} · منذ ${esc(ago(em.started_at))}
    <span style="flex:1"></span><button class="ghost sm" data-onclick="x22">عرض</button>`;
}
function renderEmergencyControls() {
  const box = document.getElementById("paEmergencyCtl");
  const em = PRO.emergency;
  if (!canTrigger()) { box.innerHTML = `<div class="pro-state empty">إطلاق الطوارئ عن بُعد متاح لمدير المنشأة والمشرف فقط.</div>`; return; }
  PRO.emTarget = PRO.emTarget || "all";
  box.innerHTML = em ? `<div class="em-active"><div><b>حالة طوارئ نشطة: ${esc(PRESETS[em.preset] || em.preset)}</b><div class="muted">${esc(targetLabel(em.target))} · ${esc(SOURCES[em.source] || em.source)} · منذ ${esc(ago(em.started_at))}</div></div>
      <button class="primary" data-onclick="x24">⏹ إيقاف الطوارئ</button></div>`
    : `<div class="row" style="gap:10px">${["EVACUATE", "FIRE", "SHELTER"].map(p => `<label class="preset ${PRO.emPreset === p || (!PRO.emPreset && p === "EVACUATE") ? "sel" : ""}"><input type="radio" name="emPreset" value="${p}" ${PRO.emPreset === p || (!PRO.emPreset && p === "EVACUATE") ? "checked" : ""} data-onchange="x25"> ${PRESETS[p]}</label>`).join("")}
      <button class="ghost target-btn" data-onclick="x26"><i data-ic=pin></i> ${esc(targetLabel(PRO.emTarget))}</button>
      <span style="flex:1"></span><button class="primary danger-fill big" data-onclick="x23"><i data-ic=alert></i> إطلاق طوارئ عن بُعد</button></div>
      <p class="muted">يصل الأمر لجهاز التحكم خلال ثوانٍ (وحتى 25 ثانية إن انقطع الاتصال اللحظي)، ويُسجَّل باسمك. يتطلب كتابة كلمة التأكيد.</p>`;
}
async function remoteEmergency(op) {
  const preset = PRO.emPreset || "EVACUATE";
  const ok = op === "start"
    ? await confirmTyped("إطلاق طوارئ عن بُعد", `سيبدأ إنذار «${PRESETS[preset]}» فورًا في: ${targetLabel(PRO.emTarget || "all")}. يتوقف كل جرس ونداء في هذه المناطق.`, "طوارئ", true)
    : await confirmTyped("إيقاف الطوارئ", "سيتوقف الإنذار وتُطفأ الإنذارات الضوئية في كل المناطق المتأثرة.", "إيقاف", false);
  if (!ok) return;
  const { data, error } = await db.functions.invoke("pro", { body: { action: "emergency", op, preset, target: PRO.emTarget || "all", confirm: op === "start" ? "طوارئ" : "إيقاف" } });
  const msg = data?.error || error?.message;
  if (msg) return show("msg", "تعذّر: " + msg, true);
  show("msg", op === "start" ? "أُرسل أمر الطوارئ لجهاز التحكم" : "✓ أُرسل أمر الإيقاف لجهاز التحكم");
  setTimeout(() => loadEmergencyTab(true), 3000);
}

// ─── البث المستمر ───────────────────────────────────────────────────────────────────────────
async function loadStreamsTab() {
  stateBox("paStreamsBox", "loading");
  const { data, error } = await db.from("pa_streams").select("*").eq("school_id", schoolId).order("start_min");
  if (error) return stateBox("paStreamsBox", "error", "تعذّر التحميل: " + MQ.err(error));
  PRO.streams = data || []; renderStreams();
}
function renderStreams() {
  const ro = !isAdmin();
  const box = document.getElementById("paStreamsBox");
  box.innerHTML = `<div class="row" style="margin-bottom:6px"><h2 style="flex:1;margin:0">البث المستمر (موسيقى خلفية / إذاعة / ميكروفون)</h2>
      ${ro ? "" : `<button class="ghost" data-onclick="x27">+ بث مجدول</button>`}</div>
    <p class="muted" style="margin-top:0">يعمل في الوقت المحدد على المناطق المختارة، وينخفض صوته تلقائيًا (−16 dB) عند أي جرس أو نداء أو طوارئ ثم يعود.</p>
    <div id="streamForm" style="display:none"></div>
    ${PRO.streams.length ? `<div class="tbl-wrap"><table><thead><tr><th>الاسم</th><th>المصدر</th><th>المناطق</th><th>الوقت</th><th>الأيام</th><th>الصوت</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${PRO.streams.map(s => `<tr class="${s.enabled ? "" : "inactive"}"><td><b>${esc(s.name)}</b></td><td>${esc(STREAM_KINDS[s.kind])}${s.url ? `<div class="muted mono" dir="ltr" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(s.url)}</div>` : ""}${s.kind === "PLAYLIST" ? `<div class="muted">${(s.playlist || []).length} مقطع</div>` : ""}</td>
        <td>${esc(targetLabel(s.target))}</td><td class="mono" dir="ltr">${hhmm(s.start_min)}–${hhmm(s.end_min)}</td>
        <td class="muted">${DAY_SHOW.filter(d => s.days_mask & (1 << d)).map(d => DAY_SHORT[d]).join(" ")}</td><td>${Math.round(s.volume * 100)}٪</td>
        <td>${s.enabled ? "● مُفعّل" : "غير مُفعّل"}</td>
        <td>${ro ? "" : `<button class="ghost sm" data-onclick="x27" data-x27a0="${esc(s.id)}">تعديل</button> <button class="ghost danger sm" data-onclick="x28" data-x28a0="${esc(s.id)}">حذف</button>`}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="pro-state empty">لا يوجد بث مجدول. مثال: موسيقى هادئة في «الوردية أ» من 7:00 إلى 16:00.</div>`}`;
}
function showStreamForm(id) {
  const s = PRO.streams.find(x => x.id === id) || { name: "", kind: "RADIO", url: "", playlist: [], target: "all", days_mask: 127, start_min: 420, end_min: 960, volume: 0.5, enabled: true };
  PRO.editStream = JSON.parse(JSON.stringify(s));
  const f = document.getElementById("streamForm"); f.style.display = "block";
  const lib = (typeof library !== "undefined" ? library : []);
  f.innerHTML = `<div class="subtle" style="margin-bottom:12px">
    <div class="row"><input id="stName" value="${esc(s.name)}" placeholder="الاسم (مثال: موسيقى الصباح)" maxlength="60">
      <select id="stKind" data-onchange="x29">${Object.entries(STREAM_KINDS).map(([k, v]) => `<option value="${k}" ${s.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input id="stUrl" dir="ltr" value="${esc(s.url || "")}" placeholder="https://stream.example.com/live.mp3" style="min-width:280px;${s.kind === "RADIO" ? "" : "display:none"}">
      <select id="stList" multiple size="3" style="min-width:220px;${s.kind === "PLAYLIST" ? "" : "display:none"}" aria-label="مقاطع القائمة">
        ${Object.entries(SOUNDS).map(([k, v]) => `<option value="${k}" ${(s.playlist || []).includes(k) ? "selected" : ""}>${esc(v)}</option>`).join("")}
        ${lib.map(l => `<option value="url:${esc(l.url)}" ${(s.playlist || []).includes("url:" + l.url) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
    <div class="row" style="margin-top:8px"><label class="muted">من</label><input type="time" id="stFrom" value="${hhmm(s.start_min)}" dir="ltr">
      <label class="muted">إلى</label><input type="time" id="stTo" value="${hhmm(s.end_min % 1440)}" dir="ltr">
      <button class="ghost target-btn" data-onclick="x30"><i data-ic=pin></i> ${esc(targetLabel(s.target))}</button>
      <label class="muted">الصوت</label><input type="range" id="stVol" min="0" max="100" value="${Math.round(s.volume * 100)}">
      <label class="switch"><input type="checkbox" id="stEn" ${s.enabled ? "checked" : ""}> مُفعّل</label></div>
    <div class="row days" style="margin-top:6px">${DAY_SHOW.map(d => `<label><input type="checkbox" class="stDay" value="${d}" ${s.days_mask & (1 << d) ? "checked" : ""}> ${DAY_AR[d]}</label>`).join("")}</div>
    <div class="row" style="margin-top:10px"><button class="primary" data-onclick="x31"><i data-ic=save></i> حفظ</button><button class="ghost" data-onclick="x32">إلغاء</button></div></div>`;
}
async function saveStream() {
  const s = PRO.editStream;
  const kind = document.getElementById("stKind").value;
  let end = toMin(document.getElementById("stTo").value); if (end === 0) end = 1440;
  const row = {
    school_id: schoolId, name: document.getElementById("stName").value.trim(), kind,
    url: kind === "RADIO" ? document.getElementById("stUrl").value.trim() : null,
    playlist: kind === "PLAYLIST" ? [...document.getElementById("stList").selectedOptions].map(o => o.value) : [],
    target: s.target, start_min: toMin(document.getElementById("stFrom").value), end_min: end,
    days_mask: [...document.querySelectorAll(".stDay:checked")].reduce((m, i) => m | (1 << +i.value), 0),
    volume: +document.getElementById("stVol").value / 100, enabled: document.getElementById("stEn").checked,
  };
  if (!row.name) return show("msg", "اكتب اسم البث", true);
  if (kind === "RADIO" && !/^https?:\/\//i.test(row.url || "")) return show("msg", "رابط الإذاعة يجب أن يبدأ بـ http:// أو https://", true);
  if (kind === "PLAYLIST" && !row.playlist.length) return show("msg", "اختر مقطعًا واحدًا على الأقل", true);
  if (!row.days_mask) return show("msg", "اختر يومًا واحدًا على الأقل", true);
  const r = s.id ? await db.from("pa_streams").update(row).eq("id", s.id) : await db.from("pa_streams").insert(row);
  if (r.error) return show("msg", "تعذّر الحفظ: " + MQ.err(r.error), true);
  wakeTablets(schoolId); show("msg", "✓ حُفظ البث — " + MQ.SYNC_SHORT); loadStreamsTab();
}
async function deleteStream(id) {
  if (!confirm("حذف هذا البث المجدول؟")) return;
  const { error } = await db.from("pa_streams").delete().eq("id", id);
  if (error) return show("msg", MQ.err(error), true); loadStreamsTab();
}

// ─── مداخل الإنذار (لوحة الحريق) ─────────────────────────────────────────────────────────────
async function loadInputsTab() {
  if (!isAdmin()) { stateBox("paInputsBox", "empty", "إعداد مداخل لوحة الحريق متاح لمدير المنشأة فقط."); return; }
  stateBox("paInputsBox", "loading");
  const { data, error } = await db.from("pa_triggers").select("*").eq("school_id", schoolId).order("created_at");
  if (error) return stateBox("paInputsBox", "error", "تعذّر التحميل: " + MQ.err(error));
  PRO.triggers = data || []; renderInputs();
}
function renderInputs() {
  const box = document.getElementById("paInputsBox");
  box.innerHTML = `<div class="row" style="margin-bottom:6px"><h2 style="flex:1;margin:0">مداخل الإنذار الخارجية (لوحة الحريق)</h2><button class="ghost" data-onclick="x33">+ مدخل</button></div>
    <p class="muted" style="margin-top:0">عند وصول إشارة من لوحة الحريق يبدأ الإنذار المختار في مناطقه تلقائياً، ويصل تنبيه بالبريد للإدارة. يتولى فني التركيب التوصيل (التفاصيل داخل كل بطاقة).</p>
    <div id="inForm" style="display:none"></div>
    ${PRO.triggers.length ? PRO.triggers.map(t => `<div class="pro-card"><div class="row"><b style="flex:1">${esc(t.name)}</b><span class="badge">${t.kind === "MQTT" ? "عبر وسيط MQTT" : "إشارة موقّعة"}</span><span>${t.enabled ? "● مُفعّل" : "غير مُفعّل"}</span></div>
      <div class="muted" style="margin:6px 0">عند التفعيل: <b>${esc(PRESETS[t.preset])}</b> في ${esc(targetLabel(t.target))}${t.auto_stop ? " · يتوقف عند زوال الإشارة" : " · الإيقاف يدويًا"}</div>
      ${t.kind === "MQTT" ? `<details class="tech"><summary>تفاصيل للفني (وسيط MQTT)</summary><div class="mono" dir="ltr">${esc(t.mqtt_url)} · topic: ${esc(t.topic)} · ON="${esc(t.on_value)}" OFF="${esc(t.off_value)}"</div></details>`
        : `<details class="tech"><summary>تفاصيل للفني (طريقة التوصيل والمفتاح)</summary>
          <div class="mono small" dir="ltr">POST http://&lt;IP جهاز التحكم&gt;:8723/api/trigger/${esc(t.id)}<br>X-Meeqat-Timestamp: &lt;unix&gt; · X-Meeqat-Signature: sha256=HMAC(secret, ts + "." + body)<br>body: {"state":"ON"} | {"state":"OFF"}</div>
          <div class="row" style="margin-top:6px"><span class="muted">المفتاح السري:</span><code class="mono secret" id="sec-${esc(t.id)}">••••••••••••</code>
          <button class="ghost sm" data-onclick="x34" data-x34a0="${esc(t.id)}">إظهار</button><button class="ghost sm" data-onclick="x35" data-x35a0="${esc(t.id)}">تجديد المفتاح</button></div></details>`}
      <div class="row" style="margin-top:8px"><button class="ghost sm" data-onclick="x33" data-x33a0="${esc(t.id)}">تعديل</button><button class="ghost danger sm" data-onclick="x36" data-x36a0="${esc(t.id)}">حذف</button></div></div>`).join("")
      : `<div class="pro-state empty">لا توجد مداخل. أضف «لوحة الحريق» ليبدأ إنذار الحريق تلقائيًا عند تفعيلها. أمثلة التوصيل: ESP32 (تلامس → HTTP موقّع) و Shelly i4 (تلامس → MQTT).</div>`}`;
}
function showInputForm(id) {
  const t = PRO.triggers.find(x => x.id === id) || { name: "لوحة الحريق", kind: "WEBHOOK", mqtt_url: "", mqtt_user: "", mqtt_pass: "", topic: "", on_value: "ON", off_value: "OFF", preset: "FIRE", target: "all", auto_stop: false, enabled: true };
  PRO.editTrigger = JSON.parse(JSON.stringify(t));
  const f = document.getElementById("inForm"); f.style.display = "block";
  f.innerHTML = `<div class="subtle" style="margin-bottom:12px"><div class="row">
    <input id="inName" value="${esc(t.name)}" maxlength="60" placeholder="الاسم">
    <select id="inKind" data-onchange="x37"><option value="WEBHOOK" ${t.kind === "WEBHOOK" ? "selected" : ""}>Webhook موقّع (ESP32)</option><option value="MQTT" ${t.kind === "MQTT" ? "selected" : ""}>MQTT (Shelly / وسيط)</option></select>
    <select id="inPreset">${["FIRE", "EVACUATE", "SHELTER"].map(p => `<option value="${p}" ${t.preset === p ? "selected" : ""}>${PRESETS[p]}</option>`).join("")}</select>
    <button class="ghost target-btn" data-onclick="x38"><i data-ic=pin></i> ${esc(targetLabel(t.target))}</button>
    <label class="switch"><input type="checkbox" id="inAuto" ${t.auto_stop ? "checked" : ""}> يتوقف عند زوال الإشارة</label>
    <label class="switch"><input type="checkbox" id="inEn" ${t.enabled ? "checked" : ""}> مُفعّل</label></div>
    <div class="row" id="inMqtt" style="margin-top:8px;${t.kind === "MQTT" ? "" : "display:none"}">
      <input id="inUrl" dir="ltr" value="${esc(t.mqtt_url || "")}" placeholder="tcp://192.168.1.10:1883" style="min-width:220px">
      <input id="inTopic" dir="ltr" value="${esc(t.topic || "")}" placeholder="shellies/shellyi4/input/0" style="min-width:220px">
      <input id="inUser" dir="ltr" value="${esc(t.mqtt_user || "")}" placeholder="user" style="width:120px">
      <input id="inPass" dir="ltr" type="password" value="${esc(t.mqtt_pass || "")}" placeholder="password" style="width:120px" autocomplete="new-password">
      <label class="muted">قيمة التفعيل</label><input id="inOn" dir="ltr" value="${esc(t.on_value)}" style="width:70px">
      <label class="muted">قيمة الإيقاف</label><input id="inOff" dir="ltr" value="${esc(t.off_value)}" style="width:70px"></div>
    <div class="row" style="margin-top:10px"><button class="primary" data-onclick="x39"><i data-ic=save></i> حفظ</button><button class="ghost" data-onclick="x40">إلغاء</button></div></div>`;
}
async function saveInput() {
  const t = PRO.editTrigger, kind = document.getElementById("inKind").value;
  const row = {
    school_id: schoolId, name: document.getElementById("inName").value.trim(), kind,
    preset: document.getElementById("inPreset").value, target: t.target, auto_stop: document.getElementById("inAuto").checked,
    enabled: document.getElementById("inEn").checked,
    mqtt_url: kind === "MQTT" ? document.getElementById("inUrl").value.trim() : null,
    topic: kind === "MQTT" ? document.getElementById("inTopic").value.trim() : null,
    mqtt_user: kind === "MQTT" ? document.getElementById("inUser").value.trim() || null : null,
    mqtt_pass: kind === "MQTT" ? document.getElementById("inPass").value || null : null,
    on_value: kind === "MQTT" ? document.getElementById("inOn").value.trim() || "ON" : "ON",
    off_value: kind === "MQTT" ? document.getElementById("inOff").value.trim() || "OFF" : "OFF",
  };
  if (!row.name) return show("msg", "اكتب اسم المدخل", true);
  if (kind === "MQTT" && (!/^(tcp|ssl):\/\//i.test(row.mqtt_url || "") || !row.topic)) return show("msg", "عنوان الوسيط يبدأ بـ tcp:// أو ssl:// والموضوع مطلوب", true);
  const r = t.id ? await db.from("pa_triggers").update(row).eq("id", t.id) : await db.from("pa_triggers").insert(row);
  if (r.error) return show("msg", "تعذّر الحفظ: " + MQ.err(r.error), true);
  wakeTablets(schoolId); show("msg", "✓ حُفظ المدخل — " + MQ.SYNC_SHORT); loadInputsTab();
}
async function rotateSecret(id) {
  if (!confirm("تجديد المفتاح السري؟ يجب تحديثه في لوحة ESP32 بعدها.")) return;
  const { data, error } = await db.functions.invoke("pro", { body: { action: "rotate_secret", triggerId: id } });
  if (error || data?.error) return show("msg", "تعذّر: " + (data?.error || MQ.err(error)), true);
  show("msg", "✓ جُدّد المفتاح"); await loadInputsTab(); revealSecret(id);
}
function revealSecret(id) { const t = PRO.triggers.find(x => x.id === id); const el = document.getElementById("sec-" + id); if (t && el) el.textContent = t.secret; }
async function deleteInput(id) {
  if (!confirm("حذف هذا المدخل؟ لن تبدأ الطوارئ من لوحة الحريق بعدها.")) return;
  const { error } = await db.from("pa_triggers").delete().eq("id", id);
  if (error) return show("msg", MQ.err(error), true); loadInputsTab();
}

// ─── handlers ───────────────────────────────────────────────────────────────────────────────
function findEventByKey(k) { const [a, b, c] = k.split(".").map(Number); return config.sections[a].schedules[b].events[c]; }
Object.assign(_H, {
  x0() { showTab(this.dataset.tab) },
  x1() { reloadCurrent() },
  x2() { zoneField(this.dataset.x2a0, this.dataset.x2a1, this) },
  x3() { deleteZone(this.dataset.x3a0, this.dataset.x3a1) },
  x4() { addZone() },
  x5() { toggleMember(this.dataset.x5a0, this.dataset.x5a1, this.checked) },
  x6() { renameGroup(this.dataset.x6a0, this.dataset.x6a1) },
  x7() { deleteGroup(this.dataset.x7a0, this.dataset.x7a1) },
  x8() { addGroup() },
  x9() { endpointField(this.dataset.x9a0, this.dataset.x9a1, this) },
  x10() { removeEndpoint(this.dataset.x10a0, this.dataset.x10a1) },
  x11() { showEndpointForm() },
  x12() { saveEndpoint() },
  x13() { document.getElementById("epForm").style.display = "none" },
  async x14() { await saveConfig(); renderZoneSched() },
  x15() { const e = findEventByKey(this.dataset.x15a0); openTargetPicker(e.target || "all", t => { e.target = t; renderZoneSched(); }, `مناطق «${e.name}»`) },
  x16() { PRO.shifts.push({ name: `وردية ${PRO.shifts.length + 1}`, start: "22:00", end: "06:00", breaks: "02:00-02:30", target: "all", days: 127 }); renderShiftRows() },
  x17() { buildShiftSchedule() },
  x18() { PRO.shifts[+this.dataset.x18a0][this.dataset.x18a1] = this.value },
  x19() { const s = PRO.shifts[+this.dataset.x19a0]; openTargetPicker(s.target, t => { s.target = t; renderShiftRows(); }, `مناطق «${s.name}»`) },
  x20() { PRO.shifts.splice(+this.dataset.x20a0, 1); renderShiftRows() },
  x21() { const s = PRO.shifts[+this.dataset.x21a0]; const b = 1 << +this.dataset.x21a1; s.days = this.checked ? (s.days | b) : (s.days & ~b) },
  x22() { showTab("pa_emergency") },
  x23() { remoteEmergency("start") },
  x24() { remoteEmergency("stop") },
  x25() { PRO.emPreset = this.value; renderEmergencyControls() },
  x26() { openTargetPicker(PRO.emTarget || "all", t => { PRO.emTarget = t; renderEmergencyControls(); }, "مناطق الطوارئ") },
  x27() { showStreamForm(this.dataset.x27a0) },
  x28() { deleteStream(this.dataset.x28a0) },
  x29() { const k = this.value; document.getElementById("stUrl").style.display = k === "RADIO" ? "" : "none"; document.getElementById("stList").style.display = k === "PLAYLIST" ? "" : "none" },
  x30() { const s = PRO.editStream; openTargetPicker(s.target, t => { s.target = t; this.textContent = "<i data-ic=pin></i> " + targetLabel(t); }, "مناطق البث") },
  x31() { saveStream() },
  x32() { document.getElementById("streamForm").style.display = "none" },
  x33() { showInputForm(this.dataset.x33a0) },
  x34() { revealSecret(this.dataset.x34a0) },
  x35() { rotateSecret(this.dataset.x35a0) },
  x36() { deleteInput(this.dataset.x36a0) },
  x37() { document.getElementById("inMqtt").style.display = this.value === "MQTT" ? "" : "none" },
  x38() { const t = PRO.editTrigger; openTargetPicker(t.target, v => { t.target = v; this.textContent = "<i data-ic=pin></i> " + targetLabel(v); }, "مناطق الإنذار") },
  x39() { saveInput() },
  x40() { document.getElementById("inForm").style.display = "none" },
});
document.addEventListener("keydown", ev => { if (ev.key === "Escape") { const d = document.getElementById("proDialog"); if (d && d.style.display === "flex") { d.style.display = "none"; d.innerHTML = ""; } } });
