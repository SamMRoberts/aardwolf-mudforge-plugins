import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

const helpers = `
  local function ready()
    local world = newWorld()
    local core = world.core()
    local reader = world.consumer("reader", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    local function line(text, hidden, raw)
      local result = core.env.onLine(world.id, raw or text, text)
      assert((result == false) == hidden, "Unexpected visibility: " .. text)
    end
    local function initial()
      line("  {invdata}  ", true)
      line("101,,a bag,1,11,0,-1,-1", true)
      line("{/invdata}", true)
      line("{eqdata}", true); line("201,,a helm,1,7,0,6,-1", true); line("{/eqdata}", true)
    end
    return world, reader.client.inventory, core, line, initial, reader
  end
`;

const cases = {
  'owned inventory equipment container and details replies are parsed before hiding': `
    local world, inventory, core, line, initial = ready()
    line("HP: 100>", false); initial()
    assert(inventory.getItem(101).name == "a bag" and inventory.getItem(201).wearLocation == 6)
    inventory.lookIn(101)
    line("{invdata 101}", true)
    line("301,,a ruby,1,6,0,-1,-1", true, "ANSI raw row")
    line("{/invdata}", true)
    assert(inventory.getContents(101).known and inventory.getItem(301).name == "a ruby")
    inventory.identify(101)
    line("{invdetails}", true)
    line("{invheader}101|1|Container|10|1|none||Fixture||-1|||1", true)
    line("{invextra}A useful bag", true); line("{/invdetails}", true)
    assert(inventory.getDetails(101).tags[1].value == "A useful bag")
    line("HP: 100>", false); line("301,,outside a frame,1,6,0,-1,-1", false)
    assert(core.env.onLine("other-session", "{invdata}", "{invdata}") == nil)
  `,
  'manual and unsolicited frames remain visible and still update the cache': `
    local world, inventory, core, line, initial = ready(); initial()
    core.host.send("invdata")
    line("{invdata}", false); line("101,,a manual bag,1,11,0,-1,-1", false); line("{/invdata}", false)
    assert(inventory.getItem(101).name == "a manual bag")
    line("{eqdata}", false); line("{/eqdata}", false)
    core.host.send("invdetails 101")
    line("{invdetails}", false); line("{invheader}101|1|Container|10|1|none||Fixture||-1|||1", false)
    line("{invextra}manual detail", false); line("{/invdetails}", false)
    assert(inventory.getDetails(101).tags[1].value == "manual detail")
  `,
  'errors and interleaved game output remain visible while failed owned replies drain': `
    local world, inventory, core, line, initial = ready(); initial()
    inventory.lookIn(101); line("{invdata 101}", true)
    line("A goblin hits you!", false)
    assert(inventory.status().error)
    line("301,,a delayed ruby,1,6,0,-1,-1", true)
    line("HP: 90>", false); line("{/invdata}", true)
    line("301,,outside a frame,1,6,0,-1,-1", false)
    assert(not inventory.status().collecting and not inventory.getItem(301))
    inventory.lookIn(101); line("You cannot do that here.", false)
  `,
  'timed out replies hide only after their matching opening tag': `
    local world, inventory, core, line, initial = ready(); initial()
    inventory.lookIn(101); world.tick(10001)
    line("301,,unframed data,1,6,0,-1,-1", false); line("HP: 100>", false)
    line("{invdata 101}", true); line("301,,late ruby,1,6,0,-1,-1", true); line("{/invdata}", true)
    assert(not inventory.status().collecting)
    inventory.lookIn(101); line("{invdata 101}", true); world.tick(10001)
    line("301,,late ruby,1,6,0,-1,-1", true); line("{/invdata}", true)
  `,
  'monitor events stay visible and are parsed even inside hidden details': `
    local world, inventory, core, line, initial = ready(); initial()
    inventory.identify(101); line("{invdetails}", true)
    line("{invheader}101|1|Container|10|1|none||Fixture||-1|||1", true)
    line("{invitem}301,,a new ruby,1,6,0,-1,-1", false)
    assert(inventory.getItem(301).name == "a new ruby")
    line("{invmon}1,301,-1,-1", false)
    line("{invextra}A useful bag", true); line("{/invdetails}", true)
    assert(inventory.getDetails(101).tags[1].value == "A useful bag")
  `,
  'wrong opening tags and malformed details stay visible': `
    local world, inventory, core, line, initial = ready(); initial()
    inventory.identify(101); line("{invdetails}", true)
    line("You cannot identify that.", false)
    line("HP: 100>", false); line("{invextra}late detail", true); line("{/invdetails}", true)
    inventory.identify(101); line("{invdetails}", true)
    line("{invheader}malformed", false); line("{/invdetails}", true)
    inventory.lookIn(101); line("{eqdata}", false)
    line("301,,uncertain data,1,6,0,-1,-1", false); line("{/eqdata}", false)
  `,
  'manual interruption and ambiguous frames stop hiding uncertain output': `
    local world, inventory, core, line, initial = ready(); initial()
    inventory.lookIn(101); line("{invdata 101}", true)
    core.host.send("eqdata")
    line("301,,old reply,1,6,0,-1,-1", false); line("{/invdata}", false)
    line("{eqdata}", false); line("{/eqdata}", false)
    inventory.lookIn(101); line("{invdata 101}", true)
    line("{eqdata}", false); line("301,,ambiguous,1,6,0,-1,-1", false); line("{/eqdata}", false)
  `,
  'disconnect and losing the last consumer release output suppression': `
    local world, inventory, core, line, initial, reader = ready(); initial()
    inventory.lookIn(101); line("{invdata 101}", true)
    reader.client.stop()
    line("301,,after stop,1,6,0,-1,-1", false); line("{/invdata}", false)
    reader.client.start(); world.disconnect()
    line("{invdata}", false); line("101,,after disconnect,1,11,0,-1,-1", false)
  `,
};

for (const [name, source] of Object.entries(cases)) {
  test(name, () => runLua(helpers + source));
}
