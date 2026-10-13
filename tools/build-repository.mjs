import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import luaparse from 'luaparse';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = [
  { kind: 'plugin', file: 'aardwolf-api-core.lua', category: 'utilities', tags: ['aardwolf', 'gmcp', 'core'] },
  { kind: 'plugin', file: 'aardwolf-api-vitals-example.lua', category: 'development', tags: ['aardwolf', 'example', 'vitals'] },
  { kind: 'library', file: 'aardwolf-api.lua', tags: ['aardwolf', 'gmcp', 'api'] },
];

function metadata(source, kind) {
  const tree = luaparse.parse(source, { luaVersion: '5.1', encodingMode: 'x-user-defined' });
  const assignment = tree.body.find(node => node.type === 'AssignmentStatement'
    && node.variables.length === 1 && node.variables[0].name === kind);
  const table = assignment?.init[0];
  if (table?.type !== 'TableConstructorExpression') throw new Error(`Missing ${kind} metadata`);
  const fields = {};
  for (const field of table.fields) {
    if (field.type === 'TableKeyString' && field.value.type === 'StringLiteral') fields[field.key.name] = field.value.value;
  }
  for (const key of ['name', 'version', 'author', 'description', ...(kind === 'plugin' ? ['id'] : [])]) {
    if (!fields[key]) throw new Error(`Missing ${kind}.${key}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(fields.version)) throw new Error('Version must be semver');
  return fields;
}

export async function buildOutputs() {
  const catalog = { schemaVersion: 1, name: 'Aardwolf MudForge Plugins', description: 'Shared Aardwolf API and example plugins for MudForge.', plugins: [], libraries: [] };
  const outputs = new Map();
  const identities = new Set();
  for (const entry of entries) {
    const folder = entry.kind === 'plugin' ? 'plugins' : 'libs';
    const bytes = await readFile(resolve(root, 'src', folder, entry.file));
    const fields = metadata(bytes.toString('utf8'), entry.kind);
    const identity = entry.kind === 'plugin' ? fields.id : fields.name;
    if (identities.has(identity)) throw new Error(`Duplicate identity: ${identity}`);
    identities.add(identity);
    if (entry.kind === 'library' && (!/^[a-zA-Z0-9_-]{1,64}$/.test(identity)
      || entry.file !== `${identity}.lua` || bytes.length > 256 * 1024)) throw new Error('Invalid library name or size');
    const path = `dist/${folder}/${entry.file}`;
    outputs.set(path, bytes);
    const listing = { ...fields, ...(entry.category ? { category: entry.category } : {}), tags: entry.tags,
      downloadUrl: path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    if (entry.kind === 'plugin') listing.format = 'lua';
    catalog[entry.kind === 'plugin' ? 'plugins' : 'libraries'].push(listing);
  }
  outputs.set('plugins.json', Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`));
  return outputs;
}

async function main() {
  const check = process.argv.includes('--check');
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node tools/build-repository.mjs [--check]');
  const outputs = await buildOutputs();
  for (const [path, bytes] of outputs) {
    const target = resolve(root, path);
    if (check) {
      let current;
      try { current = await readFile(target); } catch { throw new Error(`Missing generated file: ${path}`); }
      if (!current.equals(bytes)) throw new Error(`Generated file is stale: ${path}; run npm run build`);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  console.log(`${check ? 'Checked' : 'Built'} ${outputs.size} repository files`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
