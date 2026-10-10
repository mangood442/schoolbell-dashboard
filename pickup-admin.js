// ميقات – ولي الأمر: school-manager pages (students & guardians, pickup settings, notices).
// Loaded after index.js and shares its globals (db, schoolId, me, myRole, config, esc, show, _H).
// No inline handlers: buttons use data-onclick="pN" routed through index.js's delegated _H map.

const XLSX_SRC = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const XLSX_SRI = "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT";
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]; // 0 = الأحد
const RELATIONS = { parent: "وليّ أمر", authorized: "مفوَّض" };

let students = [], stuFilter = "", importRows = [], pickupSettings = null;
const canWrite = () => myRole === "admin" || myRole === "manager";
const sectionsWithId = () => (config.sections || []).filter(s => s.id);
const sectionName = id => (sectionsWithId().find(s => s.id === id) || {}).name || "كل المدرسة";

// +9665XXXXXXXX or null — same rules as SQL normalize_sa_phone().
function normPhone(p) {
  let d = String(p ?? "").replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6F0)).replace(/\D/g, "");
  if (d.startsWith("00966")) d = d.slice(5);
  else if (d.startsWith("966") && d.length >= 12) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? "+966" + d : null;
}
const localPhone = p => (p || "").replace(/^\+966/, "0");

// ─── Students & guardians ─────────────────────────────────────────────────────
async function loadStudents() {
  const { data, error } = await db.from("students")
    .select("id, full_name, speak_name, grade, class_name, section_id, external_id, active, student_guardians(relation, valid_until, guardian_id, guardians(id, name, phone))")
    .eq("school_id", schoolId).order("grade").order("class_name").order("full_name").limit(5000);
  if (error) return show("msg", "تعذّر تحميل الطلاب: " + error.message, true);
  students = data || [];
  renderStudents();
}

