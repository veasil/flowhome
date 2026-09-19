# Navigation compatibility hotfix · 2026-09-19

User reported top navigation not opening on a phone. Production Worker error logs returned no exceptions; recent visible requests showed successful document GET / responses and no workspace requests. Desktop internal dev preview did not reproduce the exact phone failure. Thus the precise device-side cause remains unconfirmed; the repair removes the susceptible client-router dependency rather than claiming a proven Safari defect.

Changes: all V2 cross-route links (header, home hero/cards and inline workspace links) now use native anchors. Browser document navigation mounts each route's layout afresh and works independently of router interception. Active routes expose aria-current. Case mutations and reset synchronously persist to the existing localStorage key before updating the UI; storage failure is reported and does not commit the mutation. Controls are inert until initial case restoration finishes. Temporary page-only controls reset when changing documents; the shared case survives.

Root's actual browser checks: home → living → operations → partners → lab → home; correct page headings appeared. Reset and select offer, then immediately navigate to operations: selected commitment was retained. Prior stored completed case loaded before reset. TypeScript noEmit and production build passed. This validates the fallback in the available desktop browser; the original iPhone session was not directly inspectable.

The change does not alter the domain rules, engine or financial simulation. Historical release reviews are retained; S1a/G1a/U1 whose reviewed UI files changed require a delta review before updating their acceptance records.
