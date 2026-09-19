# Browser QA · 2026-09-18

QA by root through supervised internal preview, not the production Site.

## Desktop full case (actual clicks)

1. `/live`: select exit-service quote.
2. `/ops`: same commitment visible; confirm and reserve funds.
3. `/live`: request simulated year-end exit.
4. `/partners`: Alpha rejects; switch to Beta; task-2 is visible and actionable.
5. Beta accepts, reports pass; original resident receives 410, net actual payment is 850 excluding estimated maintenance.
6. `/live`: switch buyer, reserve item; cancel reservation; reserve again.
7. `/partners`: cancelled task-3 stays cancelled; Alpha accepts replacement delivery task-4.
8. `/live`: buyer confirms delivery and simulated payment.
9. `/ops`: DELIVERED; 11 events; closing cash 60,228, reserve 0, inventory cost 0, independent operating result 228. Delivery receipt +170 and payment −170 both present.

## Research

- `/lab` loads actual Worker-generated seed42/D/normal result: 867/1148 fulfilled (75.5%), 429 transfers, free cash 62,997.98, idle inventory 1,023 item-weeks.
- Clicked “运行120次配对实验”; returned from busy to enabled after calculation, 120-run report and paired differences rendered.
- Observed normal B−A result 52.00 yuan; D−C −11.28 yuan with interval −197.57 to 175.00. Negative result visible.
- Graphs, time slider, model limits, population rates and four accounting bridges present in DOM.

## Responsive visual review

Inspected `/live`, `/lab`, `/` in visible 390×844 iframe viewports using the same browser and real app routes. Header, controls, content hierarchy and cards fit the narrow frame and stack vertically. Research table uses its own horizontal scrolling container. Screenshot visually inspected. This is a layout check, not a complete mobile-device/accessibility certification. Temporary fixture removed before publication.

## Runtime observations

An early browser issue (`crypto.randomUUID` unavailable on the HTTP preview) was fixed with a local simulation command ID fallback and the full path then completed. Context hot-reload produced a transient mismatch during code edits; fresh navigation and complete later flows rendered normally. Extension metadata errors were separate from application code. Production build and TypeScript noEmit passed. Full repo ESLint is not clean (including explicit-any and existing v1 findings); lint-clean is not claimed as a completed gate.

WebMCP is feature-detected; native browser capability availability recorded separately in release limitations. No real payments, dispatches or production identity changes performed.

WebMCP check result: browser capability returned “WebMCP modelContext is unavailable in the current page.” The UI fallback works; callable WebMCP execution was not verified and is not claimed as passed.
