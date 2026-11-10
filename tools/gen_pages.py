#!/usr/bin/env python3
"""ميقات — يولّد الصفحات الثابتة: 404.html, 50x.html, privacy.html, terms.html (المصدر الوحيد لنصوصها).
تشغيل: python3 gen_pages.py <dashboard-repo-root>"""
import sys, pathlib

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
UPDATED = "2026/11/10"
VERSION = "2026-11"
WA = "966541301200"
MAIL = "sales@wajhatnuzum.com"

LOGO = ('<svg viewBox="0 0 128 128" width="64%" height="64%" aria-hidden="true"><g fill="#fff"><circle cx="64" cy="23.5" r="5.5"/>'
        '<rect x="60" y="26" width="8" height="7" rx="3.2"/><path d="M64 31C83 31 92 46.5 92 65V74C92 82 95 87.2 100 91H28C33 87.2 36 82 36 74V65C36 46.5 45 31 64 31Z"/>'
        '<rect x="26" y="88" width="76" height="10.5" rx="5.25"/><circle cx="64" cy="107.5" r="6.6"/></g><circle cx="99" cy="33" r="9" fill="#5EE0AD"/></svg>')
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='15' fill='%230B6B4A'/%3E"
           "%3Cpath d='M32 14c-8 0-13 6-13 14v9l-4 6h34l-4-6v-9c0-8-5-14-13-14z' fill='%23fff'/%3E%3Ccircle cx='32' cy='48' r='4' fill='%23fff'/%3E"
           "%3Ccircle cx='46' cy='18' r='5' fill='%235EE0AD'/%3E%3C/svg%3E")


def page(title, desc, body, robots="index,follow", cta=True):
    cta_html = '<a class="cta" href="/signup.html">ابدأ التجربة</a>' if cta else ""
    return f"""<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — ميقات</title>
<meta name="description" content="{desc}">
<meta name="robots" content="{robots}">
<meta name="theme-color" content="#0B6B4A">
<link rel="icon" type="image/svg+xml" href="{FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Mono:wght@600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css?v=1">
</head>
<body>
<header class="top"><div class="in">
  <a class="brand" href="/" aria-label="ميقات — الرئيسية"><span class="logo">{LOGO}</span><span>ميقات</span></a>
  <span class="sp"></span>{cta_html}
</div></header>
{body}
<footer class="foot">
  <nav aria-label="روابط الموقع">
    <a href="/">الرئيسية</a><a href="/privacy.html">سياسة الخصوصية</a><a href="/terms.html">شروط الاستخدام</a>
    <a href="https://wa.me/{WA}" rel="noopener">الدعم عبر واتساب</a><a href="mailto:{MAIL}">{MAIL}</a>
  </nav>
  <a class="wj" href="https://wajhatnuzum.com" rel="noopener"><img src="/brand/wajhat-mark-dark.svg" alt="" width="34" height="18">من وجهة النظم</a>
</footer>
</body>
</html>
"""


def err_page(code, title, text):
    body = f"""<main class="err"><div class="card">
  <div class="code" dir="ltr">{code}</div>
  <h1>{title}</h1>
  <p>{text}</p>
  <div class="actions"><a class="btn" href="/">العودة للرئيسية</a><a class="btn ghost" href="https://wa.me/{WA}" rel="noopener">تواصل مع الدعم</a></div>
</div></main>"""
    return page(title, title, body, robots="noindex", cta=False)


