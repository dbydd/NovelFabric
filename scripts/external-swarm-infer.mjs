#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_API_BASE = 'http://127.0.0.1:50000';

function usage() {
  return `Usage: external-swarm-infer.mjs [--input request.json|-] [--out response.json] [--api-base URL]\n\nPosts a generic external swarm inference request to NovelFabric.\n\nOptions:\n  --input, -i      JSON request file. Use - or omit to read stdin.\n  --out, -o        Response JSON file. Omit to print to stdout.\n  --api-base       NovelFabric API base. Defaults to NOVELFABRIC_API_BASE or ${DEFAULT_API_BASE}.\n  --help, -h       Show this help.\n`;
}

function parseArgs(argv) {
  const args = { input: '-', out: undefined, apiBase: process.env.NOVELFABRIC_API_BASE || DEFAULT_API_BASE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--input' || arg === '-i') {
      args.input = argv[++index];
    } else if (arg === '--out' || arg === '-o') {
      args.out = argv[++index];
    } else if (arg === '--api-base') {
      args.apiBase = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Request field ${field} must be a non-empty string`);
  }
}

function validateRequest(request) {
  requireString(request.domain, 'domain');
  requireString(request.title, 'title');
  requireString(request.summary, 'summary');
  if (!Array.isArray(request.items) || request.items.length === 0) {
    throw new Error('Request field items must be a non-empty array');
  }
  if (!Array.isArray(request.questions) || request.questions.length === 0) {
    throw new Error('Request field questions must be a non-empty array');
  }
  request.items.forEach((item, index) => {
    requireString(item.title, `items[${index}].title`);
    requireString(item.content, `items[${index}].content`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const raw = !args.input || args.input === '-' ? await readStdin() : await readFile(resolve(args.input), 'utf8');
  const request = JSON.parse(raw);
  validateRequest(request);

  const endpoint = `${args.apiBase.replace(/\/$/, '')}/api/external/swarm-inferences`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`NovelFabric API ${response.status}: ${text}`);
  }
  const pretty = `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  if (args.out) {
    const outPath = resolve(args.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, pretty, 'utf8');
  } else {
    process.stdout.write(pretty);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
