import { readFile } from 'node:fs/promises';
import { evaluateCommercialLaunch } from './commercial-launch-lib.mjs';

const inputPath = process.argv[2] || new URL('../commercial-launch-evidence.template.json', import.meta.url);
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const result = evaluateCommercialLaunch(input);
console.log(JSON.stringify(result, null, 2));
if (!result.structural_valid) process.exitCode = 1;
else if (!result.complete && !process.argv.includes('--expect-incomplete')) process.exitCode = 2;
