import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
await mkdir(new URL('./src/', dist), { recursive: true });
await mkdir(new URL('./data/', dist), { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js']) await cp(new URL(file, root), new URL(file, dist));
for (const file of ['planner.js', 'date-display.js']) await cp(new URL(`src/${file}`, root), new URL(`src/${file}`, dist));
for (const file of ['student-plan.v1.json', 'project-plan.v1.json']) await cp(new URL(`data/${file}`, root), new URL(`data/${file}`, dist));
console.log('Built dist/');
