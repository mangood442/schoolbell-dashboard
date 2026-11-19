// common.js — shared by every Meeqat panel (index/manager/admin/gate/signup/reset).
// One place for: the sync-time wording, Arabic error/status text, Latin-digit
// date formatting, Lucide icons, and the login help (forgot password / resend
// confirmation). UX audit 2026-11-19 (MQ-UX-01/02/06/10/14).
(function () {
  "use strict";
  const MQ = (window.MQ = window.MQ || {});
  MQ.API = "https://meeqat-api.tripleodoo.com";

  // ── Sync wording (single source; matches the tablet: realtime wake + 25 s poll) ──
  MQ.SYNC_SHORT = "يصل خلال ثوانٍ (وحتى 25 ثانية إن انقطع الاتصال اللحظي)";
  MQ.SYNC_LONG = "يصل أي تعديل إلى التابلت خلال ثوانٍ عبر الاتصال اللحظي، وخلال 25 ثانية كحد أقصى إن انقطع الاتصال اللحظي. والجرس نفسه يعمل على التابلت دون إنترنت.";
  MQ.fillSyncText = (root) => (root || document).querySelectorAll("[data-sync-text]").forEach((el) => {
    el.textContent = el.getAttribute("data-sync-text") === "short" ? MQ.SYNC_SHORT : MQ.SYNC_LONG;
  });

  // ── Dates/times: Gregorian + Latin digits everywhere (quality standard §3.2) ──
  const p2 = (n) => String(n).padStart(2, "0");
  MQ.date = (ts) => { if (!ts) return "—"; const d = new Date(ts); return isNaN(d) ? "—" : `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`; };
  MQ.time = (ts, sec) => { if (!ts) return "—"; const d = new Date(ts); return isNaN(d) ? "—" : `${p2(d.getHours())}:${p2(d.getMinutes())}` + (sec ? `:${p2(d.getSeconds())}` : ""); };
  MQ.dt = (ts) => (ts ? MQ.date(ts) + " " + MQ.time(ts) : "—");
  MQ.isoToSlash = (iso) => (iso ? String(iso).slice(0, 10).replace(/-/g, "/") : "");
  /** Hijri (Umm al-Qura) for an ISO yyyy-mm-dd, Latin digits: «1448/09/01 هـ». */
  MQ.hijri = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso + "T12:00:00");
      const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const g = (t) => (parts.find((x) => x.type === t) || {}).value || "";
      return `${g("year")}/${g("month")}/${g("day")} هـ`;
    } catch (_) { return ""; }
  };
  MQ.ago = (ts) => {
    if (!ts) return "لم يتصل بعد";
    const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return "قبل " + s + " ث";
    if (s < 3600) return "قبل " + Math.round(s / 60) + " د";
    if (s < 86400) return "قبل " + Math.round(s / 3600) + " س";
    return MQ.dt(ts);
  };

  // ── Execution / command statuses in Arabic ──
  const STATUS = {
    EXECUTED: "نُفّذ", SILENCED: "مكتوم (وقت الأذان)", MUTED: "مكتوم", MISSED: "فائت", ERROR: "خطأ", SKIPPED: "تُخطّي",
    ACCEPTED: "استلمه التابلت", DELIVERED: "وصل للتابلت", PENDING: "بانتظار التابلت", DONE: "تم", FAILED: "فشل", QUEUED: "في الانتظار",
  };
  MQ.statusAr = (s) => STATUS[String(s || "").toUpperCase()] || (s ? String(s) : "—");

  // ── Arabic error layer: «what happened + what to do», never raw English ──
  const ERR = [
    [/invalid login credentials|invalid_credentials|invalid grant/i, "البريد الإلكتروني أو كلمة المرور غير صحيحة."],
    [/email not confirmed|email_not_confirmed/i, "لم يُؤكَّد البريد بعد. افتح رابط التأكيد في بريدك، أو اضغط «أعد إرسال رابط التأكيد»."],
    [/failed to fetch|networkerror|load failed|network request failed|fetch failed|err_internet|timeout|timed out/i, "تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة — الجرس يستمر على التابلت دون إنترنت."],
    [/jwt expired|invalid jwt|refresh token|session.*(missing|expired)|not authenticated|auth session missing/i, "انتهت الجلسة. سجّل الدخول من جديد."],
    [/row-level security|permission denied|not allowed|forbidden|unauthori[sz]ed|insufficient/i, "ليست لديك صلاحية لهذا الإجراء. اطلبها من مدير الحساب."],
    [/duplicate key|already exists|unique constraint|already registered|user already/i, "هذه القيمة موجودة مسبقاً."],
    [/rate limit|too many requests|over_email_send_rate|429/i, "محاولات كثيرة متتالية. انتظر دقيقة ثم أعد المحاولة."],
    [/password should be|weak password|password.*(short|least)/i, "كلمة المرور قصيرة أو ضعيفة — استخدم 8 أحرف على الأقل."],
    [/same.?password|different from the old/i, "اختر كلمة مرور مختلفة عن الحالية."],
    [/payload too large|exceeded the maximum allowed size|entity too large/i, "الملف أكبر من الحد المسموح."],
    [/mime type|invalid.*type/i, "نوع الملف غير مدعوم."],
    [/unexpected token|json/i, "الملف غير صالح أو تالف."],
    [/edge function returned a non-2xx|functionshttperror/i, "تعذّر تنفيذ الطلب على الخادم. أعد المحاولة بعد قليل."],
    [/not found|404/i, "العنصر غير موجود أو حُذف."],
    [/mfa|aal2|factor/i, "يلزم إدخال رمز التحقق الثنائي."],
  ];
  const ALLOW = /^(Excel|CSV|WhatsApp|Tuya|ZKTeco|HDMI|API|MP3|WAV|IP|ID|PDF|JSON|Wi-?Fi|MQTT|HTTP|SIP)$/i;
  /** Arabic message for an Error / Supabase error / string. Arabic text passes through. */
  MQ.err = (e) => {
    if (e == null) return "حدث خطأ غير متوقع. أعد المحاولة.";
    const raw = typeof e === "string" ? e : (e.message || e.error_description || e.msg || e.error || (e.context && e.context.statusText) || String(e));
    const s = String(raw || "");
    if (/[\u0600-\u06FF]/.test(s)) return MQ.arText(s);   // already Arabic (server messages)
    for (const [re, ar] of ERR) if (re.test(s)) return ar;
    try { console.warn("[ميقات] خطأ تقني:", s); } catch (_) {}
    return "حدث خطأ غير متوقع. أعد المحاولة، وإن تكرر تواصل مع الدعم.";
  };
  /** Translates any English left inside a UI message (e.g. «فشل: <english>»). */
  MQ.arText = (t) => {
    const s = String(t ?? "");
    const m = s.match(/^([^A-Za-z]*?)([:：]\s*)([A-Za-z].*)$/s);
    if (m) {
      const tail = m[3];
      const words = (tail.match(/[A-Za-z]{4,}/g) || []).filter((w) => !ALLOW.test(w));
      if (words.length) return m[1] + m[2] + MQ.err(tail);
    }
    const words = (s.match(/[A-Za-z]{4,}/g) || []).filter((w) => !ALLOW.test(w));
    if (words.length && !/[\u0600-\u06FF]/.test(s)) return MQ.err(s);
    return s;
  };

  // ── Lucide icons (stroke 1.75) — replaces emoji icons (standard §7) ──
  const I = {
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "calendar-off": '<path d="M4.2 4.2A2 2 0 0 0 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 1.82-1.18M21 15.5V6a2 2 0 0 0-2-2H9.5M16 2v4M3 10h7M21 10h-5.5M2 2l20 20"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    tablet: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 18h.01"/>',
    smartphone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    door: '<path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01"/><path d="M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56Z"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    key: '<path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5"/>',
    school: '<path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M18 5v17M4 6l8-4 8 4M6 5v17"/><circle cx="12" cy="9" r="2"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M20 3v4M22 5h-4"/>',
    package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    play: '<path d="M6 3l14 9-14 9V3z"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    wifi: '<path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  };
  MQ.icon = (name, cls) => `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[name] || I.dot}</svg>`;
  MQ.hydrateIcons = (root) => {
    (root || document).querySelectorAll("i[data-ic]").forEach((el) => {
      const span = document.createElement("span");
      span.className = "icw";
      span.innerHTML = MQ.icon(el.getAttribute("data-ic"), el.getAttribute("data-ic-class") || "");
      el.replaceWith(span.firstChild);
    });
  };
  function observe() {
    document.querySelectorAll("[data-auth-help]").forEach((el) =>
      MQ.mountAuthHelp({ mount: el.id, emailId: el.getAttribute("data-email") || "email", msgId: el.getAttribute("data-msg") || "loginMsg" }));
    MQ.hydrateIcons(document);
    MQ.fillSyncText(document);
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches("i[data-ic]")) MQ.hydrateIcons(n.parentNode || document);
        else if (n.querySelector && n.querySelector("i[data-ic]")) MQ.hydrateIcons(n);
        if (n.querySelector && n.querySelector("[data-sync-text]")) MQ.fillSyncText(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe); else observe();

  // ── School config payload (shared by index/manager/admin so no editor drops keys) ──
  // Cloud calendar (MQ-UX-03): payload.calendar = [{id,type:"holiday"|"special",name,from,to,scheduleName?}].
  // On publish it is COMPILED into date-ranged schedules (activeFrom/activeTo) placed first in every
  // section — tablets already honour ranged schedules (a ranged schedule with no events = no bells),
  // so holidays/exam days reach every tablet without touching it. Compiled rows carry fromCalendar:true
  // and are stripped again on load.
  MQ.normalizeConfig = (p) => {
    const normSec = (s) => ({
      ...s, id: s.id ?? null, name: s.name || "قسم", defaultSoundKey: s.defaultSoundKey || "bell1",
      prayer: s.prayer || null,
      schedules: (Array.isArray(s.schedules) ? s.schedules : []).filter((x) => !x.fromCalendar),
    });
    const scenes = p && Array.isArray(p.scenes) ? p.scenes : [];
    const calendar = p && Array.isArray(p.calendar) ? p.calendar : [];
    if (p && Array.isArray(p.sections)) return { v: 2, sections: p.sections.map(normSec), scenes, calendar };
    const scheds = p && Array.isArray(p.schedules) ? p.schedules : [];
    return { v: 2, sections: [normSec({ name: "عام", schedules: scheds })], scenes, calendar };
  };
  MQ.validCalendar = (cal) => (cal || []).filter((c) => c && c.name && /^\d{4}-\d{2}-\d{2}$/.test(c.from || "") && /^\d{4}-\d{2}-\d{2}$/.test(c.to || "") && c.from <= c.to);
  MQ.compileCalendar = (cfg) => {
    const out = JSON.parse(JSON.stringify(cfg));
    const cal = MQ.validCalendar(out.calendar).slice().sort((a, b) =>
      (a.type === "holiday" ? 0 : 1) - (b.type === "holiday" ? 0 : 1) || a.from.localeCompare(b.from));
    out.sections.forEach((sc) => {
      const own = (sc.schedules || []).filter((s) => !s.fromCalendar);
      // the tablet activates the FIRST schedule when none is marked active → keep one of OUR schedules active
      if (own.length && !own.some((s) => s.isActive)) own[0].isActive = true;
      const gen = [];
      cal.forEach((c) => {
        if (c.type === "holiday") {
          gen.push({ name: "إجازة: " + c.name, isActive: false, activeFrom: c.from, activeTo: c.to, events: [], fromCalendar: true });
        } else {
          const src = own.find((s) => s.name === c.scheduleName);
          if (src) gen.push({ name: c.name, isActive: false, activeFrom: c.from, activeTo: c.to,
            events: JSON.parse(JSON.stringify(src.events || [])), fromCalendar: true });
        }
      });
      sc.schedules = gen.concat(own);
    });
    return out;
  };

  /** Which schedule rings on ISO date `iso` for a section (mirrors the tablet's priority). */
  MQ.todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  MQ.dayPlan = (sec, calendar, iso) => {
    const cal = MQ.validCalendar(calendar);
    const own = ((sec && sec.schedules) || []).filter((s) => !s.fromCalendar);
    const hol = cal.find((c) => c.type === "holiday" && c.from <= iso && iso <= c.to);
    if (hol) return { holiday: hol, schedule: null };
    const sp = cal.find((c) => c.type !== "holiday" && c.from <= iso && iso <= c.to && own.some((s) => s.name === c.scheduleName));
    if (sp) return { special: sp, schedule: own.find((s) => s.name === sp.scheduleName) };
    const ranged = own.find((s) => s.activeFrom && s.activeTo && s.activeFrom <= iso && iso <= s.activeTo);
    if (ranged) return { schedule: ranged, ranged: true };
    return { schedule: own.find((s) => s.isActive) || own[0] || null };
  };

  // ── Login help: «نسيت كلمة المرور؟» + «أعد إرسال رابط التأكيد» (every panel) ──
  async function account(action, email) {
    const r = await fetch(MQ.API + "/functions/v1/signup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, email }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  MQ.requestReset = (email) => account("reset", email);
  MQ.resendConfirm = (email) => account("resend", email);
  /**
   * Adds the help links under a login form.
   * opts: { emailId, msgId, mount (element id to append into), tone: "light"|"dark" }
   */
  MQ.mountAuthHelp = (opts) => {
    const mount = document.getElementById(opts.mount);
    if (!mount || mount.querySelector(".auth-help")) return;
    const wrap = document.createElement("div");
    wrap.className = "auth-help";
    wrap.innerHTML = `<button type="button" class="linkbtn" data-ah="reset">نسيت كلمة المرور؟</button>
      <span aria-hidden="true">·</span>
      <button type="button" class="linkbtn" data-ah="resend">أعد إرسال رابط التأكيد</button>`;
    mount.appendChild(wrap);
    const say = (t, bad) => {
      const m = document.getElementById(opts.msgId);
      if (!m) return;
      m.textContent = t; m.className = (m.className.replace(/\b(ok|err)\b/g, "").trim() + " " + (bad ? "err" : "ok")).trim();
      m.style.display = "block";
    };
    wrap.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-ah]"); if (!b) return;
      const email = (document.getElementById(opts.emailId)?.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say("اكتب بريدك الإلكتروني في الحقل أعلاه أولاً.", true); document.getElementById(opts.emailId)?.focus(); return; }
      b.disabled = true;
      try {
        if (b.dataset.ah === "reset") { await MQ.requestReset(email); say("إن كان البريد مسجّلاً فستصلك خلال دقيقة رسالة فيها رابط لتعيين كلمة مرور جديدة (صالح ساعة واحدة). تحقّق من الرسائل غير المرغوبة أيضاً."); }
        else { await MQ.resendConfirm(email); say("إن كان لهذا البريد تسجيل لم يُؤكَّد بعد فقد أعدنا إرسال رابط التأكيد إليه (صالح 48 ساعة)."); }
      } catch (e) { say(MQ.err(e), true); }
      finally { setTimeout(() => { b.disabled = false; }, 30000); }
    });
  };
  /** Arabic login error + a resend shortcut when the e-mail isn't confirmed. */
  MQ.loginError = (error) => {
    const s = (error && (error.message || error.code)) || "";
    return MQ.err(/not confirmed/i.test(s) ? "email not confirmed" : error);
  };
})();
