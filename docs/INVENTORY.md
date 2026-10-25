# Aardwolf Inventory Management

Inventory Management **0.2.1** uses `aardwolf-api` **0.8.2** and Aardwolf API
Core **0.4.0**. Install the library and Core first, then
[`dist/plugins/aardwolf-inventory.lua`](../dist/plugins/aardwolf-inventory.lua).
It needs no Python process or File System Access. An older Core can provide
basic inventory data and original actions; unsupported held-item and use actions
show an upgrade explanation.

## Summary and manager

The summary is a normal dockable MudForge widget. It shows the number of items
directly in carried inventory, including storage bags themselves. Worn equipment
and bag contents are excluded. Unknown or stale data is labeled rather than
presented as a fresh count.

The bag list contains discovered storage containers, with their location shown;
worn bags are included by default. Drink containers remain a separate item type.
No background scan opens every bag. Double-click a bag, or focus it and press
Enter, to open its contents in the floating manager. **Manage Inventory** opens
that same manager on main inventory. **Setup** opens the floating settings
window, and **Refresh** requests current data.

The manager can switch between Inventory, Equipment and discovered bags. Search
filters item names; the table sorts by name, level, type, flags or object ID.
Selecting an item makes its actions available. Item details load explicitly from
tagged `invdetails` output. An unopened bag is unknown; an empty bag is shown as
empty only after a complete listing. Partial, loading and stale states remain
visible.

MudForge saves each widget's placement, size and visibility. Setup and the
manager float initially, and subsequent player layout choices are respected.
Ordinary inventory updates preserve selection, scroll, focus and unfinished
settings forms. A character change invalidates the previous character's context.

## Item actions

Right-click an item to select it and open MudForge's context menu. The **Actions**
button and keyboard menu access provide the same choices. Depending on the
selected item's type and location, the menu offers:

- Open container and view tagged item details.
- Get from bag, Put into bag, Wear, Hold and Remove.
- Give, Drop, Sell and Donate.
- Quaff potion, Eat food/pill, Drink, Recite scroll, Zap wand and Brandish staff.

Unavailable actions explain the missing requirement. Destination bags and
recipients use validated controls; commands target object IDs rather than item
names. Drop, Sell and Donate ask for confirmation by default. The plugin never
removes an item's keep protection automatically. Server restrictions, skills,
item flags, shop availability and other game conditions still determine success.

