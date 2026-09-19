// Node-only artifact writer. Browser-facing index.mjs has no Node imports.
import { writeFile } from 'node:fs/promises';
import { runExperiment } from './index.mjs';
const report = await runExperiment({}, p => { if (p.completed % 20 === 0) console.log(`${p.completed}/${p.total}`); });
const target = new URL('./experiment-report-v2.json', import.meta.url);
await writeFile(target, JSON.stringify(report, null, 2));
console.log(target.pathname);
