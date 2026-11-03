# KALKHAN

Azərbaycan hüququ üzrə sual oyunu. Veb tətbiq (PWA): bir linklə həm iOS, həm Android-də açılır və "Ana ekrana əlavə et" ilə tətbiq kimi qurulur. Backend: Supabase.

Ad "qalxan" sözündəndir: oyunun mexanikası da buna bağlıdır (aşağıya bax).

## Quruluş

```text
docs/                  Veb tətbiq (GitHub Pages buradan yayımlanır)
docs/admin/            Admin panel (suallar, media, CSV idxalı, rollar, statistika)
docs/brand/            Loqo: tam, emblem, söz nişanı (açıq və tünd fon üçün)
docs/fonts/            Barlow və Barlow Condensed (SIL OFL lisenziyası, Azərbaycan hərfləri yoxlanılıb)
supabase/migrations/   001_init, 002_reveal_question, 003_admin_media (hamısı tətbiq olunub)
supabase/functions/    signup (istifadəçi adı ilə qeydiyyat)
supabase/seed_test_content.sql   Yalnız prototip üçün test sualları (real sual deyil)
```

## Oyun qaydaları

- 12 sual, çətinlik hər sualda artır (bazada `level` 1–12; rütbə və ya pillə adı yoxdur)
- Hər suala 30 saniyə; sürət bonusu əsas xalın yarısına qədər; maksimum 11 700 xal
- Qalxan: 4-cü və 8-ci sualdan sonra xal qorunur, sonrakı səhv onu silmir
- "Məcəllə" yardımı oyunda bir dəfə iki səhv variantı silir
- Düzgün cavab müştəriyə göndərilmir, yoxlama və vaxt serverdədir; sualın saatı sual ekranda göründüyü anda başlayır

## Yayımlamaq

GitHub → repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, Folder: `/docs`.
Hər `main`-ə push avtomatik yenilənir. Köhnə versiyanı görən istifadəçilər üçün `docs/sw.js` içində `VERSION` dəyərini artırın.

- Oyun: https://miraliseyidov060-prog.github.io/game-of-lawyer/
- Admin: https://miraliseyidov060-prog.github.io/game-of-lawyer/admin/

## Admin panel

- Giriş oyundakı hesabla olur. Hesabın rolu `editor` və ya `admin` olmalıdır (admin "İstifadəçilər" bölməsindən rol verir).
- Yeni işçi əvvəl oyunda qeydiyyatdan keçir, sonra admin ona `editor` rolu verir.
- Sual iş axını: Qaralama → Yoxlamada → Dərc olunub. Dərc üçün qanun istinadı lazımdır.
  Müəllif öz sualını dərc edə bilməz, yalnız admin "özüm yoxlayıram" seçə bilər (bu qeyd olunur).
  Dərc olunmuş sual redaktə edilərsə yenidən yoxlamaya qayıdır.
- Media: hər suala bir şəkil, səs və ya video (Supabase Storage, `question-media`, açıq oxuma, yazma yalnız heyət).
  Şəkillər brauzerdə 1600 px-ə və WebP-yə sıxılır. Limitlər: şəkil 10 MB, səs 25 MB, video 50 MB.
- CSV idxalı: sütunlar `category, level, body, opt1..opt4, correct, explanation, legal_ref`; hər sətir qaralama kimi yaranır.

## Yerli sınaq

```bash
cd docs && python3 -m http.server 8000   # http://localhost:8000
```

## Supabase

- Layihə: `game-for-lawyer` (`gkfsppkpetziinyyxduj`), region `eu-central-1`
- `docs/config.js` yalnız açıq (publishable) açarı saxlayır. `service_role` açarı repoya və söhbətə yazılmır.
- Giriş: e-poçt + istifadəçi adı + parol (2 dəfə) və ya Google. Köhnə hesablar istifadəçi adı + parolla daxil olmağa davam edir.
  Yeni hesab e-poçt təsdiqi tələb edir. Köhnə `signup` funksiyası (e-poçtsuz) yalnız köhnə hesablar üçün qalıb.
- Ayarlar: mövzu (sistem / işıqlı / gecə), səs, titrəyiş, animasiya, ad/e-poçt/parol dəyişmə, hesabı silmə.
- Məşq rejimi: bir hüquq sahəsi üzrə 12 sual, reytinqə, ən yaxşı xala və oyun sayına yazılmır (`start_practice`, `practice_category_id`).

### Giriş sistemini işə salmaq (Supabase panelində, bir dəfə)

1. **SMTP** (Authentication → Emails → SMTP Settings): öz domeninizi Resend-də təsdiqləyin, sonra
   host `smtp.resend.com`, port `465`, istifadəçi `resend`, parol = Resend API açarı, göndərən `noreply@<domen>`.
   Domen təsdiqlənməyibsə Resend yalnız öz hesabınızın e-poçtuna göndərir. Supabase-in daxili serveri isə yalnız komanda üzvlərinə.
2. **URL-lər** (Authentication → URL Configuration): Site URL və Redirect URLs-ə
   `https://miraliseyidov060-prog.github.io/game-of-lawyer/` əlavə edin.
3. **Confirm email** (Authentication → Providers → Email) açıq olsun. Köhnə (`@players.gameforlawyer.app`) hesablara e-poçt bağlamaq üçün
   **Secure email change** söndürülməlidir (əks halda təsdiq köhnə saxta ünvana gedər).
4. **Google** (Authentication → Providers → Google): Google Cloud Console-da OAuth Client ID (Web application) yaradın,
   Authorized redirect URI = `https://gkfsppkpetziinyyxduj.supabase.co/auth/v1/callback`, Client ID və Secret-i Supabase-ə yapışdırın.
   Provider açılan kimi tətbiqdə "Google ilə davam et" düyməsi avtomatik görünür.
5. Bazada `supabase/migrations/005_practice_accounts.sql` tətbiq olunmalıdır (məşq rejimi, ad qaydaları, hesabı silmə).
