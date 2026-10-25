import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';

const script = readFileSync(resolve(root, 'src/plugins/aardwolf-spells.lua'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];
const productionFunction = name => {
  const source = script.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
  assert(source, `Production ${name} function exists`);
  return source[0];
};
const chooseColumns = runInNewContext(`${productionFunction('chooseColumns')}; chooseColumns;`);
const geometry = (...args) => JSON.parse(JSON.stringify(chooseColumns(...args)));

test('column selection uses the fewest columns that fit the available height', () => {
  assert.deepEqual(geometry(1200, 600, 29, 20, 340), { columns: 1, rows: 20 });
  assert.deepEqual(geometry(1200, 290, 29, 20, 340), { columns: 2, rows: 10 });
  assert.deepEqual(geometry(1200, 289, 29, 20, 340), { columns: 3, rows: 7 });
});

test('normal and edit column widths include the gap at the exact boundary', () => {
  assert.deepEqual(geometry(689, 10, 25, 20, 340), { columns: 1, rows: 20 });
  assert.deepEqual(geometry(690, 10, 25, 20, 340), { columns: 2, rows: 10 });
  assert.deepEqual(geometry(809, 10, 25, 20, 400), { columns: 1, rows: 20 });
  assert.deepEqual(geometry(810, 10, 25, 20, 400), { columns: 2, rows: 10 });
  assert.deepEqual(geometry(1200, 150, 25, 20, 340), { columns: 3, rows: 7 });
  assert.deepEqual(geometry(1200, 150, 25, 20, 400), { columns: 2, rows: 10 });
});

test('insufficient height caps columns to readable widths and leaves rows to scroll', () => {
  assert.deepEqual(geometry(1200, 0, 25, 20, 340), { columns: 3, rows: 7 });
  assert.deepEqual(geometry(260, 100, 55, 20, 340), { columns: 1, rows: 20 });
  assert.deepEqual(geometry(1390, 0, 25, 5, 340), { columns: 3, rows: 2 });
});

test('zero, single and hidden rows do not create unnecessary columns', () => {
  assert.deepEqual(geometry(2000, 0, 0, 0, 340), { columns: 1, rows: 0 });
  assert.deepEqual(geometry(2000, 0, 25, 1, 340), { columns: 1, rows: 1 });
  assert.deepEqual(geometry(1200, 150, 25, 20, 340), { columns: 3, rows: 7 });
  assert.deepEqual(geometry(1200, 150, 25, 6, 340), { columns: 1, rows: 6 });
});

// These stubs exercise production measurement/geometry behavior, not a browser's
// CSS layout. Actual rendering, focus, docking and native bindings need separate QA.
function panel({ width = 1600, height = 500, scroll = 0, editing = false, count = 20 } = {}) {
  const classes = new Set();
  const body = { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } };
  const style = () => ({ setProperty(name, value) { this[name] = String(value); } });
  const rowElements = Array.from({ length: count }, (_, index) => ({
    index, hidden: false, style: style(),
    slots: Object.fromEntries(['single', 'area'].map(kind => [kind, { hidden: false, button: { textContent: kind },
      querySelector() { return this.button; } }])),
    querySelector(selector) { return this.slots[selector.slice(1)]; },
    getBoundingClientRect() { return { height: this.height ?? (classes.has('compact') ? 25 : 29) }; },
  }));
  const document = { body, scrollingElement: { scrollTop: scroll }, activeElement: rowElements[3] };
  const rows = { clientWidth: width, style: style(), children: rowElements,
    getBoundingClientRect() { return { top: 60 - document.scrollingElement.scrollTop }; } };
  const headings = { style: style(), children: [],
    appendChild(child) { this.children.push(child); },
    get firstElementChild() { return this.children[0]; },
    get lastElementChild() { return this.children.at(-1); },
  };
  function heading() {
    return { style: style(), cloneNode() { return heading(); }, remove() { headings.children.splice(headings.children.indexOf(this), 1); } };
  }
  headings.appendChild(heading());
  const toolbar = { getBoundingClientRect: () => ({ height: 30 }) };
  const frames = [];
  const context = { document, rows, headings, toolbar, rowElements, layoutState: { editing },
    window: { innerHeight: height }, reflowFrame: null,
    textMeasure: { measureText: text => ({ width: text.length * 6 }) },
    getComputedStyle: () => ({ font: '12px system-ui', paddingLeft: '5px', paddingRight: '5px' }),
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    // A resize must never communicate with the host or mutate saved preferences.
    mudforge: { send() { assert.fail('reflow must not send a widget message'); } },
    saveTable() { assert.fail('reflow must not write saved preferences'); },
  };
  runInNewContext(`${productionFunction('chooseColumns')}\n${productionFunction('sizeButtonColumns')}\n${productionFunction('reflow')}\n${productionFunction('scheduleReflow')}`, context);
  return { ...context, classes, frames, context, reflow: () => context.reflow(), schedule: () => context.scheduleReflow() };
}

