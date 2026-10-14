import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';

const script = readFileSync(resolve(root, 'src/plugins/aardwolf-room-details.lua'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// Exercise the production property handler. Real layout and native dialog focus
// are checked separately in a browser; server content can only become text nodes.
function panel(clipboard) {
  let writes = 0;
  class Element {
    children = [];
    dataset = {};
    style = {};
    attributes = {};
    handlers = {};
    open = false;
    isConnected = true;
    constructor(tag = 'div') { this.tag = tag; }
    set textContent(value) { writes++; this.text = value; this.children = []; }
    get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
    appendChild(child) { writes++; this.children.push(child); }
    replaceChildren() { writes++; this.text = undefined; this.children.forEach(child => { child.isConnected = false; }); this.children = []; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    setAttribute(key, value) { writes++; this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    querySelectorAll(selector) { return this.children.filter(child => child.tag === selector); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.handlers.close(); }
  }
  const ids = Object.fromEntries(['chars', 'objs', 'chars-count', 'objs-count', 'auto', 'refresh', 'details',
    'status', 'main', 'detail-dialog', 'detail-title', 'detail-text', 'copy', 'close', 'copy-status']
    .map(id => [id, new Element()]));
  const selection = { toString: () => '', removeAllRanges() {}, addRange(range) { this.range = range; } };
  const document = {
    activeElement: null,
    scrollingElement: { scrollTop: 0 },
    getElementById: id => ids[id],
    createElement: tag => new Element(tag),
    createRange: () => ({ selectNodeContents(target) { this.target = target; } }),
    querySelectorAll: selector => selector === '.terminal' ? [ids.main, ids['detail-text']]
      : [...ids.chars.children, ...ids.objs.children].filter(child => child.tag === 'button'),
  };
  let receive;
  const messages = [];
  runInNewContext(script, {
    document, navigator: { clipboard },
    window: { getSelection: () => selection },
    mudforge: { onProperty: (name, fn) => { assert.equal(name, 'roomDetails'); receive = fn; },
      send: (event, data) => messages.push({ event, data }) },
  });
  let state;
  return {
    ids, messages, document, selection,
    get writes() { return writes; },
    update(changes = {}) { state = { ...state, ...changes }; receive(JSON.stringify(state)); },
    select(kind = 'chars', index = 1) {
      this.update({ selection: { kind, revision: state[kind].revision, index } });
    },
    render(runs, text = runs.map(run => run.text).join('')) {
      this.update({ chars: { revision: 1, rows: [{ text, runs }] },
        objs: { revision: 2, rows: [{ text, runs }] }, automatic: true, status: '',
        font: { family: 'monospace', size: 16, weight: 'normal' } });
      return { character: ids.chars.children[0], object: ids.objs.children[0] };
    },
  };
}

test('characters shorten all simple markers while objects shorten only leading markers', () => {
  for (const [original, characterText, objectText] of [
    ['(Golden Aura) (White Aura) A stall man standing in the room.', '(G)(W) A stall man standing in the room.', '(G)(W) A stall man standing in the room.'],
    ['(Golden Aura)\t  (White Aura)(Invisible) A man (Flying) stands here.', '(G)(W)(I) A man (F) stands here.', '(G)(W)(I) A man (Flying) stands here.'],
    ['( white aura ) A man.', '(w) A man.', '(w) A man.'],
    ['() (   ) A man.', '()() A man.', '()() A man.'],
    ['(Éthereal) (𐐀ura) A man.', '(É)(𐐀) A man.', '(É)(𐐀) A man.'],
    ['A man without markers.', 'A man without markers.', 'A man without markers.'],
    ['An unmatched (White Aura', 'An unmatched (White Aura', 'An unmatched (White Aura'],
    ['(Outer (Inner)) A man.', '(Outer (Inner)) A man.', '(Outer (Inner)) A man.'],
    ['     (Magic) (Hum) A bag (open) here.', '     (M)(H) A bag (o) here.', '(M)(H) A bag (open) here.'],
    ['  A box (wooden) here.', '  A box (w) here.', 'A box (wooden) here.'],
  ]) {
    const { character, object } = panel().render([{ text: original }]);
    assert.equal(character.textContent, characterText);
    assert.equal(object.textContent, objectText);
    assert.equal(character.title, original);
    assert.equal(object.title, original);
  }
});

test('object prefix abbreviation preserves original ANSI styling across spans and keeps raw text', () => {
  const runs = [
    { text: '    (', color: '#111111' },
    { text: 'Magic', color: '#ffcc00', italic: true },
    { text: ') ', color: '#222222' },
    { text: '(Hum', color: '#ffffff', background: '#112233', underline: true },
    { text: ') A bag (open).', color: '#44aa66' },
  ];
  const original = structuredClone(runs), view = panel();
  const { object } = view.render(runs);
  assert.equal(object.textContent, '(M)(H) A bag (open).');
  assert.deepEqual(object.children.map(span => span.textContent), ['(', 'M', ')', '(H', ') A bag (open).']);
  assert.equal(object.children[1].style.color, '#ffcc00');
  assert.equal(object.children[1].style.fontStyle, 'italic');
  assert.equal(object.children[3].style.backgroundColor, '#112233');
  assert.equal(object.children[3].style.textDecoration, 'underline');
  view.select('objs'); view.ids.details.handlers.click();
  assert.equal(view.ids['detail-text'].textContent, runs.map(run => run.text).join(''));
  assert.deepEqual(runs, original);
});

test('duplicate literal rows remain distinct; selecting and opening details never sends a game command', () => {
  const view = panel(), text = '(White Aura) <img src=x onerror=bad()> A man.';
  view.update({ chars: { revision: 1, rows: [{ text, runs: [{ text }] }, { text, runs: [{ text }] }] } });
  assert.equal(view.ids.chars.children.length, 2);
  const entry = view.ids.chars.children[1];
  assert.equal(entry.textContent, '(W) <img src=x onerror=bad()> A man.');
  entry.handlers.click();
  const message = view.messages.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(message)), { event: 'select', data: { kind: 'chars', revision: 1, index: 2 } });
  view.select('chars', 2); entry.handlers.dblclick();
  assert.equal(view.ids['detail-dialog'].open, true);
  assert.equal(view.ids['detail-text'].textContent, text);
  assert.equal(view.ids['detail-text'].children[0].tag, 'span');
  assert.deepEqual(view.messages.map(message => message.event), ['ready', 'select']);
});

test('details and DOM survive identical/unrelated updates; changed selection or list closes details', () => {
  const view = panel(), { character } = view.render([{ text: '(Golden Aura) A man.' }]);
  view.select(); character.focus(); view.ids.details.handlers.click();
  const writes = view.writes;
  view.update();
  assert.equal(view.writes, writes, 'no unnecessary text, list, or attribute writes');
  view.update({ automatic: false, status: 'Waiting for the pager to close', statusVisible: true });
  assert.equal(view.ids['detail-dialog'].open, true);
  assert.equal(view.ids.chars.children[0], character);
  view.update({ selection: null, chars: { revision: 3, rows: [{ text: 'New man', runs: [{ text: 'New man' }] }] } });
  assert.equal(view.ids['detail-dialog'].open, false);
  assert.equal(view.document.activeElement, view.ids.auto, 'detached opener falls back to an enabled toolbar control');
});

test('Enter on selected row opens details; Escape restores focus; unselected Enter and Space use button selection', () => {
  const view = panel(), { character } = view.render([{ text: 'A man.' }]);
  let prevented = false;
  const enter = { key: 'Enter', preventDefault() { prevented = true; } };
  character.handlers.keydown(enter);
  assert.equal(prevented, false);
  character.handlers.click(); view.select();
  character.handlers.keydown({ key: ' ', preventDefault() { throw new Error('Space must retain native selection'); } });
  assert.equal(view.ids['detail-dialog'].open, false);
  character.handlers.keydown(enter);
  assert.equal(prevented, true);
  assert.equal(view.document.activeElement, view.ids.close);
  view.ids['detail-dialog'].handlers.cancel({ preventDefault() {} });
  assert.equal(view.ids['detail-dialog'].open, false);
  assert.equal(view.document.activeElement, character);
});

test('keyboard activation selects even when a prior mouse copy left text selected', () => {
  const view = panel(), { character } = view.render([{ text: 'A man.' }]);
  view.selection.toString = () => 'previous selected text';
  character.handlers.click({ detail: 1 });
  assert.deepEqual(view.messages.map(message => message.event), ['ready']);
  character.handlers.click({ detail: 0 });
  assert.deepEqual(view.messages.map(message => message.event), ['ready', 'select']);
});

test('toolbar conveys pending/busy state and only shows actionable status', () => {
  const view = panel(); view.render([{ text: 'A man.' }]);
  view.update({ status: 'Refreshing room...', statusVisible: false, refreshDisabled: true, refreshBusy: true, refreshHint: 'Refreshing room...' });
  assert.equal(view.ids.status.hidden, true);
  assert.equal(view.ids.refresh.disabled, true);
  assert.equal(view.ids.refresh.getAttribute('aria-busy'), 'true');
  view.update({ status: 'Character is sleeping; wake to refresh the room', statusVisible: true, refreshBusy: false });
  assert.equal(view.ids.status.hidden, false);
  assert.equal(view.ids.status.textContent, 'Character is sleeping; wake to refresh the room');
});

test('Copy uses original plain text and reports success; unavailable clipboard selects formatted text honestly', async () => {
  const copied = [], text = '   (Magic) An object (wooden).';
  const view = panel({ writeText: async value => { copied.push(value); } });
  view.render([{ text }]); view.select('objs'); view.ids.details.handlers.click();
  await view.ids.copy.handlers.click();
  assert.deepEqual(copied, [text]);
  assert.equal(view.ids['copy-status'].textContent, 'Copied original text.');
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('Denied'); } }]) {
    const fallback = panel(clipboard); fallback.render([{ text }]); fallback.select(); fallback.ids.details.handlers.click();
    await fallback.ids.copy.handlers.click();
    assert.equal(fallback.selection.range.target, fallback.ids['detail-text']);
    assert.equal(fallback.document.activeElement, fallback.ids['detail-text']);
    assert.match(fallback.ids['copy-status'].textContent, /Clipboard unavailable.*system Copy command/);
  }
});

test('late clipboard completion cannot update closed or replaced details', async () => {
  let complete;
  const view = panel({ writeText: () => new Promise(resolve => { complete = resolve; }) });
  view.render([{ text: 'A man.' }]); view.select(); view.ids.details.handlers.click();
  const copying = view.ids.copy.handlers.click();
  view.update({ selection: null });
  complete(); await copying;
  assert.equal(view.ids['copy-status'].textContent, '');
});
