import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/plugins/aardwolf-inventory.lua', import.meta.url), 'utf8');
const html = source.match(/local INVENTORY_HTML = \[==\[([\s\S]*?)\]==\]/)[1];
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Execute the actual Lua-to-widget JSON boundary without modeling a browser DOM.
const boundary = script.slice(script.indexOf('function inventoryList('), script.indexOf('function text('));
const normalize = vm.runInNewContext(`${boundary}\nnormalizeInventoryState`);
const plain = value => JSON.parse(JSON.stringify(value));

test('inventory view accepts empty lists encoded as Lua objects', () => {
  const result = plain(normalize({ bags: {}, entries: {}, equipment: {}, actions: {},
    preferences: { bagOrder: {}, hiddenBags: {} }, profile: { rules: {} },
    details: { tags: {} }, prompt: { steps: {}, bags: {} }, preview: {} }));
  assert.deepEqual(result.bags, []);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.equipment, []);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.preferences.bagOrder, []);
  assert.deepEqual(result.preferences.hiddenBags, []);
  assert.deepEqual(result.profile.rules, []);
  assert.deepEqual(result.details.tags, []);
  assert.deepEqual(result.prompt, { steps: [], bags: [] });
  assert.deepEqual(result.preview, []);
});

test('inventory view preserves numeric list order and ignores nonnumeric object fields', () => {
  const result = plain(normalize({ bags: { 10: { id: 110 }, 2: { id: 102 }, 1: { id: 101 }, ignored: 'metadata' },
    preferences: { bagOrder: { 2: 110, 1: 101 } },
    profile: { heldSlot: 26, rules: { 1: { enabled: true, type: 8, name: 'mana', bagId: 101 } } },
    details: { id: 301, tags: { 1: { tag: 'potion', value: '<hostile text>' } } } }));
  assert.deepEqual(result.bags.map(bag => bag.id), [101, 102, 110]);
  assert.deepEqual(result.preferences.bagOrder, [101, 110]);
  assert.equal(result.profile.heldSlot, 26);
  assert.equal(result.profile.rules[0].name, 'mana');
  assert.deepEqual(result.details.tags, [{ tag: 'potion', value: '<hostile text>' }]);
});

test('inventory view distinguishes absent preview from an explicitly empty preview', () => {
  assert.equal(normalize({}).preview, undefined);
  assert.equal(normalize({ preview: null }).preview, null);
  assert.deepEqual(plain(normalize({ preview: {} }).preview), []);
  assert.deepEqual(plain(normalize({ preview: [] }).preview), []);
});

test('inventory view keeps ordinary arrays and the supplied settings unchanged', () => {
  const value = { bags: [{ id: 102 }, { id: 101 }], preferences: { fontSize: 18, bagOrder: [102, 101], hiddenBags: [] },
    profile: { heldSlot: 26, rules: [] }, prompt: { kind: 'use', requireTarget: true, steps: ['Hold wand'] } };
  const before = JSON.stringify(value);
  const result = plain(normalize(value));
  assert.deepEqual(result.bags, value.bags);
  assert.equal(result.preferences.fontSize, 18);
  assert.equal(result.prompt.requireTarget, true);
  assert.equal(JSON.stringify(value), before);
});

test('legacy character settings gain disabled quick-potion defaults without changing existing rules', () => {
  const input = { profile: { heldSlot: 26, rules: [{ enabled: true, type: 8, name: 'mana', bagId: 101 }] } };
  const result = plain(normalize(input));
  assert.deepEqual(result.profile.quickPotions, { heal: { name: '' }, mana: { name: '' } });
  assert.deepEqual(result.profile.rules, input.profile.rules);
  assert.equal(input.profile.quickPotions, undefined);
});

test('quick-potion profiles preserve each slot and optional bag independently', () => {
  const result = plain(normalize({ profile: { quickPotions: { heal: { name: 'healing', bagId: 101 } } } }));
  assert.deepEqual(result.profile.quickPotions, { heal: { name: 'healing', bagId: 101 }, mana: { name: '' } });
});

const namesBoundary = script.slice(script.indexOf('function itemName('), script.indexOf('function locationLabel('));
const nameHelpers = vm.runInNewContext(`${namesBoundary}\n({ itemName, matchesSearch })`);

test('display and search use server-provided plain names instead of embedded color markup', () => {
  const item = { name: 'a @Rred @wpotion', plainName: 'a red potion' };
  assert.equal(nameHelpers.itemName(item), 'a red potion');
  assert.equal(nameHelpers.matchesSearch(item, 'RED POTION'), true);
  assert.equal(nameHelpers.matchesSearch(item, '@R'), false);
  assert.equal(nameHelpers.itemName({ name: '<literal hostile text>' }), '<literal hostile text>');
});

const emptyBoundary = script.slice(script.indexOf('function renderEmptyState('), script.indexOf('function renderQuickPotions('));

test('an unobserved or loading scope is never described as a completed empty location', () => {
  const node = {};
  const context = { state: {}, $: () => node, text: (id, value) => { node.textContent = value; } };
  const render = vm.runInNewContext(`${emptyBoundary}\nrenderEmptyState`, context);
  for (const phase of ['unknown', 'loading', 'partial', 'stale']) {
    context.state.scopeState = phase;
    render(0, '');
    assert.equal(node.hidden, false);
    assert.doesNotMatch(node.textContent, /This location is empty|No items in this location/);
  }
  context.state.scopeState = 'empty';
  render(0, '');
  assert.equal(node.textContent, 'This location is empty.');
  render(0, 'mana');
  assert.equal(node.textContent, 'No matching items.');
  render(1, '');
  assert.equal(node.hidden, true);
});

const quickBoundary = script.slice(script.indexOf('function renderQuickPotions('), script.indexOf('function renderDetails('));

test('quick potion controls honor their own eligibility instead of the ordinary active-character gate', () => {
  const controls = Object.fromEntries(['heal-button', 'mana-button'].map(id => [id, { setAttribute() {} }]));
  const context = { state: { active: false, busy: false, quickPotions: {
    heal: { configured: true, disabled: false },
    mana: { configured: true, disabled: true, reason: 'No matching mana potion' },
  } }, $: id => controls[id] };
  const render = vm.runInNewContext(`${quickBoundary}\nrenderQuickPotions`, context);
  render();
  assert.equal(controls['heal-button'].disabled, false);
  assert.equal(controls['mana-button'].disabled, true);
  assert.equal(controls['mana-button'].title, 'No matching mana potion');
  context.state.busy = true;
  render();
  assert.equal(controls['heal-button'].disabled, true);
  context.state.busy = false;
  context.state.quickPotions = {};
  render();
  assert.equal(controls['heal-button'].disabled, true);
  assert.equal(controls['heal-button'].title, 'Configure Heal in Setup');
});
