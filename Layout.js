// Geometry and config helpers for the display layout panel. Everything here
// works in Hyprland layout coordinates: logical pixels, i.e. the mode size
// divided by the scale, with width and height swapped on rotated outputs.

// Two displays count as neighbours only when they share at least this much
// of an edge, so the pointer always has room to cross between them.
var MIN_SHARED = 120

function logicalSize(width, height, scale, transform) {
  var s = Number(scale) > 0 ? Number(scale) : 1
  var w = Math.round(Number(width) / s)
  var h = Math.round(Number(height) / s)
  return Number(transform) % 2 === 1 ? { w: h, h: w } : { w: w, h: h }
}

function parseMonitors(raw) {
  var list = []
  try {
    list = raw ? JSON.parse(String(raw)) : []
  } catch (e) {
    list = []
  }
  if (!Array.isArray(list)) return []

  var monitors = []
  for (var i = 0; i < list.length; i++) {
    var m = list[i]
    if (!m || m.disabled === true) continue
    if (m.mirrorOf !== undefined && String(m.mirrorOf) !== "none") continue

    var size = logicalSize(m.width, m.height, m.scale, m.transform)
    monitors.push({
      name: String(m.name || ""),
      description: String(m.description || ""),
      model: String(m.model || ""),
      width: Number(m.width) || 0,
      height: Number(m.height) || 0,
      refreshRate: Number(m.refreshRate) || 0,
      scale: Number(m.scale) > 0 ? Number(m.scale) : 1,
      transform: Number(m.transform) || 0,
      focused: m.focused === true,
      // `active` is the workspace the display shows right now, `workspace`
      // the number the panel works with (see withPinned).
      active: m.activeWorkspace ? Number(m.activeWorkspace.id) || 0 : 0,
      workspace: m.activeWorkspace ? Number(m.activeWorkspace.id) || 0 : 0,
      x: Math.round(Number(m.x) || 0),
      y: Math.round(Number(m.y) || 0),
      w: size.w,
      h: size.h
    })
  }
  return monitors
}

function copy(monitors) {
  var out = []
  for (var i = 0; i < monitors.length; i++) {
    var c = {}
    for (var key in monitors[i]) c[key] = monitors[i][key]
    out.push(c)
  }
  return out
}

function bounds(rects) {
  if (!rects || rects.length === 0) return { x: 0, y: 0, w: 1, h: 1 }
  var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i]
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w)
    y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }
}

function span(a1, a2, b1, b2) {
  return Math.min(a2, b2) - Math.max(a1, b1)
}

function overlaps(a, b) {
  return span(a.x, a.x + a.w, b.x, b.x + b.w) > 0 && span(a.y, a.y + a.h, b.y, b.y + b.h) > 0
}

function touches(a, b) {
  var sideBySide = a.x + a.w === b.x || b.x + b.w === a.x
  var stacked = a.y + a.h === b.y || b.y + b.h === a.y
  return (sideBySide && span(a.y, a.y + a.h, b.y, b.y + b.h) > 0)
    || (stacked && span(a.x, a.x + a.w, b.x, b.x + b.w) > 0)
}

function clamp(value, low, high) {
  if (low > high) return Math.round((low + high) / 2)
  return Math.max(low, Math.min(high, value))
}

function others(rects, index) {
  var list = []
  for (var i = 0; i < rects.length; i++) if (i !== index) list.push(rects[i])
  return list
}

function nearest(value, candidates, threshold) {
  var best = value
  var bestDistance = threshold
  for (var i = 0; i < candidates.length; i++) {
    var distance = Math.abs(candidates[i] - value)
    if (distance <= bestDistance) {
      best = candidates[i]
      bestDistance = distance
    }
  }
  return best
}

// Pull a display that is being dragged onto the edges and centres of the
// others once it comes within `threshold` logical pixels of them.
function snap(rects, index, x, y, threshold) {
  var me = rects[index]
  var rest = others(rects, index)
  var xs = [], ys = []
  for (var i = 0; i < rest.length; i++) {
    var o = rest[i]
    xs.push(o.x - me.w, o.x + o.w, o.x, o.x + o.w - me.w, o.x + (o.w - me.w) / 2)
    ys.push(o.y - me.h, o.y + o.h, o.y, o.y + o.h - me.h, o.y + (o.h - me.h) / 2)
  }
  return { x: Math.round(nearest(x, xs, threshold)), y: Math.round(nearest(y, ys, threshold)) }
}

