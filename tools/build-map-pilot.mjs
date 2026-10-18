import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

export const pilotDirectory = 'src/map-pilots/aylor-cohesion';
export const pilotStem = 'dist/map-pilots/aylor-cohesion';
export const pilotNames = [
  'city', 'aylorcity', 'alley', 'road', 'road_eastwest', 'road_crossroads',
  'crossroad_nw', 'crossroad_se', 'crossroad_ews', 'inside', 'shop', 'temple',
  'palace_room', 'fountain', 'afountain', 'hellfountain',
];
const sourcePixels = 60;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const imageUri = bytes => `data:image/png;base64,${bytes.toString('base64')}`;

export function pilotStudies() {
  const legend = { c: 'city', a: 'alley', o: 'aylorcity', v: 'road', e: 'road_eastwest',
    x: 'road_crossroads', i: 'inside', m: 'shop', t: 'temple', p: 'palace_room',
    f: 'fountain', g: 'afountain', h: 'hellfountain' };
  const urban = [
    'ccofgctccccc', 'eeeeeeeexeee', 'ciacccacvccc', 'cm.cc.ccv.cc',
    'c.....hhv.cc', 'cccccchhvccc', 'pppeeexheeee', '.p....hhc.cc',
    '.p.....v....', '.......v....', '..hmhmcmhm..', '..mhmhcmhm..', '..c...cc.c..',
  ].map(row => [...row].map(key => legend[key] ?? null));
  const roads = Array.from({ length: 8 }, () => Array(12).fill('city'));
  for (let y = 0; y < 8; y++) roads[y][3] = 'road';
  for (let x = 0; x < 12; x++) roads[3][x] = 'road_eastwest';
  for (let x = 0; x < 8; x++) roads[7][x] = 'road_eastwest';
  for (let y = 1; y < 7; y++) roads[y][0] = 'road';
  for (let y = 4; y < 7; y++) roads[y][8] = 'road';
  roads[0][0] = 'crossroad_se';
  roads[0][1] = roads[0][2] = 'road_eastwest';
  roads[0][3] = roads[3][8] = 'crossroad_ews';
  roads[3][0] = roads[3][3] = roads[7][0] = roads[7][3] = 'road_crossroads';
  roads[7][8] = 'crossroad_nw';
  const market = Array.from({ length: 6 }, (_, y) => Array.from({ length: 12 }, (_, x) =>
    y === 2 ? 'city' : (x + y) % 2 ? 'shop' : 'hellfountain'));
  const materials = Array.from({ length: 6 }, (_, y) => Array.from({ length: 12 }, (_, x) =>
    y < 3 ? ['city', 'inside', 'palace_room'][Math.floor(x / 4)]
      : ['city', 'shop', 'temple', 'palace_room', 'inside', 'fountain'][x % 6]));
  return [
    { id: 'urban', title: 'Aylor-inspired streets', rows: urban,
      note: 'An illustrative arrangement inspired by the screenshot, not a reconstruction of room records or an actual navigable map.',
      overlays: [{ kind: 'player', x: 7, y: 6 }, { kind: 'flag', x: 6, y: 4 }, { kind: 'arrow', x: 9, y: 10 }] },
    { id: 'roads', title: 'Streets and directional junctions', rows: roads,
      note: 'All six main road variants share the same center ports. Paving continues across adjacent cells.',
      overlays: [{ kind: 'player', x: 3, y: 3 }, { kind: 'arrow', x: 10, y: 3 }] },
    { id: 'market', title: 'The shop and fountain repetition test', rows: market,
      note: 'Alternating shops and infernal fountains stress the exact repetition and color contrast seen in the screenshot.',
      overlays: [{ kind: 'player', x: 5, y: 2 }, { kind: 'flag', x: 8, y: 4 }] },
    { id: 'materials', title: 'Shared ground and material transitions', rows: materials,
      note: 'Solid slate, timber and limestone blocks above; mixed interior and landmark tiles below.', overlays: [] },
  ];
}

