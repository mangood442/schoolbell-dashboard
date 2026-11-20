// tools/test_ui.mjs — dashboard gate (no dependencies): node tools/test_ui.mjs
// 1) unit tests for common.js (calendar compile, config normalisation, Arabic errors/statuses, dates)
// 2) static checks across the repo for regressions found in the 2026-11-19 UX audit.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + ` (got ${JSON.stringify(a)})`);

// ── load common.js in a tiny fake browser ──
const doc = { readyState: "complete", querySelectorAll: () => [], getElementById: () => null, documentElement: {}, addEventListener() {} };
const sandbox = { window: {}, document: doc, console, Intl, Date, setTimeout, clearTimeout, MutationObserver: class { observe() {} }, fetch: async () => ({}) };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "common.js"), "utf8"), sandbox);
const MQ = sandbox.MQ;

// sync wording: one source, mentions realtime + 25 s
ok(/25 ثانية/.test(MQ.SYNC_SHORT) && /اللحظي/.test(MQ.SYNC_SHORT), "SYNC_SHORT mentions realtime + 25 s");
ok(/25 ثانية/.test(MQ.SYNC_LONG) && /دون إنترنت/.test(MQ.SYNC_LONG), "SYNC_LONG mentions 25 s + offline");

// Arabic errors
eq(MQ.err({ message: "Invalid login credentials" }), "البريد الإلكتروني أو كلمة المرور غير صحيحة.", "login error");
ok(/تعذّر الاتصال/.test(MQ.err(new TypeError("Failed to fetch"))), "network error");
ok(/صلاحية/.test(MQ.err({ message: 'new row violates row-level security policy for table "x"' })), "RLS error");
ok(!/[A-Za-z]{4,}/.test(MQ.err({ message: "Something weird happened" })), "unknown English → Arabic generic");
eq(MQ.err("محاولات كثيرة، حاول لاحقًا"), "محاولات كثيرة، حاول لاحقًا", "Arabic passes through");
ok(!/[A-Za-z]{4,}/.test(MQ.arText("فشل الحفظ: TypeError: Failed to fetch")), "arText translates the English tail");
eq(MQ.arText("✓ أُرسل الأمر عبر التابلت"), "✓ أُرسل الأمر عبر التابلت", "arText keeps Arabic");
ok(/تأكيد|يُؤكَّد/.test(MQ.loginError({ message: "Email not confirmed" })), "unconfirmed e-mail hint");

// statuses
eq(MQ.statusAr("EXECUTED"), "نُفّذ", "EXECUTED"); eq(MQ.statusAr("MISSED"), "فائت", "MISSED");
ok(!/[A-Z]{4,}/.test(["EXECUTED", "SILENCED", "MUTED", "MISSED", "ERROR", "ACCEPTED", "DELIVERED", "PENDING"].map(MQ.statusAr).join(" ")), "all statuses Arabic");

// dates: Latin digits, Gregorian
const d = new Date(2026, 10, 20, 7, 5, 9);
eq(MQ.date(d), "2026/11/20", "date"); eq(MQ.time(d, true), "07:05:09", "time");
ok(/^\d{4}\/\d{2}\/\d{2} هـ$/.test(MQ.hijri("2027-02-08")), "hijri latin digits: " + MQ.hijri("2027-02-08"));

// config normalisation keeps prayer/scenes/calendar, strips compiled schedules
const raw = { v: 2, scenes: [{ id: "s1" }], calendar: [{ id: "c", type: "holiday", name: "x", from: "2026-12-01", to: "2026-12-02" }],
  sections: [{ id: "A", name: "بنين", prayer: { enabled: true }, schedules: [
    { name: "إجازة: x", fromCalendar: true, activeFrom: "2026-12-01", activeTo: "2026-12-02", events: [] },
    { name: "صباحي", isActive: true, events: [{ name: "ح1", startMinuteOfDay: 420 }] },
    { name: "اختبارات", isActive: false, events: [{ name: "اختبار", startMinuteOfDay: 450 }] }] }] };
const n = MQ.normalizeConfig(raw);
eq(n.sections[0].schedules.map(s => s.name), ["صباحي", "اختبارات"], "compiled schedules stripped");
ok(n.sections[0].prayer && n.sections[0].prayer.enabled, "prayer kept"); eq(n.scenes.length, 1, "scenes kept"); eq(n.calendar.length, 1, "calendar kept");
eq(MQ.normalizeConfig({ schedules: [{ name: "قديم", events: [] }] }).sections[0].schedules[0].name, "قديم", "legacy payload");