function renderStudents() {
  const q = stuFilter.trim();
  const list = students.filter(s => !q || s.full_name.includes(q) || (s.external_id || "") === q ||
    (s.student_guardians || []).some(l => localPhone(l.guardians?.phone).includes(q.replace(/\D/g, "") || "~")));
  const shown = list.slice(0, 300);
  const secOpts = sel => `<option value="">كل المدرسة</option>` + sectionsWithId().map(s =>
    `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  document.getElementById("stuBody").innerHTML = shown.map(s => {
    const links = (s.student_guardians || []).map(l => {
      const expired = l.valid_until && new Date(l.valid_until) < new Date();
      return `<span class="chip${expired ? " expired" : ""}" title="${esc(l.valid_until ? "حتى " + fmt(l.valid_until) : "")}">
        ${esc(l.guardians?.name || "")} <span dir="ltr" class="mono">${esc(localPhone(l.guardians?.phone))}</span>
        · ${esc(RELATIONS[l.relation] || l.relation)}${expired ? " (منتهٍ)" : ""}
        ${canWrite() ? `<button class="chip-x" data-onclick="p6" data-p6a0="${esc(s.id)}" data-p6a1="${esc(l.guardian_id)}" title="إزالة">✕</button>` : ""}</span>`;
    }).join(" ");
    return `<tr class="${s.active ? "" : "inactive"}">
      <td><b>${esc(s.full_name)}</b>${s.external_id ? `<div class="muted mono">${esc(s.external_id)}</div>` : ""}</td>
      <td><input value="${esc(s.speak_name || "")}" placeholder="كما يُنطق" style="width:150px" data-onchange="p3" data-p3a0="${esc(s.id)}" ${canWrite() ? "" : "disabled"}></td>
      <td>${esc([s.grade, s.class_name].filter(Boolean).join(" "))}</td>
      <td><select data-onchange="p4" data-p4a0="${esc(s.id)}" ${canWrite() ? "" : "disabled"}>${secOpts(s.section_id)}</select></td>
      <td>${links || '<span class="muted">—</span>'}
        ${canWrite() ? `<button class="ghost sm" data-onclick="p5" data-p5a0="${esc(s.id)}">+ وليّ أمر</button>` : ""}
        <div id="gform-${esc(s.id)}"></div></td>
      <td>${canWrite() ? `<button class="ghost sm" data-onclick="p7" data-p7a0="${esc(s.id)}" data-p7a1="${s.active ? "0" : "1"}">${s.active ? "إيقاف" : "تفعيل"}</button>` : ""}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">لا يوجد طلاب بعد — استورد ملف نور أو أضف طالبًا.</td></tr>`;
  document.getElementById("stuCount").textContent =
    `${list.length} طالب${list.length > shown.length ? ` (يُعرض أول ${shown.length} — استخدم البحث)` : ""}`;
}

async function updateStudent(id, patch) {
  const { error } = await db.from("students").update(patch).eq("id", id);
  if (error) return show("msg", "فشل الحفظ: " + error.message, true);
  Object.assign(students.find(s => s.id === id) || {}, patch);
  show("msg", "✓ حُفظ");
  if ("active" in patch) renderStudents();
}

function showGuardianForm(studentId) {
  const box = document.getElementById("gform-" + studentId);
  box.innerHTML = `<div class="row subtle" style="margin-top:8px">
    <input id="gPhone-${esc(studentId)}" placeholder="05XXXXXXXX" dir="ltr" style="width:130px">
    <input id="gName-${esc(studentId)}" placeholder="الاسم (اختياري)" style="width:140px">
    <select id="gRel-${esc(studentId)}"><option value="parent">وليّ أمر</option><option value="authorized">مفوَّض</option></select>
    <input id="gUntil-${esc(studentId)}" type="date" title="ينتهي التفويض في (للمفوَّض)">
    <button class="primary sm" data-onclick="p8" data-p8a0="${esc(studentId)}">حفظ</button></div>`;
}

async function saveGuardian(studentId) {
  const v = id => document.getElementById(id + "-" + studentId).value.trim();
  const phone = normPhone(v("gPhone"));
  if (!phone) return show("msg", "رقم الجوال غير صالح (مثال: 05XXXXXXXX).", true);
  const until = v("gUntil");
  const { error } = await db.rpc("upsert_guardian_link", {
    p_student: studentId, p_phone: phone, p_name: v("gName") || null, p_relation: v("gRel"),
    p_valid_until: until ? new Date(until + "T23:59:59+03:00").toISOString() : null,
  });
  if (error) return show("msg", "فشل: " + error.message, true);
  show("msg", "✓ أُضيف وليّ الأمر");
  loadStudents();
}

async function removeLink(studentId, guardianId) {
  if (!confirm("إزالة وليّ الأمر من هذا الطالب؟")) return;
  const { error } = await db.from("student_guardians").delete().eq("student_id", studentId).eq("guardian_id", guardianId);
  if (error) return show("msg", "فشل: " + error.message, true);
  loadStudents();
}

function showStudentForm() {
  const f = document.getElementById("stuForm");
  f.style.display = "block";
  f.innerHTML = `<div class="row subtle" style="margin-bottom:12px">
    <input id="nsName" placeholder="اسم الطالب الكامل" style="min-width:220px">
    <input id="nsGrade" placeholder="الصف" style="width:110px"><input id="nsClass" placeholder="الفصل" style="width:80px">
    <input id="nsPhone" placeholder="جوال وليّ الأمر 05…" dir="ltr" style="width:150px">
    <button class="primary" data-onclick="p9">إضافة</button></div>`;
}

async function addStudent() {
  const v = id => document.getElementById(id).value.trim();
  if (!v("nsName")) return show("msg", "اكتب اسم الطالب.", true);
  if (v("nsPhone") && !normPhone(v("nsPhone"))) return show("msg", "رقم الجوال غير صالح.", true);
  const { data, error } = await db.rpc("import_students", { p_school: schoolId, p_rows: [{
    full_name: v("nsName"), grade: v("nsGrade"), class_name: v("nsClass"), phone: v("nsPhone") }] });
  if (error) return show("msg", "فشل: " + error.message, true);
  show("msg", data.inserted ? "✓ أُضيف الطالب" : "✓ الطالب موجود — حُدِّثت بياناته");
  document.getElementById("stuForm").style.display = "none";
  loadStudents();
}

// ─── Import (Noor export: CSV / Excel) ────────────────────────────────────────
const COLS = {
  full_name: [/اسم\s*الطالب/, /^الاسم/, /^اسم$/, /student/i, /name/i],
  grade: [/الصف/, /المرحلة/, /grade/i],
  class_name: [/الفصل/, /الشعبة/, /class/i],
  phone: [/جوال/, /هاتف/, /موبايل/, /phone|mobile/i],
  guardian_name: [/ولي|وليّ/],
  external_id: [/هوية/, /السجل/, /رقم\s*الطالب/, /noor|id/i],
  section: [/القسم/, /section/i],
};
function mapHeader(cells) {
  const map = {};
  const taken = new Set();
  // guardian name first so "اسم ولي الأمر" is not taken as the student name
  for (const key of ["guardian_name", "phone", "full_name", "grade", "class_name", "external_id", "section"]) {
    cells.forEach((c, i) => {
      const t = String(c ?? "").trim();
      if (map[key] !== undefined || taken.has(i) || !t) return;
      if (key === "guardian_name" && !(/(ولي|وليّ)/.test(t) && /اسم/.test(t))) return;
      if (key !== "guardian_name" && COLS[key].some(r => r.test(t))) { map[key] = i; taken.add(i); }
      else if (key === "guardian_name") { map[key] = i; taken.add(i); }
    });
  }
  return map;
}

function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = XLSX_SRC; s.integrity = XLSX_SRI; s.crossOrigin = "anonymous";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("تعذّر تحميل قارئ Excel — احفظ الملف بصيغة CSV وأعد المحاولة."));
    document.head.appendChild(s);
  });
}

