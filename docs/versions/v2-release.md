# V2 research MVP release decision

2026-09-18. Independent reviewer `v2_independent_qa` accepted all eight scoped research-release tasks: D1, A1, L1a, S1a, G1a, U1, E1b-city, P0. Exact decisions and final input SHA-256s are in `workflow/reviews/release-v2/`. Acceptance is limited to the stated prototype scope; the original full-system roadmap in `workflow/v2.json` remains unchanged.

Supervised browser completed the same-case purchase/commitment/exit/Alpha-refusal/Beta-inspection/reservation/cancellation/re-reservation/delivery/receipt path. Cash closed at CNY60,228 with zero reserve and inventory. Research 120-run action completed. Additional final browser check selected the capacity-shock scenario and reran: seed42/D fulfilled 767/1148, 308 transfers, CNY1.13 free cash; responsibility and inventory remained visible. V1 archive route loaded and ran its original simulation.

Domain 18 tests, engine 15 checks, workflow 17 tests passed. TypeScript and production build passed. Release manifest validator passed after copying the actual independent decisions. Known lint and WebMCP limitations are documented in the public acceptance notes. No production authentication/payment/dispatch is represented as implemented.

The final Git commit containing this file locks source, experiment data, workflow and reviews together. Publishing occurs after a successful push; the hosting version references that exact full SHA. Preserve the current public audience and the archived `/v1` route.