function renderScene(study, images, offsetX = 0) {
  const size = sourcePixels;
  let body = '';
  let walls = '';
  for (let y = 0; y < study.rows.length; y++) {
    for (let x = 0; x < study.rows[y].length; x++) {
      const name = study.rows[y][x];
      if (!name) continue;
      const image = images.get(name);
      if (!image) throw new Error(`Missing pilot scene terrain: ${name}`);
      const left = offsetX + x * size;
      const top = y * size;
      body += `<image href="${image}" x="${left}" y="${top}" width="${size}" height="${size}"/>`;
      if (!study.rows[y - 1]?.[x]) walls += `M${left} ${top}h${size}`;
      if (!study.rows[y + 1]?.[x]) walls += `M${left} ${top + size}h${size}`;
      if (!study.rows[y][x - 1]) walls += `M${left} ${top}v${size}`;
      if (!study.rows[y][x + 1]) walls += `M${left + size} ${top}v${size}`;
    }
  }
  body += `<path d="${walls}" fill="none" stroke="#dddcd0" stroke-width="1.3"/>`;
  for (const overlay of study.overlays) {
    const x = offsetX + (overlay.x + 0.5) * size;
    const y = (overlay.y + 0.5) * size;
    if (overlay.kind === 'player') body += `<path d="M${x} ${y - 17}l-13 25h26Z" fill="#da23e8"/><rect x="${x - 27}" y="${y - 27}" width="54" height="54" fill="none" stroke="#e95547" stroke-width="2"/>`;
    if (overlay.kind === 'flag') body += `<rect x="${x - 30}" y="${y - 30}" width="60" height="60" fill="#a13d3a" fill-opacity=".4" stroke="#c45d51" stroke-dasharray="5 4"/>`;
    if (overlay.kind === 'arrow') body += `<path d="M${x - 12} ${y - 4}h15v-6l13 10-13 10v-6H${x - 12}Z" fill="#eeb23e"/>`;
  }
  return body;
}

export function scenePng(study, images, secondImages) {
  const width = study.rows[0].length * sourcePixels;
  const height = study.rows.length * sourcePixels;
  const totalWidth = secondImages ? width * 2 + 24 : width;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}"><rect width="100%" height="100%" fill="#101925"/>${renderScene(study, images)}${secondImages ? renderScene(study, secondImages, width + 24) : ''}</svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
}