PRIVACY = f"""<main><article class="card">
<h1>سياسة الخصوصية</h1>
<p class="meta">آخر تحديث: <bdi>{UPDATED}</bdi> · الإصدار <bdi>{VERSION}</bdi></p>
<p>«ميقات» نظام للجرس المدرسي والأذان والنداء، يتكوّن من لوحة تحكم سحابية على <bdi>meeqat.me</bdi> وتطبيق يعمل على جهاز لوحي داخل المدرسة، وخدمة إضافية اسمها «ميقات – ولي الأمر». تقدّمه <b>شركة وجهة النظم</b> (الرياض، المملكة العربية السعودية). توضّح هذه السياسة ما نجمعه ولماذا، وفق <b>نظام حماية البيانات الشخصية</b> في المملكة ولائحته التنفيذية.</p>
<p class="note">المدرسة هي <b>جهة التحكم</b> في بيانات طلابها ومنسوبيها وأولياء الأمور التي تُدخلها في ميقات، ونحن <b>جهة معالجة</b> نعالجها نيابةً عنها ولغرض تشغيل الخدمة فقط. أما بيانات حساب المدرسة نفسه (البريد ورقم الجوال وبيانات الفوترة) فنحن جهة التحكم فيها.</p>
<ul class="toc">
  <li><a href="#collect">ما نجمعه</a></li><li><a href="#why">لماذا</a></li><li><a href="#share">من يطّلع</a></li>
  <li><a href="#where">مكان الحفظ</a></li><li><a href="#keep">مدة الاحتفاظ</a></li><li><a href="#rights">حقوقك</a></li><li><a href="#contact">التواصل</a></li>
</ul>

<h2 id="collect">البيانات التي نجمعها</h2>
<h3>حساب المدرسة</h3>
<ul>
  <li>اسم المدرسة، والبريد الإلكتروني، ورقم الجوال (اختياري) عند التسجيل.</li>
  <li>حسابات مستخدمي اللوحة: البريد الإلكتروني، والاسم ورقم الجوال إن أُدخلا، والدور (مدير، مشرف…). كلمات المرور تُحفظ مُجزّأة (hash) ولا يمكننا قراءتها.</li>
  <li>بيانات الفوترة عند الاشتراك: اسم المنشأة، والرقم الضريبي، والعنوان، وصورة إيصال التحويل البنكي.</li>
</ul>
<h3>بيانات التشغيل</h3>
<ul>
  <li>جداول الجرس، وإعدادات مواقيت الصلاة والأذان، ونصوص النداء، والملفات الصوتية التي ترفعها المدرسة، وسجل تنفيذ الأوامر.</li>
  <li>بيانات الجهاز اللوحي: معرّف الجهاز داخل ميقات، ورمز التفعيل، وإصدار التطبيق، وحالة الاتصال ووقت آخر مزامنة، وعنوان IP.</li>
  <li><b>الصوت</b>: يستخدم تطبيق الجهاز اللوحي الميكروفون <b>فقط عندما يضغط أحد منسوبي المدرسة</b> زر «تسجيل نداء» أو «التحدث المباشر». التسجيل يُحفظ على الجهاز نفسه في مكتبة الأصوات ولا يُرسل إلينا، والتحدث المباشر يُبث إلى السماعات دون حفظ. لا يسجّل التطبيق أصوات المكان في الخلفية، ويحوّل نص النداء إلى كلام على الجهاز نفسه.</li>
</ul>
<h3>خدمة «ميقات – ولي الأمر» (عند تفعيلها من المدرسة)</h3>
<ul>
  <li><b>بيانات الطلاب</b> التي تُدخلها المدرسة: الاسم، والصف والفصل، ورقم الطالب في نظام نور (اختياري)، ونطق الاسم إن عُدّل.</li>
  <li><b>بيانات أولياء الأمور والمفوَّضين</b>: رقم الجوال، والاسم (اختياري)، وصلة التفويض ومدته، ورمز الإشعارات الخاص بجهاز الجوال.</li>
  <li><b>الموقع الجغرافي</b>: يُقرأ <b>مرة واحدة فقط لحظة الضغط على زر «وصلت»</b> للتحقق من القرب من المدرسة. <b>لا نخزّن الإحداثيات</b>؛ نحفظ المسافة بالأمتار فقط مع الطلب، ولا يوجد أي تتبع للموقع في الخلفية.</li>
  <li>سجل طلبات الاستلام: وقت الطلب والنداء والتسليم والبوابة.</li>
</ul>
<h3>زيارات الموقع</h3>
<ul>
  <li>في الصفحات العامة وصفحة التسجيل فقط نستخدم أدوات قياس (Google Analytics وGoogle Ads وMicrosoft Clarity مع إخفاء الحقول) لمعرفة أداء الإعلانات وتحسين الصفحات. لا تعمل هذه الأدوات داخل لوحة المدرسة ولا في تطبيق الجهاز اللوحي.</li>
  <li>للحماية من التسجيل الآلي نستخدم Cloudflare Turnstile في نموذج التسجيل.</li>
</ul>

<h2 id="why">لماذا نستخدمها</h2>
<ul>
  <li>تشغيل الخدمة: مزامنة الجداول والنداءات مع الجهاز اللوحي، وتنفيذ الجرس والأذان في وقته.</li>
  <li>التفعيل والترخيص والفوترة وإرسال الرسائل التشغيلية (تأكيد البريد، تذكير انتهاء التجربة، الفواتير).</li>
  <li>الدعم الفني، والأمان، ومنع إساءة الاستخدام.</li>
</ul>
<p><b>لا نبيع البيانات</b>، ولا نستخدم بيانات الطلاب أو أولياء الأمور للإعلان أو لأي غرض غير تشغيل الخدمة للمدرسة.</p>
<p>الأساس النظامي: تنفيذ العقد مع المدرسة، وموافقتك عند التسجيل، والمصلحة المشروعة في حماية الخدمة، والالتزامات النظامية (مثل حفظ الفواتير).</p>

<h2 id="share">من يطّلع عليها</h2>
<ul>
  <li>مستخدمو المدرسة حسب صلاحياتهم؛ وكل مدرسة معزولة عن غيرها على مستوى قاعدة البيانات.</li>
  <li>ولي الأمر يرى أبناءه المرتبطين به فقط.</li>
  <li>فريق الدعم في وجهة النظم عند الحاجة الفنية فقط.</li>
  <li>مزوّدو خدمات يعملون لصالحنا وبالقدر اللازم: الاستضافة، وإرسال البريد الإلكتروني، وGoogle Firebase لإشعارات تطبيق ولي الأمر، وCloudflare للتحقق من التسجيل.</li>
  <li>الجهات الرسمية عند وجود طلب نظامي.</li>
</ul>

<h2 id="where">مكان الحفظ والحماية</h2>
<p>تُحفظ البيانات على خوادم سحابية في مراكز بيانات داخل <b>ألمانيا (الاتحاد الأوروبي)</b>، أي خارج المملكة، وذلك وفق الضوابط النظامية لنقل البيانات الشخصية خارج المملكة. نحميها بالتشفير أثناء النقل (HTTPS)، وعزل بيانات كل مدرسة، وصلاحيات بحسب الدور، وتراخيص أجهزة موقّعة رقمياً، ونسخ احتياطية.</p>

<h2 id="keep">مدة الاحتفاظ</h2>
<ul>
  <li>تبقى بيانات المدرسة طوال مدة الاشتراك أو التجربة.</li>
  <li>بعد انتهاء الاشتراك أو بطلب من المدرسة نحذف بياناتها خلال 90 يوماً، ما عدا ما يلزم حفظه نظاماً (مثل الفواتير).</li>
  <li>يمكن للمدرسة حذف أي طالب أو ولي أمر أو ملف صوتي من اللوحة في أي وقت.</li>
</ul>

<h2 id="rights">حقوقك</h2>
<p>لك الحق في العلم بكيفية معالجة بياناتك، والاطلاع عليها والحصول على نسخة منها، وطلب تصحيحها أو إتلافها، وسحب موافقتك. الطلاب وأولياء الأمور يتقدّمون بطلباتهم إلى المدرسة أولاً لأنها جهة التحكم، ويمكنهم مراسلتنا مباشرة وسنحيل الطلب إليها.</p>
<p>بيانات الطلاب تُدخلها المدرسة بصفتها مسؤولة عنهم، والطلاب لا يستخدمون ميقات مباشرة.</p>

<h2 id="contact">التواصل</h2>
<p>شركة وجهة النظم — الرياض، المملكة العربية السعودية. البريد: <a href="mailto:{MAIL}">{MAIL}</a> · واتساب: <a href="https://wa.me/{WA}" dir="ltr">+{WA[:3]} {WA[3:5]} {WA[5:8]} {WA[8:]}</a></p>
<p>سنُعلن أي تغيير جوهري في هذه السياسة على هذه الصفحة وبالبريد لمدير حساب المدرسة.</p>
</article>

<article class="card en" lang="en" dir="ltr">
<h2>Privacy Policy — Meeqat (English summary)</h2>
<p>Meeqat (school bell, prayer-time adhan and announcements: cloud dashboard + in-school tablet app + the optional parent-pickup add-on) is provided by Wajhat Al Nuzum, Riyadh, Saudi Arabia, under the Saudi Personal Data Protection Law (PDPL).</p>
<ul>
  <li>The school is the controller of student, staff and guardian data it enters; we process it on the school's behalf only to run the service.</li>
  <li>We collect: school account data (name, e-mail, optional phone, billing details), dashboard users (e-mail, role; passwords are hashed), schedules, announcement texts and uploaded sounds, tablet technical data (device id, app version, last sync, IP).</li>
  <li>The tablet app uses the microphone only while staff press “record announcement” or “talk live”; recordings stay on the tablet (not uploaded) and live talk is not stored. No background audio recording.</li>
  <li>Parent pickup (if enabled): student name, grade/class, optional Noor id; guardian phone, optional name, delegation, push token. Location is read once when the parent taps “arrived” to check proximity — coordinates are not stored, only the distance in metres; no background tracking.</li>
  <li>Public pages and the sign-up page use Google Analytics/Ads and Microsoft Clarity (inputs masked); not inside the dashboard or the tablet app. No sale of data, no advertising use of student or guardian data.</li>
  <li>Hosted in Germany (EU), outside the Kingdom, under the PDPL cross-border transfer rules; HTTPS, per-school isolation, role-based access, backups.</li>
  <li>Kept for the life of the subscription and deleted within 90 days after it ends or on the school's request (except records the law requires, e.g. invoices).</li>
  <li>Requests (access, copy, correction, deletion, withdrawal of consent): through the school or <a href="mailto:{MAIL}">{MAIL}</a>.</li>
</ul>
</article></main>"""

