# Game for Lawyer

Azərbaycan hüququ üzrə pilləli sual oyunu. Veb tətbiq (PWA): bir linklə həm iOS, həm Android-də açılır və "Ana ekrana əlavə et" ilə tətbiq kimi qurulur. Backend: Supabase.

## Quruluş

```text
docs/                              Veb tətbiq (GitHub Pages buradan yayımlanır)
supabase/migrations/               001_init.sql, 002_reveal_question.sql (hər ikisi tətbiq olunub)
supabase/functions/signup/         İstifadəçi adı ilə qeydiyyat (Edge Function, yerləşdirilib)
supabase/seed_test_content.sql     Yalnız prototip üçün test sualları (real sual deyil)
```

## Yayımlamaq (bir dəfəlik)

GitHub → repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, Folder: `/docs` → Save.
Bir dəqiqədən sonra link: https://miraliseyidov060-prog.github.io/game-of-lawyer/

Hər `main`-ə push avtomatik yenilənir. Köhnə versiyanı görən istifadəçilər üçün `docs/sw.js` içində `VERSION` dəyərini artırın.

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