// compile: holiday first (no events), special day copies events, own schedule stays active, idempotent
n.calendar.push({ id: "e", type: "special", name: "يوم اختبار", from: "2026-12-10", to: "2026-12-10", scheduleName: "اختبارات" });
n.calendar.push({ id: "bad", type: "holiday", name: "خطأ", from: "2026-12-09", to: "2026-12-01" });
const c = MQ.compileCalendar(n);
const sc = c.sections[0].schedules;
eq(sc.map(s => s.name), ["إجازة: x", "يوم اختبار", "صباحي", "اختبارات"], "compiled order");
eq(sc[0].events.length, 0, "holiday has no events"); ok(sc[0].isActive === false && sc[1].isActive === false, "compiled not active");
eq(sc[1].events[0].name, "اختبار", "special copies events"); ok(sc[2].isActive, "own schedule stays active");
eq([sc[0].activeFrom, sc[0].activeTo], ["2026-12-01", "2026-12-02"], "holiday range");
eq(MQ.compileCalendar(MQ.normalizeConfig(c)).sections[0].schedules.length, 4, "compile∘normalize idempotent");
ok(n.sections[0].schedules.length === 2, "compile does not mutate the editor config");
const noActive = MQ.normalizeConfig({ sections: [{ name: "x", schedules: [{ name: "a", events: [] }, { name: "b", events: [] }] }], calendar: [{ type: "holiday", name: "h", from: "2026-01-01", to: "2026-01-01" }] });
ok(MQ.compileCalendar(noActive).sections[0].schedules[1].isActive === true, "first OWN schedule becomes active, not the holiday");

// day plan mirrors the tablet priority
eq(MQ.dayPlan(n.sections[0], n.calendar, "2026-12-01").holiday.name, "x", "holiday wins");
eq(MQ.dayPlan(n.sections[0], n.calendar, "2026-12-10").schedule.name, "اختبارات", "special day");
eq(MQ.dayPlan(n.sections[0], n.calendar, "2026-12-15").schedule.name, "صباحي", "normal day");
const ranged = MQ.normalizeConfig({ sections: [{ name: "x", schedules: [{ name: "عادي", isActive: true, events: [] }, { name: "رمضان", activeFrom: "2027-02-08", activeTo: "2027-03-08", events: [] }] }] });
eq(MQ.dayPlan(ranged.sections[0], [], "2027-02-20").schedule.name, "رمضان", "ranged schedule in period");

// ── static checks (regressions) ──
const files = fs.readdirSync(ROOT).filter(f => /\.(html|js|txt|xml)$/.test(f));
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const panels = ["index", "manager", "admin", "gate", "signup", "reset", "onboarding", "pickup-admin", "proforma", "pro-admin"];
for (const f of files) {
  const s = read(f);
  ok(!s.includes("966541301200"), f + ": owner mobile must not appear (company WhatsApp 966535313495)");
  ok(!s.includes("tcdknoalnynnbuvlozwy"), f + ": old Supabase project referenced");
}
ok(!read("tools/gen_pages.py").includes("966541301200"), "gen_pages.py WhatsApp");
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B06}\u{2B07}]/u;
for (const p of panels) for (const ext of ["html", "js"]) {
  const f = `${p}.${ext}`; if (!fs.existsSync(path.join(ROOT, f))) continue;
  const s = read(f);
  const bad = s.split("\n").filter(l => EMOJI.test(l) && !/^\s*\/\//.test(l));
  ok(bad.length === 0, `${f}: emoji used as icon (${bad.length}) ${bad[0] ? bad[0].trim().slice(0, 80) : ""}`);
  ok(!/(يصل|سيصل|يسحب)[^.\n]{0,40}(خلال دقائق|≤ ?5 دقائق)|١–٢ ثانية|ثانية أو ثانيتين/.test(s), `${f}: contradicting sync wording`);
  ok(!/toLocale(Date|Time)?String\("ar-SA"/.test(s), `${f}: ar-SA formatter (Arabic-Indic/Hijri digits)`);
  if (ext === "html" && ["index", "manager", "admin", "gate"].includes(p)) {
    ok(/data-auth-help/.test(s), `${f}: login help (forgot password / resend)`);
    ok(/common\.js/.test(s), `${f}: loads common.js`);
  }
}
// Shared-globals collision: every classic <script> of a page shares one global scope, so a
// top-level const/let/class declared in two of them throws «already been declared» and the
// whole later file is dropped (2026-11-20: canWrite in index.js + pickup-admin.js).
for (const h of files.filter(f => f.endsWith(".html"))) {
  const srcs = [...read(h).matchAll(/<script src="([a-z0-9-]+\.js)/g)].map(m => m[1]).filter(f => fs.existsSync(path.join(ROOT, f)));
  const seen = {};
  for (const f of srcs) for (const m of read(f).matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) (seen[m[1]] ||= []).push(f);
  const dup = Object.entries(seen).filter(([, v]) => v.length > 1);
  ok(dup.length === 0, `${h}: top-level name declared twice across scripts: ${dup.map(([k, v]) => k + " (" + v.join(", ") + ")").join("; ")}`);
}
ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(read("common.css")), "common.css: [hidden] must win over display classes (role banner)");
ok(!/Disallow: \/admin\.html/.test(read("robots.txt")), "robots.txt must not advertise admin.html");
ok(/required/.test(read("signup.html").match(/id="password"[^>]*/)[0]), "signup password required");

console.log(`dashboard gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
