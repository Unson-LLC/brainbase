import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/judgment-runtime-resolution.public.d.ts', import.meta.url));
const destination = fileURLToPath(new URL('../dist/judgment-runtime-resolution.public.d.ts', import.meta.url));
await copyFile(source, destination);
