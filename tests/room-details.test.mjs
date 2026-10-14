import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runLua } from './lua-runtime.mjs';
import { root } from '../tools/build-repository.mjs';

const fixture = readFileSync(resolve(root, 'tests/fixtures/room-details.lua'), 'utf8');
const setup = `local world, context, env = roomWorld(); world.ready(); world.active(); world.tick(300); world.prompt()`;
const cases = {
  'unchanged snapshots preserve revisions, duplicate rows and selection, but styled changes invalidate them': `
    ${setup}
    world.block("chars", { "A man.", "A man." })
    local revision = world.state().chars.revision
    world.message("select", { kind = "chars", revision = revision, index = 2 })
    world.block("chars", { "A man.", "A man." })
    assert(world.state().chars.revision == revision and #world.state().chars.rows == 2)
    assert(world.state().selection.index == 2)
    env.parseAnsiText = function(raw) return { { text = "A man.", color = "#ffffff", italic = true } } end
    world.block("chars", { "A man.", "A man." })
    assert(world.state().chars.revision ~= revision and world.state().selection == nil)
  `,
  'snapshot identity includes original text, order and completeness and never survives a room change': `
    ${setup}
    world.packet("room.info", { num = 1 })
    world.block("objs", { "A key.", "A bag." })
    local first = world.state().objs.revision
    world.message("select", { kind = "objs", revision = first, index = 1 })
    world.block("objs", { "A bag.", "A key." })
    assert(world.state().objs.revision ~= first and world.state().selection == nil)
    local reordered = world.state().objs.revision
    world.line("{roomobjs}"); world.line("A bag."); world.line("A key."); world.tick(5000)
    assert(world.state().objs.revision ~= reordered and world.state().objs.incomplete)
    local incomplete = world.state().objs.revision
    world.block("objs", { "A bag.", "A key." })
    assert(world.state().objs.revision ~= incomplete and not world.state().objs.incomplete)
    local complete = world.state().objs.revision
    world.message("select", { kind = "objs", revision = complete, index = 1 })
    world.packet("room.info", { num = 2 })
    assert(world.state().objs.revision ~= complete and world.state().selection == nil)
    world.message("select", { kind = "objs", revision = complete, index = 1 })
    assert(world.state().selection == nil)
  `,
  'unchanged status packets do not publish panel data, and ready forces a fresh delivery': `
    ${setup}
    world.block("chars", { "A man." }); world.block("objs", { "A key." })
    local count, encodes = 0, 0
    env.json = { encode = function(value) encodes = encodes + 1; return json.encode(value) end }
    local original = env.setWidgetProperty
    env.setWidgetProperty = function(id, key, value)
      if key == "roomDetails" then count = count + 1 end
      return original(id, key, value)
    end
    for index = 1, 100 do world.packet("char.status", { state = 3 }) end
    assert(count == 0 and encodes == 0)
    world.ready(); assert(count == 1 and encodes == 1 and #world.state().chars.rows == 1)
    world.packet("char.status", { state = 3 }); assert(count == 1)
  `,
  'capture recovery clears only its own error and preserves unrelated failures': `
    ${setup}
    world.line("{roomchars}"); world.line("A man."); world.tick(5000)
    assert(world.state().chars.incomplete)
    world.block("chars", { "A recovered man." })
    assert(world.state().status == "" and not world.state().chars.incomplete)
    context.refuseWrites = true; world.commands.awroomdetails("auto off")
    local savedError = world.state().status
    world.line("{roomobjs}"); world.line("A key."); world.tick(5000)
    world.block("objs", { "A recovered key." })
    assert(world.state().status == savedError and not world.state().objs.incomplete)
    context.refuseWrites = false; world.commands.awroomdetails("auto off")
    assert(world.state().status == "")
    world.line("{roomchars}"); world.line("A man."); world.tick(5000)
    world.block("objs", { "A key." })
    assert(string.find(world.state().status, "Incomplete", 1, true))
  `,
  'refresh controls explain sleeping, pager, Spells and prompt waits without a normal activity row': `
    ${setup}
    world.packet("char.status", { state = 9 }); world.commands.awroomdetails("refresh")
    assert(string.find(world.state().status, "sleeping", 1, true))
    assert(world.state().statusVisible and world.state().refreshDisabled)
    world.packet("char.status", { state = 7 })
    assert(string.find(world.state().status, "pager", 1, true))
    world.spellsBusy(true); world.packet("char.status", { state = 3 })
    assert(string.find(world.state().status, "Spells", 1, true))
    world.spellsBusy(false); world.tick(1000)
    assert(world.state().refreshBusy and not world.state().statusVisible)
    world.prompt(); assert(not world.state().refreshDisabled)
    env.onSend(world.id, "get key")
    assert(string.find(world.state().status, "prompt", 1, true))
  `,
  'login configures tags in order once, waits for authentication and handles reconnect': `
    local world, context, env = roomWorld()
    world.ready(); world.tick(1000); assert(#world.sends == 0)
    world.connect(); world.tick(1000); assert(#world.sends == 0)
    world.packet("char.base", { name = "Fixture" }); world.tick(1000); assert(#world.sends == 0)
    world.packet("char.status", { state = 3 }); world.tick(300)
    assert(#world.sends == 3 and world.sends[1] == "tags roomobjs on")
    assert(world.sends[2] == "tags roomchars on" and world.sends[3] == "look")
    env.init(); world.packet("char.status", { state = 3 }); world.prompt(); world.tick(2000)
    assert(#world.sends == 3 and world.panel().contentWrites == 1)
    world.disconnect(); world.active(); world.tick(300); assert(#world.sends == 6)
  `,
  'installing into an active session configures once and Core restart does not repeat setup': `
    local existing = runningWorld(); existing.packet("char.status", { state = 3 })
    local world, context, env = roomWorld(existing); world.ready(); world.tick(300)
    assert(#world.sends == 3)
    world.prompt(); world.unload(world.plugins["imported-core-17"]); world.core("replacement-core")
    world.packet("char.status", { state = 3 }); world.tick(2000)
    assert(#world.sends == 3)
  `,
  'blocks replace their own lists, retain duplicates and whitespace, and empty blocks clear': `
    ${setup}
    world.block("chars", { "(White Aura) A man greets arriving guests.", "(White Aura) A man greets arriving guests." })
    world.block("objs", { "     A key.", "", "A chest." })
    local state = world.state()
    assert(#state.chars.rows == 2 and state.chars.rows[1].text == state.chars.rows[2].text)
    assert(state.objs.rows[1].text == "     A key." and state.objs.rows[2].text == "")
    world.block("chars", {})
    assert(next(world.state().chars.rows) == nil and #world.state().objs.rows == 3)
    assert(world.panel().contentWrites == 1)
  `,
  'suppression requires a ready visible panel and preserves outside and other-session output': `
    local world, context, env = roomWorld(); world.active(); world.tick(300)
    assert(not world.line("{roomchars}")); assert(not world.line("A man.")); assert(not world.line("{/roomchars}"))
    world.ready(); assert(world.line("{roomchars}")); assert(world.line("A man.")); assert(world.line("{/roomchars}"))
    assert(not world.line("A friend tells you: {roomchars}"))
    assert(not world.line("{roomchars}", nil, "other-session"))
    world.commands.awroomdetails("hide")
    assert(not world.line("{roomobjs}")); assert(not world.line("A key.")); assert(not world.line("{/roomobjs}"))
    world.commands.awroomdetails("show"); assert(world.line("{roomobjs}")); world.line("{/roomobjs}")
  `,
  'native ANSI segments preserve style and carry SGR from outside tags across lines': `
    ${setup}
    world.line("A room.", "\\27[3;4;38;2;12;34;56;48;5;22mA room.")
    world.line("{roomchars}")
    local calls = 0
    env.parseAnsiText = function(raw)
      assert(string.find(raw, "3;4;38;2;12;34;56;48;5;22m", 1, true))
      calls = calls + 1
      return { ["1"] = { text = calls == 1 and "A man." or "Another man.", color = "#0c2238",
        backgroundColor = "rgb(0, 95, 0)", italic = true, underline = true } }
    end
    assert(world.line("A man.")); assert(world.line("Another man.")); world.line("{/roomchars}")
    local row = world.state().chars.rows[2]
    assert(row.runs[1].color == "#0c2238" and row.runs[1].background == "rgb(0, 95, 0)")
    assert(row.runs[1].italic and row.runs[1].underline and calls == 2)
    assert(world.state().font.family == "Menlo, monospace")
  `,
  'malformed frames timeout, release suppression, and retain incomplete text': `
    ${setup}
    world.line("{roomchars}"); world.line("A man."); assert(not world.line("{/roomobjs}"))
    assert(world.state().chars.incomplete and world.state().chars.rows[1].text == "A man.")
    assert(not world.line("Unrelated output."))
    world.line("{roomobjs}"); world.line("A key."); world.tick(5000)
    assert(world.state().objs.incomplete and not world.line("A friend speaks."))
    world.line("{roomobjs}"); world.line("Another key."); world.prompt()
    assert(world.state().objs.incomplete)
    world.line("{roomchars}"); world.line("A man."); world.line("{roomobjs}"); world.line("A chest."); world.line("{/roomobjs}")
    assert(world.state().chars.incomplete and not world.state().objs.incomplete)
  `,
  'bounds and formatting failures fail open without executing server markup': `
    ${setup}
    world.line("{roomobjs}")
    for index = 1, 500 do assert(world.line("A key.")) end
    assert(not world.line("Overflow")); assert(world.state().objs.incomplete)
    world.line("{roomobjs}"); assert(not world.line(string.rep("x", 128 * 1024)))
    assert(world.state().objs.incomplete)
    env.parseAnsiText = function(raw) return { { text = "Unsafe", color = "red; background:url(bad)" } } end
    world.line("{roomchars}"); assert(not world.line("Unsafe"))
    assert(world.state().chars.incomplete)
    env.parseAnsiText = nil
    assert(not world.line("{roomchars}")); assert(not world.line("<script>bad()</script>"))
  `,
  'selection is single, revision checked, session scoped, and never sends commands': `
    ${setup}
    world.block("chars", { "A man.", "A man." }); world.block("objs", { "A key." })
    local count, state = #world.sends, world.state()
    world.message("select", { kind = "chars", revision = state.chars.revision, index = 2 })
    assert(world.state().selection.index == 2)
    world.message("select", { kind = "objs", revision = state.objs.revision, index = 1 })
    assert(world.state().selection.kind == "objs")
    world.message("select", { kind = "chars", revision = state.chars.revision, index = 1 }, "other-session")
    assert(world.state().selection.kind == "objs" and #world.sends == count)
    world.block("objs", { "Another key." }); assert(world.state().selection == nil)
    world.message("select", { kind = "objs", revision = state.objs.revision, index = 1 })
    assert(world.state().selection == nil and #world.sends == count)
  `,
  'item refreshes wait for a prompt, coalesce activity, and enforce quiet and rate limits': `
    ${setup}
    env.onSend(world.id, "get key"); world.tick(2000); assert(#world.sends == 3)
    env.onSend(world.id, "drop key"); world.prompt(true); world.prompt(false)
    world.tick(299); assert(#world.sends == 3)
    world.tick(1); assert(#world.sends == 4 and world.sends[4] == "look")
    world.prompt(); env.onSend(world.id, "put key bag"); world.prompt()
    world.tick(999); assert(#world.sends == 4)
    world.tick(1); assert(#world.sends == 5)
    world.prompt(); world.tick(5000); assert(#world.sends == 5)
  `,
  'combat and pager eligibility defer looks and Spells ownership defers setup and refresh': `
    local world, context, env = roomWorld(); world.ready(); world.active(); world.spellsBusy(true)
    world.tick(1000); assert(#world.sends == 0)
    world.spellsBusy(false); world.tick(300); assert(#world.sends == 3); world.prompt()
    world.packet("char.status", { state = 8 }); world.line("A fight."); world.prompt()
    world.tick(1000); assert(#world.sends == 3)
    world.spellsBusy(true); world.packet("char.status", { state = 3 }); world.prompt(); world.tick(1000)
    assert(#world.sends == 3)
    world.spellsBusy(false); world.tick(300); assert(#world.sends == 4); world.prompt()
    env.onSend(world.id, "get key"); world.packet("char.status", { state = 7 }); world.prompt(); world.tick(2000)
    assert(#world.sends == 4)
    world.packet("char.status", { state = 3 }); world.tick(300); assert(#world.sends == 5)
  `,
  'finalizing an old provisional prompt cannot release a newly queued item refresh': `
    ${setup}
    world.line("A room."); world.prompt(true)
    env.onSend(world.id, "get key"); world.prompt(false); world.tick(2000)
    assert(#world.sends == 3)
    world.line("You get a key."); world.prompt(true); world.tick(300)
    assert(#world.sends == 4)
    world.prompt(false); world.tick(2000); assert(#world.sends == 4)
  `,
  'combat refresh waits for its final prompt in either GMCP ordering': `
    ${setup}
    world.packet("char.status", { state = 8 }); world.line("Round one."); world.prompt(); world.tick(1000)
    world.packet("char.status", { state = 3 }); world.tick(2000); assert(#world.sends == 3)
    world.prompt(); world.tick(300); assert(#world.sends == 4); world.prompt()
    world.packet("char.status", { state = 8 }); world.line("Round two."); world.prompt()
    world.packet("char.status", { state = 3 }); world.tick(1000); assert(#world.sends == 5)
  `,
  'room capture defers refresh and look failures never loop or retry automatically': `
    ${setup}
    world.commands.awroomdetails("refresh"); world.line("{roomchars}"); world.line("A man.")
    world.tick(2000); assert(#world.sends == 3)
    world.line("{/roomchars}"); world.tick(300); assert(#world.sends == 4)
    world.tick(5000); assert(string.find(world.state().status, "timed out", 1, true))
    world.tick(10000); assert(#world.sends == 4)
    world.refuseSend = "look"; world.commands.awroomdetails("refresh"); world.tick(300)
    assert(string.find(world.state().status, "Could not send look", 1, true))
    world.tick(10000); assert(#world.sends == 4)
    world.refuseSend = nil; world.commands.awroomdetails("refresh"); world.tick(300); assert(#world.sends == 5)
  `,
  'font updates are relayed without content replacement and missing font APIs disable gagging': `
    ${setup}
    world.font = { family = "Fira Code, monospace", size = 16 }
    world.line("An ordinary line.")
    assert(world.state().font.size == 16 and world.panel().contentWrites == 1)
    env.getTerminalFont = nil
    assert(not world.line("{roomobjs}")); assert(not world.line("A key.")); assert(not world.line("{/roomobjs}"))
    assert(string.find(world.state().status, "Formatting API unavailable", 1, true))
  `,
  'room identity changes preserve new frames before or after GMCP within an output cycle': `
    ${setup}
    world.packet("room.info", { num = 1 }); world.block("chars", { "Old man." }); world.block("objs", { "Old key." }); world.prompt()
    env.onSend(world.id, "north"); world.packet("room.info", { num = 2 })
    assert(world.state().chars == nil and world.state().objs == nil)
    world.block("chars", { "New man." }); world.block("objs", { "New key." }); world.prompt()
    env.onSend(world.id, "north"); world.block("chars", { "Third man." })
    world.packet("room.info", { num = 3 })
    assert(world.state().chars.rows[1].text == "Third man." and world.state().objs == nil)
    world.block("objs", { "Third key." }); world.prompt(); world.packet("room.info", { num = 4 })
    assert(world.state().chars.rows[1].text == "Third man." and world.state().objs.rows[1].text == "Third key.")
  `,
  'Auto preference is durable, failed saves retain it, and manual refresh remains available': `
    ${setup}
    world.commands.awroomdetails("auto off"); env.onSend(world.id, "get key"); world.prompt(); world.tick(2000)
    assert(not world.state().automatic and #world.sends == 3)
    context.refuseWrites = true; world.commands.awroomdetails("auto on"); assert(not world.state().automatic)
    world.commands.awroomdetails("refresh"); world.tick(300); assert(#world.sends == 4)
    context.refuseWrites = false
    env.cleanup(); env.init(); world.ready(); assert(not world.state().automatic)
    assert(world.panel().config.size.width == 360 and world.panel().config.size.height == 240)
  `,
  'send and timer failures are bounded, explicit refresh recovers, cleanup fences callbacks': `
    local world, context, env = roomWorld(); world.ready(); world.refuseSend = "tags roomchars on"
    world.active(); world.tick(300); assert(#world.sends == 1 and string.find(world.state().status, "Could not send", 1, true))
    world.tick(10000); assert(#world.sends == 1)
    world.refuseSend = nil; world.commands.awroomdetails("refresh"); world.tick(300); assert(#world.sends == 4)
    world.prompt(); world.refuseTimers = true
    assert(not world.line("{roomchars}")); assert(not world.line("A man."))
    world.refuseTimers = false; env.onSend(world.id, "get key"); world.prompt()
    env.cleanup(); world.tick(10000); assert(#world.sends == 4 and next(context.widgets) == nil)
    assert(not env.onLine(world.id, "{roomchars}", "{roomchars}"))
  `,
};

for (const [name, body] of Object.entries(cases)) test(`room details ${name}`, () => runLua(fixture + body));

test('room details supplied example only suppresses tagged output', () => {
  const lines = readFileSync(resolve(root, 'tests/fixtures/room-details.txt'), 'utf8').trimEnd().split('\n');
  runLua(fixture + setup + `
    local before = #world.output
    for _, line in ipairs(example_lines()) do world.line(line) end
    assert(#world.state().chars.rows == 2 and #world.state().objs.rows == 3)
    assert(#world.output == before + 2)
  `, { example_lines: () => lines });
});
