import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

const paths: string[] = [];
let dir = process.cwd();
for (let i = 0; i < 12; i++) {
  const envPath = resolve(dir, '.env');
  if (existsSync(envPath)) {
    paths.push(envPath);
  }
  const parent = resolve(dir, '..');
  if (parent === dir) {
    break;
  }
  dir = parent;
}
for (const p of paths.reverse()) {
  config({ path: p });
}