async function readSheet(file) {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) text = new TextDecoder("windows-1256").decode(buf);  // old Excel/Noor CSV
    return parseCsv(text.replace(/^\uFEFF/, ""));
  }
  const XLSX = await loadXlsxLib();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
}

async function importFile(file) {
  document.getElementById("stuFile").value = "";
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return show("msg", "الملف أكبر من 10MB.", true);
  let rows;
  try { rows = await readSheet(file); } catch (e) { return show("msg", e.message || String(e), true); }
  const hIdx = rows.slice(0, 15).findIndex(r => { const m = mapHeader(r); return m.full_name !== undefined; });
  if (hIdx < 0) return show("msg", "لم نجد عمود «اسم الطالب» في أول 15 صفًا من الملف.", true);
  const map = mapHeader(rows[hIdx]);
  const get = (r, k) => map[k] === undefined ? "" : String(r[map[k]] ?? "").trim();
  importRows = rows.slice(hIdx + 1).map((r, i) => {
    const row = { full_name: get(r, "full_name"), grade: get(r, "grade"), class_name: get(r, "class_name"),
      external_id: get(r, "external_id"), phone: get(r, "phone"), guardian_name: get(r, "guardian_name"), section: get(r, "section") };
    const issues = [];
    if (!row.full_name) issues.push("اسم الطالب مفقود");
    const p = row.phone ? normPhone(row.phone) : null;
    if (row.phone && !p) issues.push("رقم جوال غير صالح (يُستورد الطالب بلا وليّ أمر)");
    if (!row.phone) issues.push("بلا جوال وليّ أمر");
    if (p) row.phone = p;
    return { n: hIdx + i + 2, row, issues, fatal: !row.full_name };
  }).filter(x => Object.values(x.row).some(Boolean));
  renderImportPreview(map);
}