TERMS = f"""<main><article class="card">
<h1>شروط الاستخدام</h1>
<p class="meta">آخر تحديث: <bdi>{UPDATED}</bdi> · الإصدار <bdi>{VERSION}</bdi></p>
<p>تنظّم هذه الشروط استخدام «ميقات» (لوحة التحكم على <bdi>meeqat.me</bdi>، وتطبيق الجهاز اللوحي، وخدمة «ميقات – ولي الأمر») المقدَّم من <b>شركة وجهة النظم</b>. بإنشاء حساب أو استخدام الخدمة توافق المدرسة على هذه الشروط وعلى <a href="/privacy.html">سياسة الخصوصية</a>.</p>

<h2>1. الحساب</h2>
<ul>
  <li>يُنشئ الحساب شخص مخوَّل من المدرسة، ويلتزم بصحة البيانات المدخلة.</li>
  <li>المدرسة مسؤولة عن سرية كلمات المرور ورموز التفعيل، وعن صلاحيات المستخدمين الذين تضيفهم.</li>
</ul>

<h2>2. التجربة المجانية والاشتراك</h2>
<ul>
  <li>التجربة المجانية 14 يوماً لمدرسة واحدة دون التزام، وبعد انتهائها يلزم الاشتراك لمواصلة استخدام الخدمة.</li>
  <li>الاشتراك سنوي لكل مدرسة حسب الباقة المعلنة، والأسعار غير شاملة ضريبة القيمة المضافة ما لم يُذكر غير ذلك. الدفع بالتحويل البنكي ويُفعَّل الاشتراك بعد التحقق من الإيصال.</li>
  <li>يُرسَل تنبيه قبل انتهاء التجربة أو الاشتراك.</li>
</ul>

<h2>3. بيانات المدرسة والطلاب</h2>
<ul>
  <li>المدرسة مسؤولة عن نظامية إدخال بيانات الطلاب وأولياء الأمور وعن إبلاغهم بذلك، وتبقى البيانات ملكاً لها.</li>
  <li>نعالج هذه البيانات نيابةً عن المدرسة ولغرض تشغيل الخدمة فقط، وفق سياسة الخصوصية ونظام حماية البيانات الشخصية.</li>
  <li>يمكن للمدرسة طلب نسخة من بياناتها أو حذفها.</li>
</ul>

<h2>4. الاستخدام المقبول</h2>
<ul>
  <li>لا يجوز استخدام النداء أو الأصوات لمحتوى مخالف للأنظمة أو مسيء.</li>
  <li>لا يجوز محاولة الوصول إلى بيانات مدرسة أخرى أو تعطيل الخدمة أو تفكيك التطبيق أو إعادة بيعه دون اتفاق مكتوب.</li>
</ul>

<h2>5. الجهاز اللوحي والتشغيل</h2>
<ul>
  <li>يعمل الجرس محلياً على الجهاز اللوحي حتى عند انقطاع الإنترنت، لكن التعديلات السحابية تحتاج اتصالاً للمزامنة.</li>
  <li>المدرسة مسؤولة عن تشغيل الجهاز وشحنه وتوصيله بالسماعات وضبط الصوت، وعن مراجعة الجداول بعد إدخالها.</li>
  <li>نسعى لتوفر الخدمة باستمرار، وقد تتوقف مؤقتاً للصيانة أو لأسباب خارجة عن إرادتنا.</li>
</ul>

<h2>6. المسؤولية</h2>
<p>تُقدَّم الخدمة كما هي. لا نتحمّل الأضرار غير المباشرة، وتقتصر مسؤوليتنا في جميع الأحوال على المبلغ المدفوع عن فترة الاشتراك الحالية.</p>

<h2>7. الإنهاء</h2>
<p>يمكن للمدرسة إيقاف الاشتراك في أي وقت ولا يُجدَّد تلقائياً. يحق لنا إيقاف الحساب عند مخالفة هذه الشروط بعد إشعار المدرسة متى أمكن.</p>

<h2>8. التعديلات والنظام الواجب التطبيق</h2>
<p>قد نحدّث هذه الشروط ونُعلن ذلك على هذه الصفحة وبالبريد. تخضع هذه الشروط لأنظمة المملكة العربية السعودية.</p>

<h2>9. التواصل</h2>
<p>شركة وجهة النظم — البريد: <a href="mailto:{MAIL}">{MAIL}</a> · واتساب: <a href="https://wa.me/{WA}" dir="ltr">+{WA[:3]} {WA[3:5]} {WA[5:8]} {WA[8:]}</a></p>
</article>

<article class="card en" lang="en" dir="ltr">
<h2>Terms of Use — Meeqat (English summary)</h2>
<ul>
  <li>Meeqat is provided by Wajhat Al Nuzum. Creating an account means the school accepts these terms and the <a href="/privacy.html">Privacy Policy</a>.</li>
  <li>14-day free trial for one school; then a yearly per-school subscription (prices exclude VAT unless stated), paid by bank transfer.</li>
  <li>The school owns its data, is responsible for lawfully entering student/guardian data, and may request a copy or deletion.</li>
  <li>No unlawful or offensive announcements, no access to other schools' data, no reverse engineering or resale without written agreement.</li>
  <li>The bell runs locally on the tablet when offline; the school operates the tablet and speakers and reviews its schedules.</li>
  <li>Service “as is”; liability limited to the fees paid for the current subscription period. Governed by the laws of the Kingdom of Saudi Arabia.</li>
</ul>
</article></main>"""

files = {
    "404.html": err_page("404", "الصفحة غير موجودة", "الرابط الذي فتحته غير صحيح أو نُقلت الصفحة. ارجع للرئيسية أو تواصل معنا إن احتجت مساعدة."),
    "50x.html": err_page("503", "الخدمة غير متاحة مؤقتاً", "نُجري صيانة أو نواجه عطلاً مؤقتاً. الجرس يستمر في العمل على الجهاز اللوحي بدون إنترنت. أعد المحاولة بعد دقائق."),
    "privacy.html": page("سياسة الخصوصية", "سياسة خصوصية ميقات: البيانات التي نجمعها من المدارس والطلاب وأولياء الأمور ولماذا، وحقوقك وفق نظام حماية البيانات الشخصية.", PRIVACY),
    "terms.html": page("شروط الاستخدام", "شروط استخدام ميقات: الحساب، التجربة المجانية والاشتراك، بيانات المدرسة، الاستخدام المقبول والمسؤولية.", TERMS),
}
for name, html in files.items():
    (OUT / name).write_text(html, encoding="utf-8")
    print("wrote", OUT / name, len(html))