Sacrifice is absent from carried-item actions: Aardwolf sacrifices ground
objects, and this plugin does not drop an item as a hidden prerequisite.
See [Aardwolf Sacrifice help](https://www.aardwolf.com/wiki/index.php/Help/Sacrifice).

### Prepared use and restoration

The plugin shows the preparation steps before starting a use action. A bagged
item is retrieved first. Wands and staves must be held before `zap` or
`brandish`; scrolls use `recite` from inventory. See Aardwolf's
[Recite](https://www.aardwolf.com/wiki/index.php/Help/Recite),
[Zap](https://www.aardwolf.com/wiki/index.php/Help/Zap) and
[Brandish](https://www.aardwolf.com/wiki/index.php/Help/Brandish) help.

For wand/staff preparation, first identify your character's held slot in Setup.
Select the item you currently hold, or enter its slot number (0–255) from `wearable`.
Do not assume every character or race uses the same slot number. Items equipped
outside the configured held slot must be removed explicitly before prepared use.

A prepared-use workflow records the previous held item and the selected item's
original bag. It waits for observed inventory/equipment changes between steps,
dispatches the use command, then restores previous held equipment and returns
surviving retrieved items to their original bags. Consumed items cannot be
returned. Only one workflow runs at a time.

Cancel stops further forward steps. Failures and timeouts stop the workflow;
restoration proceeds only while the same character remains connected and the
required state is trustworthy. Missing items, disconnected sessions or failed
restoration leave visible recovery guidance. Independent safe restoration steps
can still complete when another destination is unavailable. If an item has been
moved manually, the plugin leaves that new placement alone and reports the
changed arrangement instead of claiming full restoration. Commands are never
retried automatically, and no pending workflow resumes after reconnect or reload.
"Sent" means command dispatch, not proof that a spell or server action succeeded.

## Quick Heal and Mana potions

Setup's **Quick potions** section saves separate choices for the summary's
**Heal** and **Mana** buttons per character. Each choice has a case-insensitive
literal potion-name substring and an **Also search bag** dropdown. Choose
**Inventory only** to omit the fallback bag. Matching is restricted to potions;
the substring does not interpret Lua patterns or regular expressions. An empty
name disables that button, and existing profiles start unconfigured.

Each summary button uses one matching potion per click without opening the manager
or a confirmation dialog. It prefers a loose inventory match; only when no loose
match exists does it search the configured bag. Within each location, the first
match in server listing order wins. No other bag is searched. An unavailable bag
or no matching potion produces feedback without substituting another item.

If carried inventory or the configured bag is unknown or stale, that explicit
click requests the required fresh listing before selecting an item. It does not
start a background scan or periodic refresh. Capability-checked potion retrieval,
quaffing and the reads needed to verify/restore the item are allowed during
combat; ordinary management and wand/staff workflows keep their existing
restrictions. A second click while work is pending does not queue another use.

The workflow waits for observed retrieval before quaffing, sends at most one
quaff command, and returns a surviving retrieved potion to its original bag. It
never retries gameplay commands automatically or removes keep protection. A
refused command, cancellation, disconnect or identity change stops forward work
and reports any restoration that could not be completed.

## Setup and Organize

Setup saves font size, bag visibility/order and disposal-confirmation preferences
in native plugin/world storage. Rules, quick potion choices and held-slot
configuration are specific to the identified character. Inventory snapshots and
pending workflows are never
persisted. A failed settings save is shown and does not claim persistence. Widget array
indexes are normalized before validation, preserving bag and rule order. Save
errors distinguish invalid preferences, invalid character settings, a changed
character and a running workflow.

Setup supports up to 64 sorting rules. Each rule has an enabled state, an item type
(or Any type), an optional name substring
and a destination bag. Name matching is case-insensitive and literal; it is not
a regular expression or Lua pattern. Rules run in their saved order, and the
first match wins. Rules target bag object IDs; a missing bag stays unresolved
rather than silently matching another bag with the same name.

**Organize** builds a preview from fresh loose inventory. It skips storage
containers, equipped items, existing bag contents and unmatched items. Review
the preview and start explicitly. The plugin moves one item at a time and
observes the expected destination before continuing. A full/missing bag, refused
move, timeout or cancellation stops the remaining moves. Sorting never runs on
login, loot, refresh or a timer.

## Terminal commands

| Command | Purpose |
| --- | --- |
| `awinventory show` | Reopen the summary. |
| `awinventory manage` | Open the manager on main inventory. |
| `awinventory setup` | Open settings. |
| `awinventory refresh` | Refresh carried inventory and equipment. |
| `awinventory status` | Report inventory/workflow status and feedback. |

## Timeout troubleshooting

Library 0.8.1 identifies the timed-out command (`invdata`, `eqdata`,
`invdata <bag-id>` or `invdetails <item-id>`) and whether its opening tag was
received. It tolerates whitespace around standalone tags while preserving item
names and detail values. After the expected closing tag drains an interrupted
reply, the obsolete waiting error clears; the affected cached listing stays stale
until explicitly refreshed. No gameplay command is retried automatically.

Library 0.8.2 also releases collection when a matching closing tag crosses the
frame size limit: the oversized listing fails without waiting for a second tag.

If the expected tag never arrives, reconnect to reset collection, then run
`awinventory refresh`. If the timeout recurs, retain the complete message and
that command's tagged output. Update the loaded `aardwolf-api` library as well
as Inventory Management, and reload Core so it uses the new collector.

## Verification boundary

Repository tests use injected host fixtures and Fengari, which do not execute
MudForge's JavaScript transpiler, native widgets, persistence engine or network
transport. Browser rendering with a simulated widget bridge does not establish
native context-menu delivery or docking. Native disposable-world checks and live
Aardwolf acceptance are tracked separately in the
[acceptance checklist](NATIVE-ACCEPTANCE.md#inventory-management-plugin--pending).