function renderImportPreview(map) {
  const ok = importRows.filter(x => !x.fatal);
  const warn = importRows.filter(x => !x.fatal && x.issues.length).length;
  const fatal = importRows.length - ok.length;
  const colNames = { full_name: "اسم الطالب", grade: "الصف", class_name: "الفصل", phone: "جوال وليّ الأمر",
    guardian_name: "اسم وليّ الأمر", external_id: "رقم الطالب", section: "القسم" };
  const found = Object.keys(colNames).filter(k => map[k] !== undefined).map(k => colNames[k]).join("، ");
  const box = document.getElementById("importBox");
  box.style.display = "block";
  box.innerHTML = `<div class="subtle" style="margin-bottom:14px">
    <div class="row"><b style="flex:1">معاينة الاستيراد: ${importRows.length} صف — ${ok.length} صالح، ${warn} بتنبيه، ${fatal} مرفوض</b>
      <label class="muted">القسم الافتراضي</label>
      <select id="impSection"><option value="">كل المدرسة</option>${sectionsWithId().map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select>
      <button class="primary" data-onclick="p10" ${ok.length && canWrite() ? "" : "disabled"}>استيراد ${ok.length} طالب</button>
      <button class="ghost" data-onclick="p11">إلغاء</button></div>
    <p class="muted">الأعمدة المكتشفة: ${esc(found)}</p>
    <table><thead><tr><th>#</th><th>الطالب</th><th>الصف</th><th>الفصل</th><th>الجوال</th><th>ملاحظات</th></tr></thead><tbody>
    ${importRows.slice(0, 50).map(x => `<tr class="${x.fatal ? "bad" : x.issues.length ? "warn" : ""}"><td class="mono">${x.n}</td>
      <td>${esc(x.row.full_name)}</td><td>${esc(x.row.grade)}</td><td>${esc(x.row.class_name)}</td>
      <td dir="ltr" class="mono">${esc(localPhone(x.row.phone))}</td><td>${x.fatal ? "✕ " : x.issues.length ? "⚠ " : "✓"}${esc(x.issues.join("، "))}</td></tr>`).join("")}
    </tbody></table>${importRows.length > 50 ? `<p class="muted">يُعرض أول 50 صفًا فقط.</p>` : ""}</div>`;
}

async function runImport() {
  const rows = importRows.filter(x => !x.fatal).map(x => x.row);
  const section = document.getElementById("impSection").value || null;
  const total = { inserted: 0, updated: 0, links: 0, errors: [] };
  for (let i = 0; i < rows.length; i += 1000) {
    show("msg", `… جارٍ الاستيراد ${Math.min(i + 1000, rows.length)} / ${rows.length}`);
    const { data, error } = await db.rpc("import_students", { p_school: schoolId, p_rows: rows.slice(i, i + 1000), p_default_section: section });
    if (error) return show("msg", "فشل الاستيراد: " + error.message, true);
    total.inserted += data.inserted; total.updated += data.updated; total.links += data.links;
    total.errors.push(...(data.errors || []));
  }
  importRows = [];
  document.getElementById("importBox").style.display = "none";
  show("msg", `✓ تم: ${total.inserted} طالب جديد، ${total.updated} محدَّث، ${total.links} ربط وليّ أمر` +
    (total.errors.length ? ` — ${total.errors.length} تنبيه (أرقام غير صالحة)` : ""));
  loadStudents();
}

// ─── Pickup settings ──────────────────────────────────────────────────────────
async function loadPickupSettings() {
  const { data, error } = await db.from("pickup_settings").select("*").eq("school_id", schoolId).maybeSingle();
  if (error) return show("msg", "تعذّر تحميل الإعدادات: " + error.message, true);
  pickupSettings = data || { school_id: schoolId, lat: null, lng: null, radius_m: 300, gates: ["1"], windows: [],
    repeat_after_s: 60, max_repeats: 1, speak_times: 2, student_title: "الطالب", enabled: false };
  renderPickupSettings();
}

