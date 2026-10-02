// Runs scripts/save-layout against a throwaway config dir and a fake hyprctl.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const script = path.join(__dirname, "..", "scripts", "save-layout")

function sandbox(configErrors) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "display-layout-"))
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(dir, "hypr"))
  fs.writeFileSync(
    path.join(bin, "hyprctl"),
    "#!/bin/bash\necho \"$1\" >>\"" + dir + "/calls\"\n[[ $1 == configerrors ]] && printf '%s' \"" + configErrors + "\"\nexit 0\n",
    { mode: 0o755 }
  )
  const run = content => spawnSync(script, content === undefined ? [] : [content], {
    env: { PATH: bin + ":" + process.env.PATH, XDG_CONFIG_HOME: dir, HOME: dir },
    encoding: "utf8"
  })
  const file = path.join(dir, "hypr", "monitors.lua")
  const backups = () => fs.readdirSync(path.join(dir, "hypr")).filter(f => f.endsWith(".bak"))
  return { dir, file, run, backups }
}

test("saves the layout and keeps the previous file as a backup", () => {
  const box = sandbox("")
  fs.writeFileSync(box.file, "old\n")
  const result = box.run("new\n")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(box.file, "utf8"), "new\n")
  assert.equal(box.backups().length, 1)
  assert.equal(fs.readFileSync(path.join(box.dir, "hypr", box.backups()[0]), "utf8"), "old\n")
  assert.equal(fs.readFileSync(path.join(box.dir, "calls"), "utf8"), "reload\nconfigerrors\n")
})

test("creates monitors.lua when there is none", () => {
  const box = sandbox("")
  assert.equal(box.run("new\n").status, 0)
  assert.equal(fs.readFileSync(box.file, "utf8"), "new\n")
  assert.equal(box.backups().length, 0)
})

test("puts the previous file back when Hyprland reports config errors", () => {
  const box = sandbox("monitors.lua:3: bad rule")
  fs.writeFileSync(box.file, "old\n")
  const result = box.run("broken\n")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /previous monitors.lua was restored/)
  assert.match(result.stderr, /bad rule/)
  assert.equal(fs.readFileSync(box.file, "utf8"), "old\n")
})

test("writes through a symlinked monitors.lua", () => {
  const box = sandbox("")
  const target = path.join(box.dir, "dotfiles-monitors.lua")
  fs.writeFileSync(target, "old\n")
  fs.symlinkSync(target, box.file)
  assert.equal(box.run("new\n").status, 0)
  assert.equal(fs.lstatSync(box.file).isSymbolicLink(), true)
  assert.equal(fs.readFileSync(target, "utf8"), "new\n")
})

test("refuses to write an empty layout", () => {
  const box = sandbox("")
  fs.writeFileSync(box.file, "old\n")
  assert.equal(box.run().status, 2)
  assert.equal(fs.readFileSync(box.file, "utf8"), "old\n")
})
