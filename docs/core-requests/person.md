# core requests — person

## 1. `/p/:id` for an unknown or foreign person answers HTTP 200 (low priority)

**Observed** (critic round 1, item 9): `GET /p/99999999` with a valid session renders `app/(app)/p/[id]/not-found.tsx` ("没有找到这个人物") with status 200. `GET /api/people/99999999` correctly answers 404.

**Cause**: core's `app/(app)/loading.tsx` is a Suspense boundary above every `(app)` page. The page's data load is async, so Next flushes the shell (status 200) before `notFound()` runs. person's own `p/[id]/loading.tsx` has the same effect. person can drop its own loading.tsx, but it cannot get past core's.

**Ask** (either works):
- (a) Scope the app-wide skeleton so it does not wrap `p/[id]`, e.g. move `app/(app)/loading.tsx` into route groups for the pages that want it. person would then also drop `p/[id]/loading.tsx` and keep its client skeleton for in-app navigation, which it already has.
- (b) Or accept 200 and record the ruling in DECISIONS. The page is per-user and never indexed, and Next adds `<meta name="robots" content="noindex">` to not-found renders.

Until then, person keeps the not-found page (status 200) and the API 404. `person/showcase` checks the copy, not the status.

- status: rejected (option a) / accepted (option b)
- Resolution (integrator, wave 3, 2026-09-15): Option (b). 200 with the not-found UI is accepted for app pages; the API 404 is what callers rely on. Recorded in DECISIONS integrator I10. `app/(app)/loading.tsx` stays where it is, since moving it into route groups mid-wave would move other modules' pages. person may keep or drop `p/[id]/loading.tsx` (either way the status stays 200). Showcase checks the copy, not the status.
