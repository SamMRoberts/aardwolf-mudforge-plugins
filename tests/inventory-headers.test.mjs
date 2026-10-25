import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

const helpers = `
  local function ready()
    local world = newWorld()
    local core = world.core()
    local reader = world.consumer("reader", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    world.line("{invdata}"); world.line("3896588735,,a potion,105,8,1,-1,-1"); world.line("{/invdata}")
    world.line("{eqdata}"); world.line("{/eqdata}")
    local results = {}; reader.client.inventory.onResult(function(result) table.insert(results, result) end)
    local function line(text) return core.env.onLine(world.id, text, text) end
    local function identify(header)
      local requestId = reader.client.inventory.identify(3896588735)
      assert(type(requestId) == "string")
      assert(line("{invdetails}") == false)
      local visibility = line(header)
      line("{/invdetails}")
      local result = results[#results]
      assert(result.requestId == requestId and not reader.client.inventory.status().collecting)
      return result, visibility
    end
    return reader.client.inventory, identify
  end
`;

test('reported 14-field potion header completes details and hides owned output', () => runLua(helpers + `
  local inventory, identify = ready()
  local result, visibility = identify("{invheader}3896588735|105|Potion|1680|13||unique, glow, hum, magic, burn-proof, v3, searchable||Boot Lyceum|||||0")
  assert(result.outcome == "complete", result.reason)
  assert(visibility == false)
  local details = inventory.getDetails(3896588735)
  assert(details.id == 3896588735 and details.level == 105 and details.itemType == "Potion")
  assert(details.value == 1680 and details.weight == 13 and details.wearLocation == "")
  assert(details.flags == "unique, glow, hum, magic, burn-proof, v3, searchable")
  assert(details.owner == "" and details.fromClanName == "Boot Lyceum")
  assert(details.timer == nil and details.itemScore == 0)
`));

test('13- and 14-field headers preserve absent optional numbers and present numeric values', () => runLua(helpers + `
  local inventory, identify = ready()
  local prefix = "{invheader}3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|"
  for _, suffix in ipairs({ "|||", "||||", "-1|||99", "600||||99" }) do
    local result, visibility = identify(prefix .. suffix)
    assert(result.outcome == "complete", result.reason)
    assert(visibility == false)
    local details = inventory.getDetails(3896588735)
    if suffix == "-1|||99" then assert(details.timer == -1 and details.itemScore == 99)
    elseif suffix == "600||||99" then assert(details.timer == 600 and details.itemScore == 99)
    else assert(details.timer == nil and details.itemScore == nil) end
  end
`));

test('invalid header numbers, field counts and mismatched IDs still fail without replacing details', () => runLua(helpers + `
  local inventory, identify = ready()
  assert(identify("{invheader}3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|-1|||99").outcome == "complete")
  local headers = {
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|invalid||||0",
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|||||invalid",
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|invalid|||0",
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum||||invalid",
    "3896588735|105|Potion||13|||Fixture|Boot Lyceum|||||0",
    "3896588735||Potion|1680|13|||Fixture|Boot Lyceum|||||0",
    "3896588735|105|Potion|1680||||Fixture|Boot Lyceum|||||0",
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|1e999||||0",
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|||||1e999",
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum|||0",
    "3896588735|105|Potion|1680|13|||Fixture|Boot Lyceum||||||0",
  }
  for _, header in ipairs(headers) do
    local result, visibility = identify("{invheader}" .. header)
    assert(result.outcome == "failed", header)
    assert(visibility ~= false, header)
    assert(inventory.getDetails(3896588735).itemScore == 99)
  end
  local result = identify("{invheader}3896588736|105|Potion|1680|13|||Fixture|Boot Lyceum|||||0")
  assert(result.outcome == "failed" and inventory.getDetails(3896588735).itemScore == 99)
`));
