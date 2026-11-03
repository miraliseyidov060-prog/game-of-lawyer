# Game for Lawyer

Azərbaycan hüququ üzrə pilləli sual oyunu (iOS, SwiftUI) + Supabase backend.

## Quruluş

```text
supabase/migrations/001_init.sql   Sxem, RLS, oyun funksiyaları (tətbiq olunub)
supabase/seed_test_content.sql     Yalnız prototip üçün test sualları (real sual deyil)
ios/                               SwiftUI tətbiqi (növbəti addım)
admin/                             Veb panel (2-ci həftə)
content/                           Sual CSV-ləri
legal/                             Lisenziya jurnalı, gizlilik siyasəti, istifadə şərtləri
```

## Supabase

- Layihə: `game-for-lawyer`, region `eu-central-1`
- API URL: `https://gkfsppkpetziinyyxduj.supabase.co`
- Müştəri açarı yalnız publishable (anon) açardır. `service_role` açarı repoya və söhbətə yazılmır.

## Oyun qaydaları

- 12 pillə; pillə n üçün əsas xal 100 × n; 30 saniyə limit
- Sürət bonusu əsas xalın yarısına qədər; maksimum 11 700 xal
- 4-cü və 8-ci pillələr təhlükəsiz nöqtədir
- Düzgün cavab müştəriyə göndərilmir; yoxlama serverdədir (`submit_answer`)
