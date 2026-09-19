import {readFileSync} from 'node:fs';
import {validate} from './check-v2-workflow.mjs';
const r=validate(JSON.parse(readFileSync('workflow/release-v2.json','utf8')));
console.log(JSON.stringify(r,null,2));process.exitCode=r.ok?0:1;
