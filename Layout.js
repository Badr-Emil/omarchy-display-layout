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

function samePositions(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].x !== b[i].x || a[i].y !== b[i].y) return false
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

// Walk the uncommented `hl.monitor({ ... })` calls of a monitors.lua.
function monitorBlocks(text) {
  var blocks = []
  var pattern = /hl\.monitor\s*\(\s*\{[^{}]*\}\s*\)/g
  var match
  while ((match = pattern.exec(text)) !== null) {
    var lineStart = text.lastIndexOf("\n", match.index) + 1
    if (text.slice(lineStart, match.index).indexOf("--") !== -1) continue

    var output = /output\s*=\s*(["'])(.*?)\1/.exec(match[0])
    if (!output) continue
    blocks.push({ start: match.index, text: match[0], output: output[2] })
  }
  return blocks
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

// True when monitors.lua already stores exactly these positions.
function isSaved(text, monitors) {
  var blocks = monitorBlocks(String(text || ""))
  for (var i = 0; i < monitors.length; i++) {
    var block = blockFor(blocks, monitors[i])
    var position = block ? POSITION_FIELD.exec(block.text) : null
    if (!position || position[2] !== positionString(monitors[i])) return false
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

function withPosition(blockText, monitor) {
  var position = "position = " + luaString(positionString(monitor))
  return POSITION_FIELD.test(blockText)
    ? blockText.replace(POSITION_FIELD, position)
    : blockText.replace(/(output\s*=\s*(["']).*?\2)/, "$1, " + position)
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

// Re-applying a rule makes the bar on that output restart, so displays that
// stay where they are get left alone.
function isUnmoved(monitor, live) {
  if (!live) return false
  for (var i = 0; i < live.length; i++) {
    if (live[i].name === monitor.name) return live[i].x === monitor.x && live[i].y === monitor.y
  }
  return false
}

// Lua for `hyprctl eval` that moves the displays right away. Hyprland
// replaces the whole rule of an output, so the user's own rule is replayed
// with the new position to keep extras such as vrr or bitdepth.
function liveScript(text, monitors, live) {
  var blocks = monitorBlocks(String(text || ""))
  var statements = []
  for (var i = 0; i < monitors.length; i++) {
    if (isUnmoved(monitors[i], live)) continue
    var block = blockFor(blocks, monitors[i])
    statements.push(block && isSelfContained(block.text)
      ? withPosition(block.text, monitors[i]).replace(/\s+/g, " ")
      : newBlock(monitors[i], monitors[i].name))
  }
  return statements.join("\n")
}

// Return monitors.lua with the new positions. Existing rules only get their
// `position` replaced, so modes, scales and everything else in the file stay
// as the user wrote them. Displays without a rule get one appended.
function updateConfig(text, monitors) {
  var source = String(text || "")
  var blocks = monitorBlocks(source)
  var edits = []
  var missing = []

  for (var i = 0; i < monitors.length; i++) {
    var block = blockFor(blocks, monitors[i])
    if (!block) {
      missing.push(monitors[i])
      continue
    }
    edits.push({ start: block.start, length: block.text.length, text: withPosition(block.text, monitors[i]) })
  }

  edits.sort(function(a, b) { return b.start - a.start })
  for (var j = 0; j < edits.length; j++) {
    // Two connected displays can resolve to one rule; keep the first edit.
    if (j > 0 && edits[j].start === edits[j - 1].start) continue
    source = source.slice(0, edits[j].start) + edits[j].text + source.slice(edits[j].start + edits[j].length)
  }

  if (missing.length > 0) {
    if (source !== "" && !/\n$/.test(source)) source += "\n"
    if (source !== "") source += "\n"
    source += "-- Added by Display Layout\n"
    for (var k = 0; k < missing.length; k++) source += newBlock(missing[k], outputKey(missing[k], monitors)) + "\n"
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
    samePositions: samePositions,
    isSelfContained: isSelfContained,
    liveScript: liveScript,
    isSaved: isSaved,
    outputKey: outputKey,
    updateConfig: updateConfig
  }
}
