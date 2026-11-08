// ميقات v17 — printable pro-forma invoice (browser «حفظ PDF»). Reads the invoice through RLS:
// a school member sees only its own invoices, a super admin sees all.
const db = supabase.createClient("https://meeqat-api.tripleodoo.com", "sb_publishable_D0YQfRkraujKgNEVpSNKhw_YMvm2oB7");
const SELLER = { ar: "شركة وجهة النظم", en: "Wajhat Al Nuzum", vat: "314761782600003", cr: "7054190405",
  email: "sales@wajhatnuzum.com", phone: "+966 54 130 1200" };
const BANKS = [["البنك السعودي الأول (SAB)", "SA5345000000091083261001"], ["مصرف الراجحي", "SA3980000213608010877804"]];
const esc = s => String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
const sar = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " SAR";
const iban = s => s.replace(/(.{4})/g, "$1 ").trim();
document.getElementById("printBtn").onclick = () => window.print();

(async () => {
  const root = document.getElementById("root");
  const fail = m => { root.innerHTML = `<div class="err">${m}<p><a href="./index.html">تسجيل الدخول</a></p></div>`; };
  const id = Number(new URLSearchParams(location.search).get("id"));
  const { data: { session } } = await db.auth.getSession();
  if (!session) return fail("سجّل الدخول إلى لوحة المدرسة أولًا ثم افتح الفاتورة من «💳 الاشتراك».");
  if (!id) return fail("رقم الفاتورة غير صحيح.");
  const { data: inv } = await db.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return fail("الفاتورة غير موجودة.");
  const [{ data: school }, { data: plan }] = await Promise.all([
    db.from("schools").select("name").eq("id", inv.school_id).maybeSingle(),
    inv.plan_key ? db.from("plans").select("name_ar").eq("key", inv.plan_key).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const years = Math.max(1, Math.round((inv.period_months || 12) / 12));
  const vat = inv.vat ?? Math.round(Number(inv.amount) * 15) / 100;
  const total = inv.total ?? Number(inv.amount) + vat;
  const unit = Number(inv.amount) / (inv.period_months >= 12 ? years : 1);
  const created = new Date(inv.created_at);
  const valid = new Date(created.getTime() + 7 * 86400000);
  const d = x => x.toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" });
  const statusTxt = { paid: "مدفوعة ✓", cancelled: "ملغاة", rejected: "مرفوضة" }[inv.status];
  document.title = `فاتورة مبدئية ${inv.number || id} — ميقات`;
  root.innerHTML = `<div class="sheet">
    <header>
      <div class="brand"><b>${SELLER.ar}</b><span>${SELLER.en}</span><span>الرقم الضريبي: <span class="mono" style="display:inline">${SELLER.vat}</span></span>
        <span>السجل التجاري: <span class="mono" style="display:inline">${SELLER.cr}</span></span></div>
      <div class="meta"><span><b style="color:#0B6B4A;font-size:15px">PRO-FORMA</b></span><span>No. <b class="mono">${esc(inv.number || "#" + id)}</b></span>
        <span>Date: ${d(created)}</span><span>Valid until: ${d(valid)}</span>${statusTxt ? `<span>Status: ${esc(statusTxt)}</span>` : ""}</div>
    </header>
    <h1>فاتورة مبدئية</h1><p class="sub">Pro-forma Invoice — اشتراك نظام ميقات للجرس المدرسي</p>
    <div class="grid">
      <div class="box"><h3>العميل / Bill to</h3><div><b>${esc(inv.buyer_name || school?.name || "")}</b><br>
        ${inv.buyer_vat ? `الرقم الضريبي: <span class="mono">${esc(inv.buyer_vat)}</span><br>` : ""}${inv.buyer_address ? esc(inv.buyer_address) + "<br>" : ""}
        المدرسة: ${esc(school?.name || "")}</div></div>
      <div class="box"><h3>البائع / Seller</h3><div>${SELLER.ar} — ${SELLER.en}<br>${SELLER.email}<br><bdi dir="ltr" class="mono">${SELLER.phone}</bdi></div></div>
    </div>
    <table><thead><tr><th>#</th><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>المبلغ</th></tr></thead><tbody>
      <tr><td>1</td><td>اشتراك ميقات — باقة ${esc(plan?.name_ar || inv.plan_key || "")} — ${years === 1 ? "سنة واحدة" : years === 2 ? "سنتان" : years + " سنوات"} لمدرسة واحدة<br><span style="color:#5E6F66;font-size:12px">Meeqat school-bell subscription — ${esc(inv.plan_key || "")} plan, ${years} year(s)</span></td>
        <td class="n">${inv.period_months >= 12 ? years : 1}</td><td class="n">${sar(unit)}</td><td class="n">${sar(inv.amount)}</td></tr>
      <tr class="tot"><td colspan="4">المجموع قبل الضريبة / Subtotal</td><td class="n">${sar(inv.amount)}</td></tr>
      <tr class="tot"><td colspan="4">ضريبة القيمة المضافة 15% / VAT</td><td class="n">${sar(vat)}</td></tr>
      <tr class="tot g"><td colspan="4">الإجمالي المستحق / Total due</td><td class="n">${sar(total)}</td></tr>
    </tbody></table>
    <div class="box"><h3>طريقة الدفع: تحويل بنكي باسم ${SELLER.ar}</h3>
      <table style="margin:6px 0 0"><thead><tr><th>البنك</th><th>IBAN</th></tr></thead><tbody>
      ${BANKS.map(([b, i]) => `<tr><td>${b}</td><td class="n">${iban(i)}</td></tr>`).join("")}</tbody></table></div>
    <div class="note">• اكتب رقم الفاتورة <b class="mono" dir="ltr">${esc(inv.number || "")}</b> في وصف التحويل، ثم ارفع الإيصال من «💳 الاشتراك» في لوحة المدرسة.<br>
      • هذه فاتورة مبدئية وليست فاتورة ضريبية؛ تصدر الفاتورة الضريبية بعد استلام المبلغ.<br>
      • يُمدَّد الاشتراك فور تأكيد التحويل، ويستمر الجرس دون توقف خلال المراجعة.</div>
    <footer>${SELLER.ar} · ${SELLER.en} · VAT ${SELLER.vat} · CR ${SELLER.cr} · meeqat.me</footer>
  </div>`;
})();
