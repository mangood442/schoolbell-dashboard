// ميقات v17 — «ابدأ هنا» (first 10 minutes) + «الاشتراك والدفع بالتحويل البنكي».
// Loaded after index.js / pickup-admin.js and shares their globals (db, schoolId, me, myRole, config,
// esc, show, _H, showTab, saveConfig, renderSchedules, sendBell). Data comes from the `billing` edge
// function (state/create/cancel/receipt). Prices appear only here, after login.

let BILL = null;          // last billing state
const obCanWrite = () => myRole === "admin" || myRole === "manager";
const obHiddenKey = () => "mq_starthere_hidden_" + schoolId;
const fmtSAR = n => Number(n || 0).toLocaleString("ar-SA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ر.س";
const daysLeft = d => d ? Math.round((Date.parse(d + "T23:59:59+03:00") - Date.now()) / 86400000) : null;

async function obCall(body) {
  const { data, error } = await db.functions.invoke("billing", { body });
  if (error) {
    let msg = "تعذّر الاتصال بالخادم";
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (_) { /* keep generic */ }
    throw new Error(msg);
  }
  return data;
}

async function onboardingRefresh() {
  try { BILL = await obCall({ action: "state" }); }
  catch (e) { console.warn("billing state", e.message); return; }
  renderTrialBanner(); renderStartHere();
  if (document.getElementById("tab-billing").style.display === "block") renderBilling();
}

// ─── Trial banner ────────────────────────────────────────────────────────────
function renderTrialBanner() {
  const el = document.getElementById("trialBanner"); const s = BILL?.school;
  if (!s) { el.style.display = "none"; return; }
  const left = daysLeft(s.subscription_until);
  const pending = (BILL.invoices || []).find(i => i.status === "pending" && i.source === "school");
  let cls = "ok", txt = "";
  if (s.is_trial) {
    if (left !== null && left < 0) { cls = "bad"; txt = `انتهت التجربة المجانية بتاريخ ${esc(s.subscription_until)} — اشترك ليستمر الجرس دون انقطاع.`; }
    else { cls = left !== null && left <= 3 ? "warn" : "ok"; txt = `تجربة مجانية — متبقٍّ <b>${left ?? "—"}</b> ${left === 1 ? "يوم" : "يومًا"} (حتى ${esc(s.subscription_until || "—")}).`; }
  } else if (left !== null && left <= 14) {
    cls = left < 0 ? "bad" : "warn"; txt = left < 0 ? `انتهى الاشتراك بتاريخ ${esc(s.subscription_until)}.` : `ينتهي الاشتراك بعد ${left} يومًا (${esc(s.subscription_until)}).`;
  } else { el.style.display = "none"; return; }
  if (pending) txt += pending.receipt_at ? " · إيصال التحويل قيد المراجعة." : ` · لديك فاتورة مبدئية ${esc(pending.number || "")} بانتظار التحويل.`;
  el.className = "trial-banner " + cls;
  el.innerHTML = `<span style="flex:1">${txt}</span><button class="primary sm" data-onclick="o1">💳 الاشتراك والدفع</button>`;
  el.style.display = "flex";
}

// ─── «ابدأ هنا» checklist ────────────────────────────────────────────────────
function renderStartHere() {
  const el = document.getElementById("startHere"); const p = BILL?.progress;
  if (!p) { el.style.display = "none"; return; }
  const steps = [
    { k: "profile", t: "أكمل بياناتك", d: "اسمك ورقم جوالك — لنتواصل معك عند أي تنبيه من الأجهزة.",
      a: `<button class="ghost sm" data-onclick="h9">👤 فتح «حسابي»</button>` },
    { k: "schedule", t: "أنشئ جدول الجرس", d: "أضف الحصص والفسح، أو ابدأ بجدول نموذجي لمدرسة سعودية ثم عدّله.",
      a: (obCanWrite() ? `<button class="primary sm" data-onclick="o2">✨ تعبئة جدول نموذجي</button> ` : "") + `<button class="ghost sm" data-onclick="h2">📅 فتح الجداول</button>` },
    { k: "device", t: "اربط التابلت", d: BILL.activationCode
        ? `ثبّت تطبيق ميقات على تابلت أندرويد، ثم من «الإعدادات ← الربط السحابي» أدخل الرمز: <b class="mono code-chip" dir="ltr">${esc(BILL.activationCode)}</b>`
        : "ثبّت تطبيق ميقات على تابلت أندرويد وأدخل رمز التفعيل من «الإعدادات ← الربط السحابي».",
      a: `<a class="ghost sm btnlink" target="_blank" rel="noopener" href="https://wa.me/966541301200?text=${encodeURIComponent("أحتاج رابط تطبيق ميقات للتابلت — " + (BILL.school?.name || ""))}">📲 اطلب رابط التطبيق</a> <button class="ghost sm" data-onclick="h6">📱 الأجهزة</button>` },
    { k: "bell", t: "جرّب الجرس الآن", d: p.device ? "أرسل جرسًا فوريًا وتأكد أن الصوت خرج من السماعة." : "بعد ربط التابلت أرسل جرسًا تجريبيًا من هنا.",
      a: obCanWrite() ? `<button class="primary sm" data-onclick="o3" ${p.device ? "" : "disabled"}>🔔 جرّب الجرس الآن</button>` : "" },
    { k: "plan", t: "اختر باقتك وادفع بالتحويل", d: "فاتورة مبدئية فورية، تحويل بنكي، ثم ارفع الإيصال — ويُمدَّد الاشتراك بعد التأكيد.",
      a: `<button class="ghost sm" data-onclick="o1">💳 الاشتراك والدفع</button>` },
  ];
  const done = steps.filter(s => p[s.k]).length;
  if (done === steps.length || localStorage.getItem(obHiddenKey()) === "1") { el.style.display = "none"; return; }
  const next = steps.find(s => !p[s.k]);
  el.innerHTML = `
    <div class="row" style="margin-bottom:6px"><h2 style="flex:1;margin:0">🚀 ابدأ هنا — أول جرس خلال 10 دقائق</h2>
      <span class="muted">${done} من ${steps.length}</span><button class="ghost sm" data-onclick="o9" title="إخفاء البطاقة">إخفاء</button></div>
    <div class="bar" style="margin:8px 0 14px"><span style="width:${Math.round(done * 100 / steps.length)}%"></span></div>
    <ol class="ob-steps">${steps.map((s, i) => `
      <li class="${p[s.k] ? "done" : s === next ? "next" : ""}">
        <span class="ob-n">${p[s.k] ? "✓" : i + 1}</span>
        <div style="flex:1"><b>${s.t}</b><div class="muted">${s.d}</div></div>
        <div class="ob-a">${p[s.k] ? '<span class="muted">تم</span>' : s.a}</div>
      </li>`).join("")}</ol>`;
  el.style.display = "block";
}

// Demo data: a typical Saudi school day (Sun–Thu) the school edits afterwards.
const DEMO_DAY = [
  ["الطابور الصباحي", "06:45", 15], ["الحصة الأولى", "07:00", 45], ["الحصة الثانية", "07:45", 45],
  ["الحصة الثالثة", "08:30", 45], ["الفسحة", "09:15", 25], ["الحصة الرابعة", "09:40", 45],
  ["الحصة الخامسة", "10:25", 45], ["الحصة السادسة", "11:10", 45], ["الحصة السابعة", "11:55", 45], ["الانصراف", "12:40", 5],
];
async function fillDemoSchedule() {
  if (!obCanWrite()) return;
  const secIdx = 0, s = config.sections[secIdx];
  const events = DEMO_DAY.map(([name, hm, dur], i) => {
    const [h, m] = hm.split(":").map(Number);
    return { name, startMinuteOfDay: h * 60 + m, durationMin: dur, daysOfWeek: 0b1001111, volume: 1, enabled: true, sortOrder: i, soundKey: "" };
  });
  const empty = s.schedules.find(x => !x.events || x.events.length === 0);
  if (empty) { empty.events = events; empty.name = empty.name || "صباحي"; empty.isActive = true; }
  else {
    if (!confirm("لديك جداول بالفعل. نضيف «جدول نموذجي» جديدًا (غير مفعّل) لتراجعه؟")) return;
    s.schedules.push({ name: "جدول نموذجي", isActive: false, events });
  }
  curSection = secIdx; curSched = Math.max(0, s.schedules.findIndex(x => x.events === events));
  await saveConfig(true);
  renderSectionBar(); renderSchedules(); showTab("schedules");
  show("msg", "✓ أُضيف جدول نموذجي (الأحد–الخميس) ونُشر للتابلت — عدّل الأوقات حسب مدرستك ثم اضغط «حفظ ونشر».");
  onboardingRefresh();
}
async function testBell() {
  const sel = document.getElementById("announceTarget"); if (sel) sel.value = "";
  await sendBell();
  show("msg", "✓ أُرسل جرس تجريبي — يجب أن يرنّ التابلت خلال ثوانٍ. سنعلّم الخطوة عند وصول التأكيد من الجهاز.");
  setTimeout(onboardingRefresh, 20000); setTimeout(onboardingRefresh, 45000);
}

// ─── Billing tab ─────────────────────────────────────────────────────────────
let obPlan = null, obYears = 1;
function renderBilling() {
  const box = document.getElementById("billingBox");
  if (!BILL) { box.innerHTML = '<p class="muted">جارٍ التحميل…</p>'; onboardingRefresh(); return; }
  const s = BILL.school, plans = BILL.plans || [], invs = BILL.invoices || [];
  const planName = k => (plans.find(p => p.key === k) || {}).name_ar || k || "—";
  const left = daysLeft(s.subscription_until);
  const open = invs.find(i => i.status === "pending" && i.source === "school");
  if (!obPlan) obPlan = (plans.find(p => p.key === s.plan) || plans[0] || {}).key;

  const statusCard = `<div class="subtle row" style="margin-bottom:16px">
    <span>الباقة الحالية: <b>${esc(planName(s.plan))}</b>${s.is_trial ? ' <span class="chip">تجربة مجانية</span>' : ""}</span>
    <span style="flex:1"></span><span>${s.is_trial ? "تنتهي التجربة" : "الاشتراك ساري حتى"}: <b class="mono" dir="ltr">${esc(s.subscription_until || "—")}</b>${left !== null ? ` <span class="muted">(${left < 0 ? "منتهٍ" : "متبقٍّ " + left + " يومًا"})</span>` : ""}</span></div>`;

  let openCard = "";
  if (open) {
    const banks = (BILL.bank || []).map(b => `<tr><td>${esc(b.bank)}</td><td class="mono" dir="ltr">${esc(b.iban)}</td>
      <td><button class="ghost sm" data-onclick="o7" data-o7a0="${esc(b.iban)}">نسخ</button></td></tr>`).join("");
    openCard = `<div class="card ob-open">
      <div class="row"><h2 style="flex:1;margin:0">الفاتورة المبدئية <span class="mono" dir="ltr">${esc(open.number || "#" + open.id)}</span></h2>
        <a class="primary sm btnlink" target="_blank" rel="noopener" href="./proforma.html?id=${open.id}">📄 عرض / تحميل PDF</a></div>
      <p class="muted" style="margin:6px 0 12px">${esc(open.buyer_name || "")} — ${esc(planName(open.plan_key))} لمدة ${open.period_months / 12} ${open.period_months === 12 ? "سنة" : "سنوات"}</p>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi"><div class="l">المبلغ قبل الضريبة</div><div class="n" style="font-size:20px">${fmtSAR(open.amount)}</div></div>
        <div class="kpi"><div class="l">ضريبة القيمة المضافة 15%</div><div class="n" style="font-size:20px">${fmtSAR(open.vat)}</div></div>
        <div class="kpi"><div class="l">الإجمالي المستحق</div><div class="n good" style="font-size:20px">${fmtSAR(open.total)}</div></div></div>
      <h3>1) حوّل المبلغ إلى أحد حسابات ${esc(BILL.seller?.name_ar || "")}</h3>
      <table><thead><tr><th>البنك</th><th>الآيبان</th><th></th></tr></thead><tbody>${banks}</tbody></table>
      <p class="muted">اكتب رقم الفاتورة <b class="mono" dir="ltr">${esc(open.number || "")}</b> في وصف التحويل.</p>
      <h3>2) ارفع إيصال التحويل</h3>
      ${open.receipt_at
        ? `<div class="msg ok" style="display:block">✓ استلمنا الإيصال (${fmt(open.receipt_at)}). نراجعه ونمدد الاشتراك خلال يوم عمل، وتصلك رسالة بالتأكيد.</div>
           ${obCanWrite() ? `<details><summary class="muted" style="cursor:pointer">رفع إيصال آخر</summary>${receiptForm(open)}</details>` : ""}`
        : (obCanWrite() ? receiptForm(open) : '<p class="muted">يرفع مدير المدرسة الإيصال.</p>')}
      ${obCanWrite() && !open.receipt_at ? `<p style="margin-top:12px"><button class="ghost sm danger" data-onclick="o6" data-o6a0="${open.id}">إلغاء هذه الفاتورة</button></p>` : ""}
    </div>`;
  }

  const planCards = plans.map(p => `
    <label class="ob-plan ${p.key === obPlan ? "sel" : ""}"><input type="radio" name="obPlan" value="${esc(p.key)}" ${p.key === obPlan ? "checked" : ""} data-onchange="o4">
      <b style="font-size:17px">${esc(p.name_ar)}</b>
      <div class="ob-price">${fmtSAR(p.price)} <span class="muted">/ سنة لكل مدرسة + الضريبة</span></div>
      <ul>${(p.features || []).map(f => `<li>${esc(f)}</li>`).join("")}</ul></label>`).join("");
  const sel = plans.find(p => p.key === obPlan);
  const sub = sel ? Number(sel.price) * obYears : 0, vat = Math.round(sub * 15) / 100;
  const form = obCanWrite() ? `
    <div class="card"><h2>${open ? "إصدار فاتورة جديدة (تستبدل الحالية)" : "اختر باقتك"}</h2>
      <div class="ob-plans">${planCards}</div>
      <div class="row" style="margin-top:14px">
        <label class="muted">المدة</label>
        <select id="obYears" data-onchange="o5">${[1, 2, 3].slice(0, BILL.maxYears || 3).map(y => `<option value="${y}" ${y === obYears ? "selected" : ""}>${y === 1 ? "سنة واحدة" : y === 2 ? "سنتان" : y + " سنوات"}</option>`).join("")}</select>
        <span style="flex:1"></span>
        <span>الإجمالي شامل الضريبة: <b class="mono">${fmtSAR(sub + vat)}</b> <span class="muted">(${fmtSAR(sub)} + ضريبة ${fmtSAR(vat)})</span></span>
      </div>
      <h3>بيانات الفاتورة</h3>
      <div class="row"><input id="obBuyer" style="flex:2;min-width:220px" maxlength="150" placeholder="اسم المنشأة كما يظهر في الفاتورة" value="${esc(s.name || "")}">
        <input id="obVat" style="flex:1;min-width:170px" dir="ltr" maxlength="15" placeholder="الرقم الضريبي (اختياري)"></div>
      <div class="row" style="margin-top:8px"><input id="obAddr" style="flex:1" maxlength="250" placeholder="العنوان الوطني / المدينة (اختياري)"></div>
      <p style="margin-top:14px"><button class="primary" data-onclick="o8">📄 إصدار الفاتورة المبدئية</button>
        <span class="muted"> الدفع بالتحويل البنكي فقط حاليًا.</span></p>
      <div class="msg" id="obMsg"></div></div>` : '<p class="muted">إدارة الاشتراك متاحة لمدير المدرسة.</p>';

  const hist = invs.length ? `<div class="card"><h2>سجل الفواتير</h2><table><thead><tr><th>الرقم</th><th>الباقة</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead><tbody>
    ${invs.map(i => `<tr><td class="mono" dir="ltr">${esc(i.number || "#" + i.id)}</td><td>${esc(planName(i.plan_key))}</td>
      <td class="mono">${fmtSAR(i.total ?? i.amount)}</td><td>${invStatus(i)}</td><td class="mono" dir="ltr">${fmt(i.created_at)}</td>
      <td>${i.number ? `<a class="ghost sm btnlink" target="_blank" rel="noopener" href="./proforma.html?id=${i.id}">📄</a>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : "";

  const reshow = localStorage.getItem(obHiddenKey()) === "1" ? `<p><button class="ghost sm" data-onclick="o10">إظهار بطاقة «ابدأ هنا»</button></p>` : "";
  box.innerHTML = statusCard + openCard + form + hist + reshow;
}
function receiptForm(inv) {
  return `<div class="row" style="margin-top:6px">
    <input type="file" id="obFile" accept="application/pdf,image/jpeg,image/png,image/webp">
    <input id="obNote" style="flex:1;min-width:180px" maxlength="300" placeholder="ملاحظة (اختياري): اسم المحوِّل، البنك…">
    <button class="primary sm" data-onclick="o11" data-o11a0="${inv.id}">⬆ رفع الإيصال</button></div>
    <p class="muted">PDF أو صورة حتى 5MB.</p><div class="msg" id="obRcptMsg"></div>`;
}
function invStatus(i) {
  if (i.status === "paid") return '<span class="chip">مدفوعة ✓</span>';
  if (i.status === "cancelled") return '<span class="muted">ملغاة</span>';
  if (i.status === "rejected") return `<span style="color:var(--red)">مرفوضة</span>${i.decided_note ? ` <span class="muted">${esc(i.decided_note)}</span>` : ""}`;
  return i.receipt_at ? '<span style="color:var(--amber)">الإيصال قيد المراجعة</span>' : '<span style="color:var(--amber)">بانتظار التحويل</span>';
}
async function createProforma() {
  const btn = event?.target; if (btn) btn.disabled = true;
  try {
    const r = await obCall({ action: "create", plan: obPlan, years: obYears,
      buyerName: document.getElementById("obBuyer").value, buyerVat: document.getElementById("obVat").value,
      buyerAddress: document.getElementById("obAddr").value });
    await onboardingRefresh(); renderBilling();
    show("msg", "✓ صدرت الفاتورة المبدئية " + (r.invoice?.number || "") + " — حوّل المبلغ ثم ارفع الإيصال.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) { show("obMsg", e.message, true); }
  finally { if (btn) btn.disabled = false; }
}
async function uploadReceipt(id) {
  const f = document.getElementById("obFile")?.files?.[0];
  if (!f) return show("obRcptMsg", "اختر ملف الإيصال أولًا", true);
  if (f.size > 5 * 1024 * 1024) return show("obRcptMsg", "حجم الملف حتى 5MB", true);
  const fd = new FormData();
  fd.append("action", "receipt"); fd.append("invoiceId", String(id));
  fd.append("note", document.getElementById("obNote").value || ""); fd.append("file", f);
  show("obRcptMsg", "جارٍ الرفع…");
  try { await obCall(fd); await onboardingRefresh(); renderBilling(); show("msg", "✓ استلمنا إيصال التحويل — سنؤكد ونمدد الاشتراك خلال يوم عمل."); }
  catch (e) { show("obRcptMsg", e.message, true); }
}
async function cancelProforma(id) {
  if (!confirm("إلغاء الفاتورة المبدئية؟")) return;
  try { await obCall({ action: "cancel", invoiceId: id }); await onboardingRefresh(); renderBilling(); }
  catch (e) { show("msg", e.message, true); }
}

Object.assign(_H, {
  o1() { showTab("billing"); },
  o2() { fillDemoSchedule(); },
  o3() { testBell(); },
  o4() { obPlan = this.value; renderBilling(); },
  o5() { obYears = +this.value || 1; renderBilling(); },
  o6() { cancelProforma(+this.dataset.o6a0); },
  o7() { navigator.clipboard?.writeText(this.dataset.o7a0); this.textContent = "✓ نُسخ"; },
  o8() { createProforma(); },
  o9() { localStorage.setItem(obHiddenKey(), "1"); renderStartHere(); },
  o10() { localStorage.removeItem(obHiddenKey()); renderStartHere(); renderBilling(); window.scrollTo({ top: 0 }); },
  o11() { uploadReceipt(+this.dataset.o11a0); },
});

// If index.js finished init() before this file was parsed, load the state now.
if (typeof schoolId !== "undefined" && schoolId && !BILL) onboardingRefresh();
