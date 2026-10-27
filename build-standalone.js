import { readFileSync, writeFileSync } from 'node:fs';
const index = readFileSync('dist/index.html', 'utf8');
const jsPath = index.match(/<script[^>]+src="\.\/([^\"]+)"/)[1];
const cssPath = index.match(/<link[^>]+href="\.\/([^\"]+\.css)"/)[1];
const js = readFileSync(`dist/${jsPath}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(`dist/${cssPath}`, 'utf8');
writeFileSync('family-planner.html', `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Our Week · Shared Family Planner</title><style>${css}</style></head><body><div id="app"></div><script type="module">${js}</script></body></html>\n`);
console.log('Generated standalone shared planner.');
