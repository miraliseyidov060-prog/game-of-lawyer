# Game for Lawyer

Azərbaycan hüququ üzrə pilləli sual oyunu. Veb tətbiq (PWA): bir linklə həm iOS, həm Android-də açılır və "Ana ekrana əlavə et" ilə tətbiq kimi qurulur. Backend: Supabase.

## Quruluş

```text
docs/                              Veb tətbiq (GitHub Pages buradan yayımlanır)
docs/admin/                        Admin panel (suallar, media, CSV idxalı, rollar, statistika)
supabase/migrations/               001_init, 002_reveal_question, 003_admin_media (hamısı tətbiq olunub)
supabase/functions/signup/         İstifadəçi adı ilə qeydiyyat (Edge Function, yerləşdirilib)
supabase/seed_test_content.sql     Yalnız prototip üçün test sualları (real sual deyil)
```

## Yayımlamaq (bir dəfəlik)

GitHub → repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, Folder: `/docs` → Save.
Bir dəqiqədən sonra link: https://miraliseyidov060-prog.github.io/game-of-lawyer/

Hər `main`-ə push avtomatik yenilənir. Köhnə versiyanı görən istifadəçilər üçün `docs/sw.js` içində `VERSION` dəyərini artırın.

## Admin panel

Link: https://miraliseyidov060-prog.github.io/game-of-lawyer/admin/

- Giriş oyundakı hesabla olur. Hesabın rolu `editor` və ya `admin` olmalıdır (admin "İstifadəçilər" bölməsindən rol verir).
- Yeni işçi əvvəl oyunda qeydiyyatdan keçir, sonra admin ona `editor` rolu verir.
- Sual iş axını: Qaralama → Yoxlamada → Dərc olunub. Dərc üçün qanun istinadı lazımdır.
  Müəllif öz sualını dərc edə bilməz, yalnız admin "özüm yoxlayıram" seçə bilər (bu qeyd olunur).
  Dərc olunmuş sual redaktə edilərsə yenidən yoxlamaya qayıdır.
- Media: hər suala bir şəkil, səs və ya video (Supabase Storage, `question-media`, açıq oxuma, yazma yalnız heyət).
  Şəkillər brauzerdə 1600 px-ə və WebP-yə sıxılır. Limitlər: şəkil 10 MB, səs 25 MB, video 50 MB.
- CSV idxalı: sütunlar `category, level, body, opt1..opt4, correct, explanation, legal_ref`; hər sətir qaralama kimi yaranır.

## Quraşdırma (istifadəçi üçün)

- Android (Chrome): "Quraşdır" düyməsi və ya menyu → "Tətbiqi quraşdır"
- iPhone (Safari): Paylaş → "Ana ekrana əlavə et"

## Yerli sınaq

```bash
cd docs && python3 -m http.server 8000   # http://localhost:8000
```

## Supabase

- Layihə: `game-for-lawyer` (`gkfsppkpetziinyyxduj`), region `eu-central-1`
- `docs/config.js` yalnız açıq (publishable) açarı saxlayır. `service_role` açarı repoya və söhbətə yazılmır.
- Qeydiyyat: `signup` funksiyası `<ad>@players.gameforlawyer.app` hesabı yaradır (e-poçt təsdiqi yoxdur). Hələlik parol bərpası yoxdur.
- Test sualları (`TEST sualı …`) real sualları əvəz etməlidir. Sual dərc etmək üçün qanun istinadı və müəllifdən fərqli rəyçi tələb olunur.

## Oyun qaydaları

- 12 pillə; pillə n üçün əsas xal 100 × n; hər suala 30 saniyə
- Sürət bonusu əsas xalın yarısına qədər; maksimum 11 700 xal
- 4-cü və 8-ci pillələr təhlükəsiz nöqtədir
- Düzgün cavab müştəriyə göndərilmir, yoxlama və vaxt serverdədir
- Sualın saatı sual ekranda göründüyü anda başlayır (`reveal_question`)

## Hələ yoxdur

Apple/Google ilə giriş, parol bərpası, hesab silmə, admin veb panel, onlayn duel, App Store/Google Play paketi.