test('reflow enables compact mode strictly below 360px and stacks by current mode width', () => {
  for (const [height, compact] of [[359, true], [360, false]]) {
    const view = panel({ height }); view.reflow();
    assert.equal(view.classes.has('compact'), compact);
    assert.match(view.rows.style.gridTemplateRows, new RegExp(`,${compact ? 25 : 29}px\\)`));
  }
  for (const [width, editing, stacked] of [[339, false, true], [340, false, false], [399, true, true], [400, true, false]]) {
    const view = panel({ width, editing }); view.reflow();
    assert.equal(view.classes.has('stacked'), stacked, `${width}px, editing=${editing}`);
  }
});

test('reflow measures the tallest visible row and ignores hidden rows', () => {
  const view = panel();
  view.rowElements[1].height = 50;
  view.rowElements[2].height = 200;
  view.rowElements[2].hidden = true;
  view.reflow();
  assert.equal(view.rows.style['--columns'], '3');
  assert.equal(view.rows.style.gridTemplateRows, 'repeat(7,50px)');
  view.rowElements[1].hidden = true;
  view.reflow();
  assert.equal(view.rows.style['--columns'], '2');
  assert.equal(view.rows.style.gridTemplateRows, 'repeat(9,29px)');
});

test('reflow preserves focus, row identity/order and scroll without scroll-dependent geometry', () => {
  const view = panel(), originalRows = [...view.rowElements], focus = view.document.activeElement;
  view.reflow();
  const originalGeometry = view.rows.style.gridTemplateRows;
  const originalColumns = view.rows.style['--columns'];
  view.document.scrollingElement.scrollTop = 240;
  view.reflow();
  assert.equal(view.rows.style.gridTemplateRows, originalGeometry);
  assert.equal(view.rows.style['--columns'], originalColumns);
  assert.equal(view.document.scrollingElement.scrollTop, 240);
  assert.equal(view.document.activeElement, focus);
  assert.deepEqual(view.rowElements, originalRows);
});

test('reflow measures document coordinates after a resize clamps the old scroll position', () => {
  const view = panel({ scroll: 240 });
  const toggle = view.document.body.classList.toggle;
  view.document.body.classList.toggle = (name, enabled) => {
    toggle(name, enabled);
    // A shorter document can clamp scrollTop when compact/stacked styles change.
    view.document.scrollingElement.scrollTop = 80;
  };
  view.reflow();
  assert.equal(view.rows.style['--columns'], '2');
  assert.equal(view.rows.style.gridTemplateRows, 'repeat(10,29px)');
});

test('reflow keeps one heading per column and collapses cleanly when all rows are hidden', () => {
  const view = panel({ height: 300 }); view.reflow();
  assert.equal(view.headings.children.length, 3);
  assert.equal(view.headings.style['--columns'], '3');
  view.rowElements.forEach(row => { row.hidden = row.index >= 4; });
  view.reflow();
  assert.equal(view.rows.style['--columns'], '1');
  assert.equal(view.headings.children.length, 1);
  view.rowElements.forEach(row => { row.hidden = true; });
  view.reflow();
  assert.equal(view.rows.style.gridTemplateRows, 'none');
  assert.equal(view.headings.children.length, 1);
});

test('resize notifications coalesce into one animation frame and allow later updates', () => {
  const view = panel();
  view.schedule(); view.schedule(); view.schedule();
  assert.equal(view.frames.length, 1);
  view.frames[0]();
  assert.equal(view.context.reflowFrame, null);
  view.schedule();
  assert.equal(view.frames.length, 2);
});

test('button widths follow bounded label lengths and align rows with their column heading', () => {
  const view = panel({ width: 1200, height: 300 });
  view.rowElements[0].slots.single.button.textContent = 'A much longer single target ability';
  view.rowElements[1].slots.area.button.textContent = 'Area';
  view.rowElements[19].slots.area.button.textContent = 'Very long '.repeat(100);
  view.reflow();
  assert.equal(view.rows.style['--columns'], '3');
  const first = view.rowElements[0].style;
  assert(Number.parseFloat(first['--single-width']) > Number.parseFloat(first['--area-width']));
  for (const row of view.rowElements.slice(0, 7)) {
    assert.equal(row.style['--single-width'], view.headings.children[0].style['--single-width']);
    assert.equal(row.style['--area-width'], view.headings.children[0].style['--area-width']);
  }
  assert.equal(view.rowElements[19].style['--area-width'], '240fr');
  view.rowElements[19].slots.area.hidden = true;
  view.reflow();
  assert.equal(view.rowElements[19].style['--area-width'], '80fr');
});

test('label updates, editing and reordered rows recalculate widths without host writes', () => {
  const view = panel({ width: 1200, height: 300 });
  view.reflow();
  assert.equal(view.rowElements[0].style['--single-width'], '80fr');
  const last = view.rowElements.at(-1);
  last.slots.single.button.textContent = 'Long '.repeat(20);
  view.rows.children = [last, ...view.rowElements.slice(0, -1)];
  view.reflow();
  assert.equal(last.style['--single-width'], '240fr');
  assert.equal(view.headings.children[0].style['--single-width'], '240fr');
  assert.equal(view.rowElements[0].style['--single-width'], '240fr');
  view.layoutState.editing = true;
  view.reflow();
  assert.equal(last.style['--single-width'], '256fr');
});