// Find the closest spot to (x, y) where the display sits flush against
// another one without covering any. Hyprland accepts gaps and overlaps, but
// both leave the pointer stuck or windows cut off.
function settle(rects, index, x, y) {
  var me = rects[index]
  var rest = others(rects, index)
  var wanted = { x: Math.round(x), y: Math.round(y), w: me.w, h: me.h }
  if (rest.length === 0) return { x: 0, y: 0 }

  function free(rect) {
    for (var i = 0; i < rest.length; i++) if (overlaps(rect, rest[i])) return false
    return true
  }

  function attached(rect) {
    for (var i = 0; i < rest.length; i++) if (touches(rect, rest[i])) return true
    return false
  }

  if (free(wanted) && attached(wanted)) return { x: wanted.x, y: wanted.y }

  var best = null
  var bestDistance = Infinity
  function consider(cx, cy) {
    var candidate = { x: Math.round(cx), y: Math.round(cy), w: me.w, h: me.h }
    if (!free(candidate)) return
    var distance = Math.pow(candidate.x - wanted.x, 2) + Math.pow(candidate.y - wanted.y, 2)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  for (var i = 0; i < rest.length; i++) {
    var o = rest[i]
    var sharedY = Math.min(MIN_SHARED, me.h, o.h)
    var sharedX = Math.min(MIN_SHARED, me.w, o.w)
    var cy = clamp(wanted.y, o.y - me.h + sharedY, o.y + o.h - sharedY)
    var cx = clamp(wanted.x, o.x - me.w + sharedX, o.x + o.w - sharedX)
    consider(o.x - me.w, cy)
    consider(o.x + o.w, cy)
    consider(cx, o.y - me.h)
    consider(cx, o.y + o.h)
  }

  return best ? { x: best.x, y: best.y } : { x: wanted.x, y: wanted.y }
}

// Shift the whole layout so its top-left corner is 0x0.
function normalize(rects) {
  var box = bounds(rects)
  var out = copy(rects)
  for (var i = 0; i < out.length; i++) {
    out[i].x = Math.round(out[i].x - box.x)
    out[i].y = Math.round(out[i].y - box.y)
  }
  return out
}

// Group the displays into islands of touching neighbours. Returns the island
// number of every display.
function islands(rects) {
  var island = []
  var count = 0
  for (var i = 0; i < rects.length; i++) island.push(-1)
  for (var start = 0; start < rects.length; start++) {
    if (island[start] !== -1) continue
    var queue = [start]
    island[start] = count
    while (queue.length > 0) {
      var a = queue.pop()
      for (var b = 0; b < rects.length; b++) {
        if (island[b] === -1 && touches(rects[a], rects[b])) {
          island[b] = count
          queue.push(b)
        }
      }
    }
    count++
  }
  return island
}

// Moving one display away can cut the others off from each other. Slide every
// cut-off island, as one piece, back against the island that holds `anchor`.
function connect(rects, anchor) {
  var out = copy(rects)

  for (var round = 0; round < out.length; round++) {
    var island = islands(out)
    var home = island[anchor] === undefined ? 0 : island[anchor]
    var stray = -1
    for (var i = 0; i < out.length; i++) if (island[i] !== home) { stray = island[i]; break }
    if (stray === -1) break

    var group = [], rest = [], main = []
    for (var j = 0; j < out.length; j++) {
      if (island[j] === stray) group.push(out[j])
      else rest.push(out[j])
      if (island[j] === home) main.push(out[j])
    }

    var best = null
    var bestDistance = Infinity
    function consider(dx, dy) {
      dx = Math.round(dx)
      dy = Math.round(dy)
      for (var g = 0; g < group.length; g++) {
        var shifted = { x: group[g].x + dx, y: group[g].y + dy, w: group[g].w, h: group[g].h }
        for (var r = 0; r < rest.length; r++) if (overlaps(shifted, rest[r])) return
      }
      var distance = dx * dx + dy * dy
      if (distance < bestDistance) {
        best = { dx: dx, dy: dy }
        bestDistance = distance
      }
    }

    for (var g = 0; g < group.length; g++) {
      var me = group[g]
      for (var m = 0; m < main.length; m++) {
        var o = main[m]
        var sharedY = Math.min(MIN_SHARED, me.h, o.h)
        var sharedX = Math.min(MIN_SHARED, me.w, o.w)
        var cy = clamp(me.y, o.y - me.h + sharedY, o.y + o.h - sharedY) - me.y
        var cx = clamp(me.x, o.x - me.w + sharedX, o.x + o.w - sharedX) - me.x
        consider(o.x - me.w - me.x, cy)
        consider(o.x + o.w - me.x, cy)
        consider(cx, o.y - me.h - me.y)
        consider(cx, o.y + o.h - me.y)
      }
    }

    if (!best) break
    for (var k = 0; k < group.length; k++) {
      group[k].x += best.dx
      group[k].y += best.dy
    }
  }
  return out
}

function move(rects, index, x, y) {
  var spot = settle(rects, index, x, y)
  var out = copy(rects)
  out[index].x = spot.x
  out[index].y = spot.y
  return normalize(connect(out, index))
}

// Put a display on one side of all the others. `align` is "start", "center"
// or "end" along that side.
function place(rects, index, side, align) {
  var me = rects[index]
  var box = bounds(others(rects, index))
  if (rects.length < 2) return normalize(rects)

  function along(start, length, size) {
    if (align === "start") return start
    if (align === "end") return start + length - size
    return start + (length - size) / 2
  }

  var x = me.x, y = me.y
  if (side === "left" || side === "right") {
    x = side === "left" ? box.x - me.w : box.x + box.w
    y = along(box.y, box.h, me.h)
  } else {
    y = side === "top" ? box.y - me.h : box.y + box.h
    x = along(box.x, box.w, me.w)
  }
  return move(rects, index, x, y)
}

// Line every display up side by side, keeping the current left-to-right order.
function row(rects, align) {
  var out = copy(rects)
  var order = []
  for (var i = 0; i < out.length; i++) order.push(i)
  order.sort(function(a, b) {
    return (out[a].x + out[a].w / 2) - (out[b].x + out[b].w / 2) || a - b
  })

  var tallest = 0
  for (var j = 0; j < out.length; j++) tallest = Math.max(tallest, out[j].h)

  var x = 0
  for (var k = 0; k < order.length; k++) {
    var r = out[order[k]]
    r.x = x
    r.y = align === "top" ? 0 : align === "bottom" ? tallest - r.h : Math.round((tallest - r.h) / 2)
    x += r.w
  }
  return normalize(out)
}

// Turn a display by 90° clockwise around its centre and tuck it back in.
function rotate(rects, index) {
  var out = copy(rects)
  var me = out[index]
  var cx = me.x + me.w / 2
  var cy = me.y + me.h / 2
  me.transform = (me.transform + 1) % 4
  var size = logicalSize(me.width, me.height, me.scale, me.transform)
  me.w = size.w
  me.h = size.h
  return move(out, index, cx - me.w / 2, cy - me.h / 2)
}

// Give a display a workspace number. A display that already has that number
// takes over the old one, so numbers stay unique.
function assignWorkspace(rects, index, number) {
  var out = copy(rects)
  var previous = out[index].workspace
  for (var i = 0; i < out.length; i++) {
    if (i !== index && out[i].workspace === number) out[i].workspace = previous
  }
  out[index].workspace = number
  return out
}

function indexOfWorkspace(rects, number) {
  for (var i = 0; i < rects.length; i++) if (rects[i].workspace === number) return i
  return -1
}

function sameLayout(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].x !== b[i].x || a[i].y !== b[i].y) return false
    if (a[i].transform !== b[i].transform || a[i].workspace !== b[i].workspace) return false
  }
  return true
}

