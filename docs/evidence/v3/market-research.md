# Market / research UI increment — verification record

Source baseline: 06be09d7ef1045ff7d796f5ab96c7d22d70a0402.

## Scope and collaborators
- market_cases: isolated market coordinator, seeded datasets, shared accounting, cross-case links; meaningful domain tests.
- research_surface: read-only, fingerprint-verified research adapter; input/output counts and aggregate flow reconciliation.
- root: integration, browser interactions, build and release.
- navigation_review: separate final source/evidence review. Reviewer did not operate the browser.

All actors/data are synthetic and local. No engine algorithm changed; pre-existing paired report is retained, not presented as rerun with new controls.

## Automated verification
42 checks passed: 18 domain invariants, 6 market tests, research adapter reconciliation suite, 17 workflow checks. Market tests cover fixed datasets, shared funds, atomic failure, case isolation, idempotency, total-cost feasibility, cross-case cancellation and delivery. Adapter confirms original-city non-mutation, fixture provenance, category counts and custom-world mismatch behavior.
TypeScript passed. Production build passed before final explanatory copy update; final build repeated for exact release source.

## Browser verification by root
Managed preview, native cross-page navigation. Loaded 12-case fixture: demand 3, available supply 2, pending/accepted tasks 3, deliveries 1, shared cash ¥59,278 / reserved ¥2,730 / free ¥56,548.
Booked 林悦 → 吴桐: demand 2, supply 1, tasks 4, deliveries remained 1; no payment at booking. Cancelled and observed cancelled-link label, then rebooked. Navigated to partner page with correct 吴桐 case, accepted new task-3 (old cancelled task-2 remained inert), returned to resident buyer view and confirmed delivery.
Lab worker completed; actual registry displayed 1,591 mock input rows and versioned engine, full-run category results reconciled to adapter. Report separately displayed capital, tenure and engine version; updated labels distinguish tick 78 from week 79 and category-window rows from windows.
Development hot reload temporarily invalidated a Context instance; removed circular presentation import and reloaded application. Subsequent document navigation and interaction succeeded. This is not a production failure claim.
Delivery completion changed shared cash to ¥59,966, free cash ¥57,236 and inventory cost ¥820; delivery total 2. Existing cancelled and completed link records remained distinguishable. Desktop visual inspection confirmed readable market columns and visible dropdown. Automated locator clicks on one dropdown option timed out; screenshot-grounded browser click selected the option successfully.
Loaded moving24 and followed native link to operations: 24 cases, 6 demands, 5 available assets, 7 active tasks, 3 deliveries; subsequent lab registry retained moving24 / 87 product events. Adjusted capital slider with keyboard to ¥70,000 and ran city: current result correctly showed ¥70,000 while retained paired report explicitly remained ¥60,000. Final production build passed. No claim of new mobile-device or live-production-browser test.
