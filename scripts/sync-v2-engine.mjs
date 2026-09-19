import {copyFileSync,mkdirSync} from 'node:fs';
mkdirSync('public/flowhome-v2',{recursive:true});
for(const name of ['index','city-v2','observed-v2','world-v2','experiment-v2'])copyFileSync(`lib/flowhome-v2/engine/${name}.mjs`,`public/flowhome-v2/${name}.mjs`);