function trimNumber(value, digits) {
  var factor = Math.pow(10, digits)
  return String(Math.round(Number(value) * factor) / factor)
}

function modeString(m) {
  return m.width + "x" + m.height + "@" + trimNumber(m.refreshRate, 3)
}

function positionString(m) {
  return m.x + "x" + m.y
}

function luaString(value) {
  return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
}

// Walk the uncommented `hl.<call>({ ... })` rules of a monitors.lua.
function ruleBlocks(text, call, keyField) {
  var blocks = []
  var pattern = new RegExp("hl\\." + call + "\\s*\\(\\s*\\{[^{}]*\\}\\s*\\)", "g")
  var key = new RegExp(keyField + "\\s*=\\s*([\"'])(.*?)\\1")
  var match
  while ((match = pattern.exec(text)) !== null) {
    var lineStart = text.lastIndexOf("\n", match.index) + 1
    if (text.slice(lineStart, match.index).indexOf("--") !== -1) continue

    var output = key.exec(match[0])
    if (!output) continue
    blocks.push({ start: match.index, text: match[0], output: output[2] })
  }
  return blocks
}

function monitorBlocks(text) {
  return ruleBlocks(text, "monitor", "output")
}

function blockMatches(output, monitor) {
  if (output === "") return false
  if (output === monitor.name) return true
  if (output.indexOf("desc:") !== 0) return false
  var description = output.slice(5)
  return description !== "" && monitor.description.indexOf(description) === 0
}

