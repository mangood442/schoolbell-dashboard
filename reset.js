// reset.js — «نسيت كلمة المرور» landing page (UX audit MQ-UX-02).
// The signup function e-mails https://meeqat.me/reset.html?token_hash=…&type=recovery
// (GoTrue recovery token, 1 h, single use). We exchange it for a session, let the user
// choose a new password, then sign out so they log in normally.
const db = supabase.createClient(MQ.API, "sb_publishable_D0YQfRkraujKgNEVpSNKhw_YMvm2oB7", { auth: { persistSession: false, detectSessionInUrl: false } });
const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
function say(t, bad) { const m = $("msg"); m.textContent = t; m.className = "msg " + (bad ? "err" : "ok"); }

(async () => {
  const token_hash = q.get("token_hash");
  history.replaceState(null, "", "./reset.html");            // don't leave the token in history
  if (!token_hash) { $("state").textContent = "الرابط ناقص. اطلب رابطاً جديداً من صفحة الدخول عبر «نسيت كلمة المرور؟»."; return; }
  const { data, error } = await db.auth.verifyOtp({ token_hash, type: "recovery" });
  if (error || !data?.session) {
    $("state").innerHTML = 'الرابط غير صالح أو انتهت صلاحيته (ساعة واحدة، ولمرة واحدة). اطلب رابطاً جديداً من <a class="link" href="./index.html">صفحة الدخول</a> عبر «نسيت كلمة المرور؟».';
    return;
  }
  $("acct").value = data.session.user?.email || "";
  $("state").textContent = "الحساب: " + (data.session.user?.email || "");
  $("state").dir = "auto";
  $("pwForm").hidden = false; $("pw1").focus();
})();

$("pwForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const p1 = $("pw1").value, p2 = $("pw2").value;
  if (p1.length < 8) return say("كلمة المرور 8 أحرف على الأقل.", true);
  if (p1 !== p2) return say("كلمتا المرور غير متطابقتين.", true);
  $("saveBtn").disabled = true;
  const { error } = await db.auth.updateUser({ password: p1 });
  if (error) { $("saveBtn").disabled = false; return say(MQ.err(error), true); }
  await db.auth.signOut();
  $("pwForm").hidden = true; $("state").textContent = "";
  $("msg").innerHTML = '✓ حُفظت كلمة المرور الجديدة. <a class="link" href="./index.html">ادخل لوحة المدرسة</a> · <a class="link" href="./manager.html">تطبيق المدير</a>';
  $("msg").className = "msg ok";
});