function comparisonHtml(manifest, studies, baseline, proposed, scenes, reference) {
  const urban = studies[0];
  const refinement = `<section class="study" id="refinement"><div class="section-heading"><h2>Color and depth · 0.2.0 versus ${escapeHtml(manifest.version)}</h2><p>A modest lift in material saturation, richer landmark accents and slightly stronger local shading. Scale, geometry, common floor and simulated overlays are unchanged. The left image is the frozen 0.2.0 pilot render.</p></div><div class="pair">${[
    ['Pilot 0.2.0 · reference', reference],
    [`Pilot ${manifest.version} · modest color and contrast lift`, scenes.get('urban-pilot')],
  ].map(([label, png]) => `<figure><figcaption>${escapeHtml(label)}</figcaption><div class="scene-scroll"><img class="scene" style="--columns:${urban.rows[0].length}" src="${imageUri(png)}" width="${urban.rows[0].length * sourcePixels}" height="${urban.rows.length * sourcePixels}" alt="${escapeHtml(label)}; identical urban layout and simulated overlays"></div></figure>`).join('')}</div></section>`;
  const pairs = studies.map(study => `<section class="study" id="${study.id}"><div class="section-heading"><h2>${escapeHtml(study.title)}</h2><p>${escapeHtml(study.note)}</p></div><div class="pair">${['current', 'pilot'].map(version => `<figure><figcaption>${version === 'current' ? 'Current · Three Moons 1.3.1' : 'Pilot · fine-scale depth and detail'}</figcaption><div class="scene-scroll"><img class="scene" style="--columns:${study.rows[0].length}" src="${imageUri(scenes.get(`${study.id}-${version}`))}" width="${study.rows[0].length * sourcePixels}" height="${study.rows.length * sourcePixels}" alt="${escapeHtml(study.title)} — ${version}; identical layout and simulated overlays"></div></figure>`).join('')}</div></section>`).join('');
  const cards = manifest.terrains.map(terrain => `<article><h3>${escapeHtml(terrain.name)}</h3><p>${escapeHtml(terrain.motif)}</p>${['dark', 'light'].map(theme => `<div class="samples ${theme}">${[16, 24, 32, 60].map(size => `<figure><div class="tile-pair"><img src="${baseline.get(terrain.name)}" width="${size}" height="${size}" alt="Current ${terrain.name}, ${size} px"><img src="${proposed.get(terrain.name)}" width="${size}" height="${size}" alt="Pilot ${terrain.name}, ${size} px"></div><figcaption>${size} px</figcaption></figure>`).join('')}</div>`).join('')}<div class="repeats"><figure><div class="repeat" style="background-image:url('${baseline.get(terrain.name)}')" role="img" aria-label="Current ${terrain.name} repeated 3 by 3"></div><figcaption>Current</figcaption></figure><figure><div class="repeat" style="background-image:url('${proposed.get(terrain.name)}')" role="img" aria-label="Pilot ${terrain.name} repeated 3 by 3"></div><figcaption>Pilot</figcaption></figure></div></article>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Aylor Map Cohesion Pilot — current and proposed</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#131d22;color:#e4e6da;font:15px/1.55 system-ui,sans-serif;--room-px:32px}main{max-width:1560px;margin:auto;padding:40px 28px}header{max-width:850px;margin-bottom:38px}.eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#c1ac7b}h1{font-size:clamp(30px,4vw,48px);font-weight:550;letter-spacing:-.035em;line-height:1.1;margin:12px 0 20px}header p,.section-heading p,article p{color:#aebbb8}.notice{border-left:2px solid #988863;padding-left:14px}a{color:#cbd8b8}nav{display:flex;gap:18px;flex-wrap:wrap}fieldset{border:1px solid #3b4b4e;border-radius:6px;padding:12px 18px;margin:28px 0}legend{font-size:12px;color:#b9c3ba}label{margin-right:20px;cursor:pointer}input{accent-color:#bea475}body:has(#size60:checked){--room-px:60px}.study{margin:38px 0 48px}h2{font-size:23px;font-weight:550;margin:0 0 6px}.section-heading p{margin:0 0 18px;max-width:850px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pair>figure{min-width:0;border:1px solid #35474a;border-radius:6px;background:#101925;overflow:hidden}figure{margin:0}.pair figcaption{background:#1d2a2f;padding:10px 14px;color:#d0d8c8;font-size:12px}.scene-scroll{overflow:auto;padding:12px}.scene{width:calc(var(--room-px)*var(--columns));height:auto;max-width:none;display:block}small{color:#aebbb8}#tiles{margin-top:55px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px}article{min-width:0;padding:18px;background:#1c292e;border:1px solid #35474a;border-radius:6px}h3{font:600 14px ui-monospace,monospace;margin:0}article p{font-size:12px;min-height:38px;margin:6px 0 14px}.samples{display:flex;justify-content:space-around;align-items:flex-end;gap:8px;padding:12px 6px;margin:8px 0;border-radius:3px}.dark{background:#0c161d;color:#adbcb6}.light{background:#e5e3d8;color:#43524c}.tile-pair{display:flex;gap:3px;align-items:flex-end}img{display:block}figcaption{font-size:10px;margin-top:5px}.repeats{display:flex;gap:20px;margin-top:15px}.repeat{width:96px;height:96px;background-size:32px 32px}.repeats figcaption{color:#aebbb8}footer{margin-top:38px;color:#aebbb8;font-size:12px}@media(max-width:760px){main{padding:26px 14px}.pair{grid-template-columns:1fr}.cards{grid-template-columns:1fr}fieldset label{display:block;margin:8px 0}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body><main><header><div class="eyebrow">Art direction study · ${escapeHtml(manifest.version)} · 16 terrains</div><h1>Aylor, from farther away</h1><p>Sculpted slate, textured timber and reflective basins at a smaller overhead scale. Rich material shading and compact landmarks preserve the common floor while whole streets remain readable.</p><p class="notice"><strong>Visual pilot only — not an importable pack.</strong> The existing packs are unchanged. Every pair uses identical terrain placement and simulated client overlays; these are offline renders, not a native-client capture.</p><nav aria-label="Comparison studies"><a href="#refinement">0.2.0 versus ${escapeHtml(manifest.version)}</a>${studies.map(study => `<a href="#${study.id}">${escapeHtml(study.title)}</a>`).join('')}<a href="#tiles">All 16 tiles</a></nav></header>
<fieldset><legend>Room size for layout studies · horizontally scroll larger maps</legend><label><input id="size32" name="size" type="radio" checked> 32 px rooms</label><label><input id="size60" name="size" type="radio"> 60 px rooms · screenshot scale</label><small>White walls, arrows, flags and player markers are simulated and stay the same in both versions.</small></fieldset>
${refinement}${pairs}<section id="tiles"><h2>Individual tiles and repeats</h2><p>Each size pairs current (left) and pilot (right), on dark and light backgrounds. Repeats use 32 px rooms.</p><div class="cards">${cards}</div></section><footer>Editable SVGs · pinned SVG renderer · no fonts or external images in the artwork. One fixed image per terrain; no neighbor-aware transitions or room-specific variation. Review this pilot before expanding to the other terrains or producing an importable successor.</footer></main></body></html>\n`;
}

export async function buildMapPilotOutputs(root, baselinePackBytes) {
  const directory = resolve(root, pilotDirectory);
  const manifest = JSON.parse(await readFile(resolve(directory, 'pilot.json'), 'utf8'));
  if (JSON.stringify(manifest.terrains.map(terrain => terrain.name)) !== JSON.stringify(pilotNames)) throw new Error('Pilot terrain list differs from the approved 16-terrain scope');
  const files = (await readdir(resolve(directory, 'icons'))).sort();
  if (JSON.stringify(files) !== JSON.stringify(pilotNames.map(name => `${name}.svg`).sort())) throw new Error('Pilot artwork differs from manifest');
  const currentPack = JSON.parse(baselinePackBytes);
  const baseline = new Map(currentPack.terrainStyles.map(style => [style.name, style.image]));
  const proposed = new Map();
  const outputs = new Map();
  for (const name of pilotNames) {
    if (!baseline.has(name)) throw new Error(`Missing baseline terrain: ${name}`);
    const svg = await readFile(resolve(directory, 'icons', `${name}.svg`), 'utf8');
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 128 }, font: { loadSystemFonts: false } }).render();
    if (rendered.width !== 128 || rendered.height !== 128) throw new Error(`Pilot artwork must be square: ${name}`);
    const png = Buffer.from(rendered.asPng());
    outputs.set(`${pilotStem}/${name}.png`, png);
    proposed.set(name, imageUri(png));
  }
  const studies = pilotStudies();
  const reference = await readFile(resolve(directory, 'reference/urban-0.2.0.png'));
  if (reference.length < 24 || reference.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || reference.readUInt32BE(16) !== studies[0].rows[0].length * sourcePixels
    || reference.readUInt32BE(20) !== studies[0].rows.length * sourcePixels) {
    throw new Error('Pilot 0.2.0 reference must be a PNG matching the urban study dimensions');
  }
  const scenes = new Map();
  for (const study of studies) {
    for (const [version, images] of [['current', baseline], ['pilot', proposed]]) {
      const png = scenePng(study, images);
      scenes.set(`${study.id}-${version}`, png);
      outputs.set(`${pilotStem}/${study.id}-${version}.png`, png);
    }
  }
  outputs.set(`${pilotStem}/urban-comparison.png`, scenePng(studies[0], baseline, proposed));
  outputs.set(`${pilotStem}.html`, Buffer.from(comparisonHtml(manifest, studies, baseline, proposed, scenes, reference)));
  return outputs;
}