function blockFor(blocks, monitor) {
  // The last matching rule wins in Hyprland, so that is the one to read and edit.
  for (var i = blocks.length - 1; i >= 0; i--) {
    if (blockMatches(blocks[i].output, monitor)) return blocks[i]
  }
  return null
}

var POSITION_FIELD = /position\s*=\s*(["'])([^"']*)\1/
var TRANSFORM_FIELD = /transform\s*=\s*(\d+)/

// The workspace number monitors.lua pins to a display as its default, or 0.
function pinnedWorkspace(text, monitor) {
  var rules = ruleBlocks(String(text || ""), "workspace_rule", "monitor")
  for (var i = rules.length - 1; i >= 0; i--) {
    if (!blockMatches(rules[i].output, monitor) || !/default\s*=\s*true/.test(rules[i].text)) continue
    var workspace = /workspace\s*=\s*(["'])(\d+)\1/.exec(rules[i].text)
    if (workspace) return Number(workspace[2])
  }
  return 0
}

// A display normally shows its pinned workspace, but the user may be looking
// at another one right now. The panel works with the pinned number so that
// merely opening it never suggests a change. `raw` is the output of
// `hyprctl workspacerules -j`, which also knows rules applied but not saved.
function withPinned(monitors, raw) {
  var rules = []
  try {
    rules = raw ? JSON.parse(String(raw)) : []
  } catch (e) {
    rules = []
  }
  if (!Array.isArray(rules)) rules = []

  var out = copy(monitors)
  var taken = {}
  for (var i = 0; i < out.length; i++) {
    for (var j = rules.length - 1; j >= 0; j--) {
      var rule = rules[j]
      if (!rule || rule.default !== true || rule.enabled === false) continue
      if (!/^\d+$/.test(String(rule.workspaceString)) || !blockMatches(String(rule.monitor || ""), out[i])) continue
      var number = Number(rule.workspaceString)
      if (number > 0 && !taken[number]) {
        out[i].workspace = number
        taken[number] = true
      }
      break
    }
  }
  return out
}

// True when monitors.lua already stores exactly this layout.
function isSaved(text, monitors, workspaces) {
  var source = String(text || "")
  var blocks = monitorBlocks(source)
  for (var i = 0; i < monitors.length; i++) {
    var block = blockFor(blocks, monitors[i])
    var position = block ? POSITION_FIELD.exec(block.text) : null
    if (!position || position[2] !== positionString(monitors[i])) return false

    var transform = TRANSFORM_FIELD.exec(block.text)
    if ((transform ? Number(transform[1]) : 0) !== monitors[i].transform) return false

    if (workspaces && monitors[i].workspace > 0
        && pinnedWorkspace(source, monitors[i]) !== monitors[i].workspace) return false
  }
  return monitors.length > 0
}

// Displays behind a dock change connector names between plugs (DP-3 today,
// DP-5 tomorrow), so new rules for them are keyed by description when that
// description is unique. Built-in panels keep their stable connector name.
function outputKey(monitor, monitors) {
  if (/^(eDP|LVDS|DSI)/.test(monitor.name) || monitor.description === "") return monitor.name
  for (var i = 0; i < monitors.length; i++) {
    var other = monitors[i]
    if (other === monitor || other.name === monitor.name) continue
    if (other.description.indexOf(monitor.description) === 0) return monitor.name
  }
  return "desc:" + monitor.description
}

function newBlock(monitor, output) {
  var fields = [
    "output = " + luaString(output),
    "mode = " + luaString(modeString(monitor)),
    "position = " + luaString(positionString(monitor)),
    "scale = " + trimNumber(monitor.scale, 6)
  ]
  if (monitor.transform) fields.push("transform = " + monitor.transform)
  return "hl.monitor({ " + fields.join(", ") + " })"
}

// Put the display's position and rotation into an existing rule.
function withPlacement(blockText, monitor) {
  var position = "position = " + luaString(positionString(monitor))
  var updated = POSITION_FIELD.test(blockText)
    ? blockText.replace(POSITION_FIELD, position)
    : blockText.replace(/(output\s*=\s*(["']).*?\2)/, "$1, " + position)

  var transform = "transform = " + monitor.transform
  if (TRANSFORM_FIELD.test(updated)) return updated.replace(TRANSFORM_FIELD, transform)
  if (!monitor.transform) return updated
  return updated.replace(POSITION_FIELD, function(field) { return field + ", " + transform })
}

function workspaceRule(monitor, output) {
  return "hl.workspace_rule({ workspace = " + luaString(monitor.workspace)
    + ", monitor = " + luaString(output) + ", default = true })"
}

// A rule can be replayed outside its file only when every value is a plain
// string, number or boolean; anything else may be a local of monitors.lua.
function isSelfContained(blockText) {
  var body = blockText.replace(/^hl\.monitor/, "").replace(/(["'])(?:\\.|(?!\1).)*\1/g, "0")
  var values = body.replace(/[A-Za-z_]\w*\s*=(?!=)/g, "").split(/[\s,{}()]+/)
  for (var i = 0; i < values.length; i++) {
    if (values[i] !== "" && !/^(-?[\d.]+|true|false)$/.test(values[i])) return false
  }
  return true
}

function liveOf(monitor, live) {
  for (var i = 0; live && i < live.length; i++) if (live[i].name === monitor.name) return live[i]
  return null
}

// Re-applying a rule makes the bar on that output restart, so displays that
// stay where they are get left alone.
function isUnmoved(monitor, live) {
  var before = liveOf(monitor, live)
  return before !== null && before.x === monitor.x && before.y === monitor.y
    && before.transform === monitor.transform
}

// Lua that brings every renumbered display's workspace onto it. Moving fails
// for a workspace that does not exist yet; focusing it on the display then
// creates it there.
function workspaceMoves(monitors, live) {
  var statements = []
  var focused = 0
  for (var i = 0; i < monitors.length; i++) {
    var m = monitors[i]
    var before = liveOf(m, live)
    if (before && before.focused) focused = before.active
    if (m.workspace < 1 || (before && before.workspace === m.workspace)) continue

    var workspace = luaString(m.workspace)
    var monitor = luaString(m.name)
    statements.push(
      "pcall(function() hl.dispatch(hl.dsp.workspace.move({ workspace = " + workspace + ", monitor = " + monitor + " })) end)",
      "hl.dispatch(hl.dsp.focus({ monitor = " + monitor + " }))",
      "hl.dispatch(hl.dsp.focus({ workspace = " + workspace + " }))"
    )
  }
  // Leave the user on the workspace they were working in.
  if (statements.length > 0 && focused > 0) {
    statements.push("hl.dispatch(hl.dsp.focus({ workspace = " + luaString(focused) + " }))")
  }
  return statements.join("\n")
}

// Lua for `hyprctl eval` that applies the layout right away. Hyprland
// replaces the whole rule of an output, so the user's own rule is replayed
// with the new placement to keep extras such as vrr or bitdepth.
function liveScript(text, monitors, live, workspaces) {
  var blocks = monitorBlocks(String(text || ""))
  var statements = []
  for (var i = 0; i < monitors.length; i++) {
    if (isUnmoved(monitors[i], live)) continue
    var block = blockFor(blocks, monitors[i])
    statements.push(block && isSelfContained(block.text)
      ? withPlacement(block.text, monitors[i]).replace(/\s+/g, " ")
      : newBlock(monitors[i], monitors[i].name))
  }

  var moves = workspaces ? workspaceMoves(monitors, live) : ""
  if (moves !== "") {
    for (var j = 0; j < monitors.length; j++) {
      if (monitors[j].workspace > 0) statements.push(workspaceRule(monitors[j], monitors[j].name))
    }
    statements.push(moves)
  }
  return statements.join("\n")
}

var WORKSPACES_START = "-- Display Layout: workspace numbers (managed by the panel)"
var WORKSPACES_END = "-- Display Layout: end of workspace numbers"

function withoutWorkspaceBlock(source) {
  var start = source.indexOf(WORKSPACES_START)
  if (start === -1) return source
  var end = source.indexOf(WORKSPACES_END, start)
  if (end === -1) return source
  var before = source.slice(0, start).replace(/\n+$/, "\n")
  var after = source.slice(end + WORKSPACES_END.length).replace(/^\n+/, "")
  return before + (after !== "" && before !== "" ? "\n" : "") + after
}

// Return monitors.lua with the new layout. Existing rules only get their
// `position` and `transform` replaced, so modes, scales and everything else
// in the file stay as the user wrote them. Displays without a rule get one
// appended. With `workspaces`, the pinned workspace numbers are kept in a
// marked block at the end that is rewritten on every save.
function updateConfig(text, monitors, workspaces) {
  var source = withoutWorkspaceBlock(String(text || ""))
  var blocks = monitorBlocks(source)
  var edits = []
  var missing = []

  for (var i = 0; i < monitors.length; i++) {
    var block = blockFor(blocks, monitors[i])
    if (!block) {
      missing.push(monitors[i])
      continue
    }
    edits.push({ start: block.start, length: block.text.length, text: withPlacement(block.text, monitors[i]) })
  }

  edits.sort(function(a, b) { return b.start - a.start })
  for (var j = 0; j < edits.length; j++) {
    // Two connected displays can resolve to one rule; keep the first edit.
    if (j > 0 && edits[j].start === edits[j - 1].start) continue
    source = source.slice(0, edits[j].start) + edits[j].text + source.slice(edits[j].start + edits[j].length)
  }

  function section(lines) {
    if (source !== "" && !/\n$/.test(source)) source += "\n"
    if (source !== "") source += "\n"
    source += lines.join("\n") + "\n"
  }

  if (missing.length > 0) {
    var added = ["-- Added by Display Layout"]
    for (var k = 0; k < missing.length; k++) added.push(newBlock(missing[k], outputKey(missing[k], monitors)))
    section(added)
  }

  if (workspaces) {
    var rules = [WORKSPACES_START]
    for (var w = 0; w < monitors.length; w++) {
      if (monitors[w].workspace > 0) rules.push(workspaceRule(monitors[w], outputKey(monitors[w], monitors)))
    }
    rules.push(WORKSPACES_END)
    if (rules.length > 2) section(rules)
  }
  return source
}

if (typeof module !== "undefined") {
  module.exports = {
    MIN_SHARED: MIN_SHARED,
    logicalSize: logicalSize,
    parseMonitors: parseMonitors,
    bounds: bounds,
    overlaps: overlaps,
    touches: touches,
    snap: snap,
    settle: settle,
    normalize: normalize,
    islands: islands,
    connect: connect,
    move: move,
    place: place,
    row: row,
    rotate: rotate,
    assignWorkspace: assignWorkspace,
    indexOfWorkspace: indexOfWorkspace,
    sameLayout: sameLayout,
    pinnedWorkspace: pinnedWorkspace,
    withPinned: withPinned,
    isSelfContained: isSelfContained,
    workspaceMoves: workspaceMoves,
    liveScript: liveScript,
    isSaved: isSaved,
    outputKey: outputKey,
    updateConfig: updateConfig
  }
}