function renderPickupSettings() {
  const s = pickupSettings;
  const secOpts = sel => `<option value="">كل الأقسام</option>` + sectionsWithId().map(x =>
    `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const map = s.lat != null && s.lng != null
    ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(s.lat + "," + s.lng)}" target="_blank" rel="noopener noreferrer">عرض على الخريطة ↗</a>` : "";
  document.getElementById("pickupBox").innerHTML = `
    <div class="row" style="margin-bottom:14px"><label class="switch"><input type="checkbox" id="psEnabled" ${s.enabled ? "checked" : ""}>
      <b>تفعيل نداء الاستلام لأولياء الأمور</b></label></div>
    <h3>موقع المدرسة</h3>
    <div class="row"><label class="muted">خط العرض</label><input id="psLat" dir="ltr" style="width:130px" value="${esc(s.lat ?? "")}">
      <label class="muted">خط الطول</label><input id="psLng" dir="ltr" style="width:130px" value="${esc(s.lng ?? "")}">
      <button class="ghost" data-onclick="p12">📍 موقعي الحالي</button> ${map}</div>
    <div class="row" style="margin-top:10px"><label class="muted">نصف القطر المسموح (متر)</label>
      <input id="psRadius" type="number" min="50" max="5000" style="width:110px" value="${esc(s.radius_m)}">
      <span class="muted">يُقبل «وصلت» فقط إذا كان وليّ الأمر داخل هذا النطاق لحظة الضغط (لا نخزّن موقعه).</span></div>
    <h3>البوابات والنداء</h3>
    <div class="row"><label class="muted">البوابات</label><input id="psGates" style="width:200px" value="${esc((s.gates || []).join("، "))}" placeholder="1، 2">
      <label class="muted">الصيغة</label><select id="psTitle"><option ${s.student_title === "الطالب" ? "selected" : ""}>الطالب</option><option ${s.student_title === "الطالبة" ? "selected" : ""}>الطالبة</option></select>
      <label class="muted">تكرار النطق</label><select id="psSpeak">${[1, 2, 3].map(n => `<option ${n === s.speak_times ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="row" style="margin-top:10px"><label class="muted">إعادة النداء بعد (ثانية)</label>
      <input id="psRepeatAfter" type="number" min="15" max="900" style="width:90px" value="${esc(s.repeat_after_s)}">
      <label class="muted">عدد مرات إعادة النداء</label><input id="psMaxRepeats" type="number" min="0" max="5" style="width:70px" value="${esc(s.max_repeats)}">
      <span class="muted">تنتهي الطلبات تلقائيًا بعد 30 دقيقة.</span></div>
    <p class="muted">مثال النداء: «${esc(s.student_title)} محمد أحمد، الثالث أ، وليّ أمرك بانتظارك عند البوابة ${esc((s.gates || ["1"])[0])}»</p>
    <h3>أوقات الانصراف (توقيت الرياض)</h3>
    <table><thead><tr><th>الأيام</th><th>القسم</th><th>من</th><th>إلى</th><th></th></tr></thead><tbody>
    ${(s.windows || []).map((w, i) => `<tr>
      <td class="days">${WEEKDAYS.map((d, k) => `<label><input type="checkbox" data-onchange="p13" data-p13a0="${i}" data-p13a1="${k}" ${(w.days || []).includes(k) ? "checked" : ""}>${d}</label>`).join(" ")}</td>
      <td><select data-onchange="p14" data-p14a0="${i}">${secOpts(w.section_id || "")}</select></td>
      <td><input type="time" value="${esc(w.from)}" data-onchange="p15" data-p15a0="${i}" data-p15a1="from"></td>
      <td><input type="time" value="${esc(w.to)}" data-onchange="p15" data-p15a0="${i}" data-p15a1="to"></td>
      <td><button class="ghost danger" data-onclick="p16" data-p16a0="${i}">✕</button></td></tr>`).join("") ||
      `<tr><td colspan="5" class="muted">لا توجد أوقات — لن يُقبل أي نداء حتى تضيف وقتًا.</td></tr>`}
    </tbody></table>
    <div class="row" style="margin-top:10px"><button class="ghost" data-onclick="p17">+ وقت انصراف</button><span style="flex:1"></span>
      <button class="primary" data-onclick="p18" ${canWrite() ? "" : "disabled"}>💾 حفظ إعدادات الاستلام</button></div>`;
}

function collectPickupForm() {
  const s = pickupSettings;
  const num = id => { const v = document.getElementById(id).value.trim(); return v === "" ? null : Number(v); };
  s.enabled = document.getElementById("psEnabled").checked;
  s.lat = num("psLat"); s.lng = num("psLng"); s.radius_m = num("psRadius") || 300;
  s.gates = document.getElementById("psGates").value.split(/[،,]/).map(x => x.trim()).filter(Boolean);
  s.student_title = document.getElementById("psTitle").value;
  s.speak_times = Number(document.getElementById("psSpeak").value);
  s.repeat_after_s = num("psRepeatAfter") ?? 60; s.max_repeats = num("psMaxRepeats") ?? 1;
}

async function savePickupSettings() {
  collectPickupForm();
  const s = pickupSettings;
  if ((s.lat == null) !== (s.lng == null) || (s.lat != null && (Math.abs(s.lat) > 90 || Math.abs(s.lng) > 180)))
    return show("msg", "الإحداثيات غير صحيحة.", true);
  if (s.enabled && (s.lat == null || !s.windows.length)) return show("msg", "للتفعيل حدّد موقع المدرسة ووقت انصراف واحدًا على الأقل.", true);
  if (!s.gates.length) s.gates = ["1"];
  for (const w of s.windows) {
    if (!w.days.length || !w.from || !w.to || w.from >= w.to) return show("msg", "تحقق من أوقات الانصراف (الأيام، ومن < إلى).", true);
  }
  const row = { school_id: schoolId, lat: s.lat, lng: s.lng, radius_m: s.radius_m, gates: s.gates, windows: s.windows,
    repeat_after_s: s.repeat_after_s, max_repeats: s.max_repeats, speak_times: s.speak_times,
    student_title: s.student_title, enabled: s.enabled, updated_at: new Date().toISOString() };
  const { error } = await db.from("pickup_settings").upsert(row, { onConflict: "school_id" });
  if (error) return show("msg", "فشل الحفظ: " + error.message, true);
  show("msg", "✓ حُفظت إعدادات الاستلام");
  renderPickupSettings();
}

function useMyLocation() {
  if (!navigator.geolocation) return show("msg", "المتصفح لا يدعم تحديد الموقع.", true);
  navigator.geolocation.getCurrentPosition(p => {
    collectPickupForm();
    pickupSettings.lat = +p.coords.latitude.toFixed(6); pickupSettings.lng = +p.coords.longitude.toFixed(6);
    renderPickupSettings();
    show("msg", `✓ التُقط الموقع (دقة ±${Math.round(p.coords.accuracy)} م) — اضغط حفظ.`);
  }, e => show("msg", "تعذّر تحديد الموقع: " + e.message, true), { enableHighAccuracy: true, timeout: 15000 });
}
function windowEdit(fn) { collectPickupForm(); fn(pickupSettings.windows); renderPickupSettings(); }

// ─── Notices ──────────────────────────────────────────────────────────────────
async function loadNotices() {
  const grades = [...new Set(students.map(s => s.grade).filter(Boolean))];
  if (!students.length) {
    const { data } = await db.from("students").select("grade").eq("school_id", schoolId).limit(5000);
    (data || []).forEach(r => r.grade && !grades.includes(r.grade) && grades.push(r.grade));
  }
  document.getElementById("ntSections").innerHTML = sectionsWithId().map(s =>
    `<label><input type="checkbox" class="ntSec" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join(" ") || '<span class="muted">لا أقسام</span>';
  document.getElementById("ntGrades").innerHTML = grades.sort().map(g =>
    `<label><input type="checkbox" class="ntGrade" value="${esc(g)}"> ${esc(g)}</label>`).join(" ") || '<span class="muted">استورد الطلاب أولًا</span>';
  noticeTargetChanged();
  const { data, error } = await db.from("school_notices").select("id, title, body, target, created_at")
    .eq("school_id", schoolId).order("created_at", { ascending: false }).limit(30);
  if (error) return show("msg", "تعذّر تحميل التعاميم: " + error.message, true);
  document.getElementById("ntList").innerHTML = (data || []).map(n => `<div class="notice">
    <div class="row"><b style="flex:1">${esc(n.title)}</b><span class="muted">${esc(targetText(n.target))} · ${fmt(n.created_at)}</span>
      ${canWrite() ? `<button class="ghost danger sm" data-onclick="p20" data-p20a0="${esc(n.id)}">✕</button>` : ""}</div>
    <p style="white-space:pre-wrap;margin:6px 0 0">${esc(n.body)}</p></div>`).join("") || '<p class="muted">لا تعاميم بعد.</p>';
}
function targetText(t) {
  if (!t || t.all) return "الجميع";
  if (t.section_ids) return "الأقسام: " + t.section_ids.map(sectionName).join("، ");
  if (t.grades) return "الصفوف: " + t.grades.join("، ");
  return "";
}
function noticeTargetChanged() {
  const v = document.getElementById("ntTarget").value;
  document.getElementById("ntSections").style.display = v === "sections" ? "flex" : "none";
  document.getElementById("ntGrades").style.display = v === "grades" ? "flex" : "none";
}
async function sendNotice() {
  const title = document.getElementById("ntTitle").value.trim();
  const body = document.getElementById("ntBody").value.trim();
  if (!title || !body) return show("msg", "اكتب العنوان والنص.", true);
  const kind = document.getElementById("ntTarget").value;
  const picked = cls => [...document.querySelectorAll("." + cls + ":checked")].map(c => c.value);
  let target = { all: true };
  if (kind === "sections") { const ids = picked("ntSec"); if (!ids.length) return show("msg", "اختر قسمًا.", true); target = { section_ids: ids }; }
  if (kind === "grades") { const g = picked("ntGrade"); if (!g.length) return show("msg", "اختر صفًا.", true); target = { grades: g }; }
  const { error } = await db.from("school_notices").insert({ school_id: schoolId, title, body, target, created_by: me.id });
  if (error) return show("msg", "فشل الإرسال: " + error.message, true);
  document.getElementById("ntTitle").value = ""; document.getElementById("ntBody").value = "";
  show("msg", "✓ أُرسل التعميم — يظهر في تطبيق وليّ الأمر.");
  loadNotices();
}
async function deleteNotice(id) {
  if (!confirm("حذف هذا التعميم؟")) return;
  const { error } = await db.from("school_notices").delete().eq("id", id);
  if (error) return show("msg", "فشل: " + error.message, true);
  loadNotices();
}

// ─── Handlers (merged into index.js's delegated map) ──────────────────────────
Object.assign(_H, {
  p1(event) { stuFilter = this.value; renderStudents() },
  p2(event) { importFile(this.files[0]) },
  p3(event) { updateStudent(this.dataset.p3a0, { speak_name: this.value.trim() || null }) },
  p4(event) { updateStudent(this.dataset.p4a0, { section_id: this.value || null }) },
  p5(event) { showGuardianForm(this.dataset.p5a0) },
  p6(event) { removeLink(this.dataset.p6a0, this.dataset.p6a1) },
  p7(event) { updateStudent(this.dataset.p7a0, { active: this.dataset.p7a1 === "1" }) },
  p8(event) { saveGuardian(this.dataset.p8a0) },
  p9(event) { addStudent() },
  p10(event) { runImport() },
  p11(event) { importRows = []; document.getElementById("importBox").style.display = "none" },
  p12(event) { useMyLocation() },
  p13(event) { const i = +this.dataset.p13a0, k = +this.dataset.p13a1, on = this.checked;
    windowEdit(ws => { const d = new Set(ws[i].days || []); on ? d.add(k) : d.delete(k); ws[i].days = [...d].sort(); }) },
  p14(event) { const i = +this.dataset.p14a0, v = this.value || null; windowEdit(ws => { ws[i].section_id = v; }) },
  p15(event) { const i = +this.dataset.p15a0, f = this.dataset.p15a1, v = this.value; windowEdit(ws => { ws[i][f] = v; }) },
  p16(event) { const i = +this.dataset.p16a0; windowEdit(ws => ws.splice(i, 1)) },
  p17(event) { windowEdit(ws => ws.push({ days: [0, 1, 2, 3, 4], section_id: null, from: "12:15", to: "12:45" })) },
  p18(event) { savePickupSettings() },
  p19(event) { sendNotice() },
  p20(event) { deleteNotice(this.dataset.p20a0) },
  p21(event) { noticeTargetChanged() },
  p22(event) { showStudentForm() },
  p23(event) { document.getElementById("stuFile").click() },
});
