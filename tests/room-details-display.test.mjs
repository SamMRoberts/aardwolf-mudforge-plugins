import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';

const script = readFileSync(resolve(root, 'src/plugins/aardwolf-room-details.lua'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// Minimal DOM host for the production property handler; browser rendering is
// checked separately. Server text must only ever be assigned as textContent.
function panel() {
  class Element {
    children = [];
    dataset = {};
    style = {};
    attributes = {};
    handlers = {};
    constructor(tag = 'div') { this.tag = tag; }
    set textContent(value) { this.text = value; }
    get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    querySelectorAll(selector) { return this.children.filter(child => child.tag === selector); }
    focus() { document.activeElement = this; }
  }
  const ids = Object.fromEntries(['chars', 'objs', 'chars-count', 'objs-count', 'auto', 'refresh', 'status', 'main']
    .map(id => [id, new Element()]));
  const document = {
    activeElement: null,
    scrollingElement: { scrollTop: 0 },
    getElementById: id => ids[id],
    createElement: tag => new Element(tag),
    querySelector: selector => ids[selector],
    querySelectorAll: () => [...ids.chars.children, ...ids.objs.children].filter(child => child.tag === 'button'),
  };
  let receive;
  const messages = [];
  runInNewContext(script, {
    document,
    window: { getSelection: () => '' },
    mudforge: { onProperty: (name, fn) => { assert.equal(name, 'roomDetails'); receive = fn; },
      send: (event, data) => messages.push({ event, data }) },
  });
  return {
    ids, messages,
    render(runs, text = runs.map(run => run.text).join('')) {
      receive(JSON.stringify({ chars: { revision: 1, rows: [{ text, runs }] },
        objs: { revision: 2, rows: [{ text, runs }] }, automatic: true }));
      return { character: ids.chars.children[0], object: ids.objs.children[0] };
    },
  };
}

test('character descriptions shorten every marker and join only adjacent parenthesis groups', () => {
  for (const [original, expected] of [
    ['(Golden Aura) (White Aura) A stall man standing in the room.', '(G)(W) A stall man standing in the room.'],
    ['(Golden Aura)\t  (White Aura)(Invisible) A man (Flying) stands here.', '(G)(W)(I) A man (F) stands here.'],
    ['( white aura ) A man.', '(w) A man.'],
    ['() (   ) A man.', '()() A man.'],
    ['(Éthereal) (𐐀ura) A man.', '(É)(𐐀) A man.'],
    ['A man without markers.', 'A man without markers.'],
    ['An unmatched (White Aura', 'An unmatched (White Aura'],
    ['(Outer (Inner)) A man.', '(Outer (Inner)) A man.'],
  ]) {
    const { character, object } = panel().render([{ text: original }]);
    assert.equal(character.textContent, expected);
    assert.equal(character.title, original);
    assert.equal(object.textContent, original);
  }
});

test('character abbreviation preserves original ANSI span styling across marker boundaries', () => {
  const runs = [
    { text: '(', color: '#111111' },
    { text: 'Golden', color: '#ffcc00', italic: true },
    { text: ' Aura) ', color: '#222222' },
    { text: '(White ', color: '#ffffff', background: '#112233', underline: true },
    { text: 'Aura) A stall man.', color: '#44aa66' },
  ];
  const original = structuredClone(runs);
  const { character, object } = panel().render(runs);
  assert.equal(character.textContent, '(G)(W) A stall man.');
  assert.deepEqual(character.children.map(span => span.textContent), ['(', 'G', ')', '(W', ') A stall man.']);
  assert.equal(character.children[1].style.color, '#ffcc00');
  assert.equal(character.children[1].style.fontStyle, 'italic');
  assert.equal(character.children[3].style.backgroundColor, '#112233');
  assert.equal(character.children[3].style.textDecoration, 'underline');
  assert.equal(object.textContent, runs.map(run => run.text).join(''));
  assert.deepEqual(runs, original);
});

test('abbreviated descriptions stay literal and selection keeps the original row identity', () => {
  const view = panel();
  const { character } = view.render([{ text: '(White Aura) <img src=x onerror=bad()> A man.' }]);
  assert.equal(character.textContent, '(W) <img src=x onerror=bad()> A man.');
  character.handlers.click();
  const selection = view.messages.at(-1);
  assert.equal(selection.event, 'select');
  assert.deepEqual(JSON.parse(JSON.stringify(selection.data)), { kind: 'chars', revision: 1, index: 1 });
});
