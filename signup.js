const SUPABASE_URL = "https://tcdknoalnynnbuvlozwy.supabase.co";
const SUPABASE_KEY = "sb_publishable_D0YQfRkraujKgNEVpSNKhw_YMvm2oB7";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Cloudflare Turnstile (optional). Put the public SITE key here once the
// TURNSTILE_SECRET is set on the `signup` function; leave "" to disable.
const TURNSTILE_SITE_KEY = "";
let turnstileToken = "";
if (TURNSTILE_SITE_KEY) {
  window.onTurnstileLoad = () => window.turnstile.render("#captcha", {
    sitekey: TURNSTILE_SITE_KEY, language: "ar",
    callback: t => { turnstileToken = t; },
    "expired-callback": () => { turnstileToken = ""; },
  });
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
  s.async = true; document.head.appendChild(s);
}

async function submitForm() {
  const name = val("name"), email = val("email"), phone = val("phone"), password = val("password");
  if (name.length < 2) return err("أدخل اسم المدرسة");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("أدخل بريدًا إلكترونيًا صحيحًا");
  if (password && password.length < 8) return err("كلمة المرور 8 أحرف على الأقل");
  if (TURNSTILE_SITE_KEY && !turnstileToken) return err("أكمل التحقق أولًا");
  const btn = document.getElementById("submit");
  btn.disabled = true; btn.textContent = "… جارٍ الإنشاء";
  const { data, error } = await db.functions.invoke("signup", {
    body: { name, contactEmail: email, contactPhone: phone, password, website: val("website"), turnstileToken },
  });
  const e = error || data?.error;
  if (e && TURNSTILE_SITE_KEY && window.turnstile) { window.turnstile.reset("#captcha"); turnstileToken = ""; }
  if (e) { btn.disabled = false; btn.textContent = "ابدأ التجربة المجانية"; return err(typeof e === "string" ? e : (data?.error || e.message || "تعذّر الإنشاء")); }
  document.getElementById("formCard").style.display = "none";
  document.getElementById("doneCard").style.display = "block";
  document.getElementById("doneCode").textContent = data.activationCode;
  document.getElementById("trialLine").textContent = "فترتك التجريبية سارية حتى " + data.trialUntil + ".";
  document.getElementById("acctLine").innerHTML = data.account
    ? `4. ادخل <a class="link" href="./index.html">لوحة المدرسة</a> ببريدك وكلمة المرور التي اخترتها.`
    : `4. لإنشاء حساب لوحة المدرسة تواصل مع مزوّد الخدمة.`;
  window.scrollTo(0, 0);
}
function val(id) { return document.getElementById(id).value.trim(); }
function err(t) { const m = document.getElementById("msg"); m.textContent = t; m.className = "msg err"; }

function esc(s) { return String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])); }

// ─── Delegated event handlers (replaces inline on*="" attributes for CSP) ───
function _hv(v) { if (v === undefined) return undefined; try { return JSON.parse(v); } catch (_) { return v; } }
const _H = {
  h1(event) { submitForm() }
};
["click", "change", "input"].forEach(type => document.addEventListener(type, ev => {
  for (let el = ev.target; el && el !== document; el = el.parentElement) {
    const name = el.getAttribute && el.getAttribute("data-on" + type);
    if (!name || !_H[name]) continue;
    if (_H[name].call(el, ev) === false) ev.preventDefault();
    if (ev.cancelBubble) break;
  }
}));
