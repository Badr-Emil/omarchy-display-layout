# Display Layout for Omarchy

Bar widget for arranging your displays. Every connected display is a tile; drag the tiles to where the screens stand on your desk.

![Display Layout panel](preview.png)

- **Drag and snap**: tiles snap to the edges and centres of their neighbours
- **Always a usable layout**: a tile dropped on top of another one, or away from all of them, slides to the nearest free edge. No gaps the pointer gets stuck at, no overlapping screens, and the layout always starts at `0x0`
- **Numbers on the screens**: the `123` button shows each display's number on the real screen
- **Line up**: one click puts all displays in a row, in their current order
- **Apply**: try the layout right away, without touching any file
- **Save**: write it to `~/.config/hypr/monitors.lua` so it survives a restart

Keyboard: `1`–`9` select a display, the arrow keys (or `h j k l`) move it to that side of the others, pressing the same arrow again slides it along the edge. `Enter` applies, `i` shows the numbers, `r` lines up, `u` undoes changes that are not applied yet.

## Install

```bash
omarchy plugin add https://github.com/Badr-Emil/omarchy-display-layout --enable
```

Requires Omarchy with the Lua Hyprland config (`~/.config/hypr/monitors.lua`). `hyprctl` is the only external command used and ships with Omarchy.

## What Save changes

Nothing is written until you press **Save**. Save then edits `~/.config/hypr/monitors.lua`:

- An existing `hl.monitor({ ... })` rule for a display only gets its `position` replaced. Mode, scale and every other line of the file stay as they are
- A display without a rule gets one appended at the end, with its current mode and scale. External displays are matched by description (`desc:...`), because connector names such as `DP-3` change between plugs on docks; built-in panels and identical twin displays keep the connector name
- The previous file is kept next to it as `monitors.lua.display-layout-<time>.bak` (the newest five)
- If Hyprland reports a config error afterwards, the previous file is put back

**Apply** changes the running session only (`hyprctl eval`) and is undone by the next Hyprland reload. Hyprland restarts the bar on every display that moves, so the panel closes when you apply or save; open it again to continue.

Only positions are handled. Resolution, scale and rotation stay with Omarchy's own Display panel or your `monitors.lua`. Disabled and mirrored displays are not shown.

## Settings

- `hideWithOneDisplay` (default false): only show the widget while more than one display is connected

## Privileges

Everything runs as your user. The panel calls `hyprctl monitors -j` and `hyprctl eval`; `scripts/save-layout` writes `monitors.lua` and calls `hyprctl reload`. Nothing runs as root, nothing is downloaded, and no service is installed.

## Development

```bash
node --test tests/
```

## Remove

```bash
omarchy plugin remove io.github.badr-emil.display-layout
```

Saved layouts stay in `monitors.lua`. Delete the `monitors.lua.display-layout-*.bak` files in `~/.config/hypr/` if you no longer want the backups.
