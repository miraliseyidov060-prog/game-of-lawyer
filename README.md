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
- Giriş: istifadəçi adı + parol (qeydiyyatda parol 2 dəfə yazılır) və ya Google. E-poçt təsdiqi və parol bərpası YOXDUR (e-poçt göndərmə xidməti qurulmayıb).
  Qeydiyyat `signup` funksiyası ilə `<ad>@players.gameforlawyer.app` hesabı yaradır; Google ilə ilk girişdən sonra istifadəçi ad seçir.
- Ayarlar: mövzu (sistem / işıqlı / gecə), səs, titrəyiş, animasiya, ad və parol dəyişmə, hesabı silmə.
- Məşq rejimi: bir hüquq sahəsi üzrə 12 sual (sahədə ən azı 12 dərc olunmuş sual lazımdır), reytinqə, ən yaxşı xala və oyun sayına yazılmır.

### "Google ilə davam et" düyməsini işə salmaq (bir dəfə)

Düymə Supabase-də Google provider açılan kimi özü görünür (kodda dəyişiklik lazım deyil).

1. Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
   Authorized redirect URI: `https://gkfsppkpetziinyyxduj.supabase.co/auth/v1/callback`.
   (OAuth consent screen: External, tətbiq adı KALKHAN, məxfilik siyasəti linki: `https://miraliseyidov060-prog.github.io/game-of-lawyer/privacy.html`.)
2. Supabase → Authentication → Providers → Google: Enable, Client ID və Client Secret-i yapışdırın.
3. Supabase → Authentication → URL Configuration: Site URL = `https://miraliseyidov060-prog.github.io/game-of-lawyer/`,
   Redirect URLs-ə eyni ünvanı əlavə edin.

Qeyd: iOS-da ana ekrana əlavə olunmuş tətbiqdə Google girişi bəzən Safari-yə qayıda bilər; brauzerdə problemsizdir.

