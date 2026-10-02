import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Layout.js" as Logic

Panel {
  id: root
  moduleName: "io.github.badr-emil.display-layout"
  ipcTarget: "io.github.badr-emil.display-layout"

  // `live` is what Hyprland uses right now, `arrangement` is what the canvas
  // shows. They differ while the user has moved tiles without applying.
  property var live: []
  property var arrangement: []
  property string monitorsJson: ""
  property string configText: ""
  property int selected: 0
  property string lastSide: ""
  property int alignIndex: 0
  property string error: ""
  property bool identifying: false

  readonly property var alignments: ["center", "start", "end"]
  readonly property var workspaceNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  readonly property var rotations: ["", "rotated 90°", "upside down", "rotated 270°"]
  readonly property bool pinWorkspaces: setting("pinWorkspaces", true) !== false
  readonly property bool changed: !Logic.sameLayout(arrangement, live)
  readonly property bool saved: Logic.isSaved(configText, live, pinWorkspaces)
  readonly property bool busy: applyProcess.running || saveProcess.running
  readonly property var current: arrangement[selected] || null

  readonly property string pluginPath: decodeURIComponent(
    Qt.resolvedUrl(".").toString().replace(/^file:\/\//, "")
  )
  readonly property string configPath: (Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config")
    + "/hypr/monitors.lua"
  readonly property bool hideWithOneDisplay: setting("hideWithOneDisplay", false) === true

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property string statusText: {
    if (arrangement.length === 0) return "No displays"
    if (changed) return "Not applied yet"
    if (!saved) return "Applied · not saved"
    return "Saved"
  }

  readonly property string currentTitle: {
    var m = current
    if (!m) return ""
    var label = /^(eDP|LVDS|DSI)/.test(m.name) ? "Built-in display" : m.model !== "" ? m.model : m.description
    return labelOf(selected) + " · " + m.name + (label !== "" ? " · " + label : "")
  }

  readonly property string currentDetails: {
    var m = current
    if (!m) return ""
    return m.width + "×" + m.height + " @ " + Math.round(m.refreshRate) + " Hz"
      + (m.scale !== 1 ? " · scale " + m.scale : "")
      + (m.transform ? " · " + rotations[m.transform % 4] : "")
      + " · at " + m.x + "×" + m.y
  }

  function refresh() {
    if (!monitorsProcess.running) monitorsProcess.running = true
    configFile.reload()
  }

  // Edits that are not applied yet survive a refresh, anything else follows
  // what Hyprland reports.
  function rebuild(rulesJson) {
    var hadEdits = changed
    var parsed = Logic.parseMonitors(monitorsJson)
    live = pinWorkspaces ? Logic.withPinned(parsed, rulesJson) : parsed
    if (!hadEdits || arrangement.length !== live.length) arrangement = Logic.copy(live)
    selected = Math.max(0, Math.min(selected, arrangement.length - 1))
  }

  // The number a display goes by: its workspace, or its position in the list
  // when workspace numbers are not managed here.
  function labelOf(index) {
    var m = arrangement[index]
    if (!m) return ""
    return pinWorkspaces && m.workspace > 0 ? String(m.workspace) : String(index + 1)
  }

  function select(index) {
    if (index < 0 || index >= arrangement.length) return
    selected = index
    lastSide = ""
  }

  function selectLabel(label) {
    for (var i = 0; i < arrangement.length; i++) if (labelOf(i) === label) return select(i)
  }

  function setWorkspace(number) {
    if (!pinWorkspaces || !current || number < 1 || number > workspaceNumbers.length) return
    arrangement = Logic.assignWorkspace(arrangement, selected, number)
  }

  function rotate() {
    if (!current) return
    lastSide = ""
    arrangement = Logic.rotate(arrangement, selected)
  }

  // Arrow keys and the side buttons: the first press moves the selected
  // display to that side, repeated presses walk it along the edge.
  function moveTo(side) {
    if (arrangement.length < 2 || !current) return
    alignIndex = side === lastSide ? (alignIndex + 1) % alignments.length : 0
    lastSide = side
    arrangement = Logic.place(arrangement, selected, side, alignments[alignIndex])
  }

  function lineUp() {
    lastSide = ""
    arrangement = Logic.row(arrangement, "center")
  }

  function discard() {
    lastSide = ""
    arrangement = Logic.copy(live)
  }

  // Live only: Hyprland forgets this on the next reload until it is saved.
  function apply() {
    if (busy || arrangement.length === 0) return
    error = ""
    applyProcess.command = ["hyprctl", "eval", Logic.liveScript(configText, arrangement, live, pinWorkspaces)]
    applyProcess.running = true
  }

  function save() {
    if (busy || arrangement.length === 0) return
    error = ""
    saveProcess.command = [
      pluginPath + "scripts/save-layout",
      Logic.updateConfig(configText, arrangement, pinWorkspaces),
      pinWorkspaces ? Logic.workspaceMoves(arrangement, live) : ""
    ]
    saveProcess.running = true
  }

  function identify() {
    identifying = true
    identifyTimer.restart()
  }

  function labelOfScreen(name) {
    for (var i = 0; i < arrangement.length; i++) if (arrangement[i].name === name) return labelOf(i)
    return ""
  }

  onOpenedChanged: {
    if (opened) {
      error = ""
      lastSide = ""
      arrangement = Logic.copy(live)
      refresh()
    }
  }

  visible: !hideWithOneDisplay || Quickshell.screens.length > 1
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Process {
    id: monitorsProcess
    command: ["hyprctl", "monitors", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.monitorsJson = text
        if (root.pinWorkspaces) rulesProcess.running = true
        else root.rebuild("")
      }
    }
  }

  Process {
    id: rulesProcess
    command: ["hyprctl", "workspacerules", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.rebuild(text)
    }
  }

  Process {
    id: applyProcess
    // hyprctl reports a rejected eval on stdout
    stdout: StdioCollector { id: applyOutput; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.error = String(applyOutput.text).trim() || "Hyprland did not accept the layout"
      settleTimer.restart()
    }
  }

  Process {
    id: saveProcess
    stderr: StdioCollector { id: saveErrors; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.error = String(saveErrors.text).trim() || "Could not save monitors.lua"
      settleTimer.restart()
    }
  }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.configText = text()
    onLoadFailed: root.configText = ""
  }

  // Hyprland needs a moment to move the outputs before it reports them
  Timer {
    id: settleTimer
    interval: 350
    onTriggered: root.refresh()
  }

  Timer {
    id: identifyTimer
    interval: 2500
    onTriggered: root.identifying = false
  }

  // ---------- Number badges on the real screens ----------
  Variants {
    model: root.identifying ? Quickshell.screens : []

    PanelWindow {
      id: badge
      required property var modelData
      readonly property string label: root.labelOfScreen(modelData.name)

      screen: modelData
      visible: label !== ""
      anchors { top: true; left: true }
      margins { top: Style.space(48); left: Style.space(48) }
      implicitWidth: badgeCard.width
      implicitHeight: badgeCard.height
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "omarchy-display-layout"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      mask: Region {}

      Rectangle {
        id: badgeCard
        width: badgeColumn.implicitWidth + Style.space(56)
        height: badgeColumn.implicitHeight + Style.space(32)
        radius: Style.cornerRadius
        color: Util.alpha(Color.background, 0.95)
        border.width: Math.max(1, Style.space(2))
        border.color: Color.accent

        Column {
          id: badgeColumn
          anchors.centerIn: parent
          spacing: Style.space(4)

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: badge.label
            color: Color.accent
            font.family: root.fontFamily
            font.pixelSize: Style.font.displayLarge * 3
            font.bold: true
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            textFormat: Text.PlainText
            text: badge.modelData.name
            color: Color.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
          }
        }
      }
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰕮"
    tooltipText: root.opened ? "" : "Display layout"
    onPressed: function(b) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(460))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        root.moveTo(dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "top" : "bottom")
      }
      onActivateRequested: {
        if (root.changed) root.apply()
        else if (!root.saved) root.save()
      }
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if (text >= "0" && text <= "9") root.selectLabel(text === "0" ? "10" : text)
        else if (text === "+") root.setWorkspace(root.current ? root.current.workspace + 1 : 0)
        else if (text === "-") root.setWorkspace(root.current ? root.current.workspace - 1 : 0)
        else if (text === "t") root.rotate()
        else if (text === "i") root.identify()
        else if (text === "r") root.lineUp()
        else if (text === "u") root.discard()
      }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(12)

        // ---------- Hero: icon · title/status · actions ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight)

          Text {
            id: heroIcon
            textFormat: Text.PlainText
            text: "󰕮"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: heroActions.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "Display Layout"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            Text {
              textFormat: Text.PlainText
              text: root.statusText.toUpperCase()
              color: root.changed ? root.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }

          Row {
            id: heroActions
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(4)

            PanelActionButton {
              iconText: "󰎠"
              tooltipText: "Show each display's number on its screen (i)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.identify()
            }

            PanelActionButton {
              visible: root.arrangement.length > 1
              iconText: "󰡎"
              tooltipText: "Line all displays up in a row (r)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.lineUp()
            }

            PanelActionButton {
              enabled: root.changed
              opacity: enabled ? 1 : 0.35
              iconText: "󰕌"
              tooltipText: "Undo the changes that are not applied (u)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.discard()
            }
          }
        }

        // ---------- Canvas ----------
        Rectangle {
          id: canvas
          width: parent.width
          height: Style.space(190)
          radius: Style.cornerRadius
          color: Util.alpha(root.foreground, 0.04)
          border.width: 1
          border.color: Util.alpha(root.foreground, 0.12)
          clip: true

          // The view only follows the committed arrangement, so the scale
          // stays put while a tile is being dragged around.
          readonly property var box: Logic.bounds(root.arrangement)
          readonly property real k: Math.min(width * 0.9 / box.w, height * 0.7 / box.h)
          readonly property real ox: (width - box.w * k) / 2 - box.x * k
          readonly property real oy: (height - box.h * k) / 2 - box.y * k

          Repeater {
            model: root.arrangement.length

            Rectangle {
              id: tile
              required property int index
              readonly property var m: root.arrangement[index] || ({ x: 0, y: 0, w: 1, h: 1, name: "" })
              readonly property bool isSelected: root.selected === index
              property bool dragging: false
              property real dragX: 0
              property real dragY: 0
              property real dropX: 0
              property real dropY: 0

              x: dragging ? dragX : canvas.ox + m.x * canvas.k
              y: dragging ? dragY : canvas.oy + m.y * canvas.k
              width: m.w * canvas.k
              height: m.h * canvas.k
              z: dragging ? 2 : isSelected ? 1 : 0
              radius: Math.min(Style.cornerRadius, Style.space(4))
              color: isSelected ? Style.selectedAccentFill : Util.alpha(root.foreground, grab.containsMouse ? 0.14 : 0.08)
              border.width: isSelected ? 2 : 1
              border.color: isSelected ? Color.accent : Util.alpha(root.foreground, 0.4)

              Behavior on x { enabled: !tile.dragging; NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
              Behavior on y { enabled: !tile.dragging; NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }

              Column {
                anchors.centerIn: parent
                width: parent.width - Style.space(6)
                spacing: Style.space(1)

                Text {
                  width: parent.width
                  horizontalAlignment: Text.AlignHCenter
                  text: root.labelOf(tile.index)
                  color: tile.isSelected ? Color.accent : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                }

                Text {
                  width: parent.width
                  visible: tile.height > Style.space(34) && tile.width > Style.space(56)
                  horizontalAlignment: Text.AlignHCenter
                  textFormat: Text.PlainText
                  text: tile.m.name
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                }
              }

              MouseArea {
                id: grab
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                property real grabX: 0
                property real grabY: 0
                property bool moved: false

                onPressed: function(mouse) {
                  root.select(tile.index)
                  var p = mapToItem(canvas, mouse.x, mouse.y)
                  grabX = p.x - tile.x
                  grabY = p.y - tile.y
                  moved = false
                }

                onPositionChanged: function(mouse) {
                  if (!pressed) return
                  var p = mapToItem(canvas, mouse.x, mouse.y)
                  var px = p.x - grabX
                  var py = p.y - grabY
                  if (!moved && Math.abs(px - tile.x) + Math.abs(py - tile.y) < Style.space(4)) return

                  var spot = Logic.snap(
                    root.arrangement, tile.index,
                    (px - canvas.ox) / canvas.k, (py - canvas.oy) / canvas.k,
                    Style.space(12) / canvas.k
                  )
                  tile.dropX = spot.x
                  tile.dropY = spot.y
                  tile.dragX = canvas.ox + spot.x * canvas.k
                  tile.dragY = canvas.oy + spot.y * canvas.k
                  tile.dragging = true
                  moved = true
                }

                onReleased: {
                  if (!moved) return
                  root.arrangement = Logic.move(root.arrangement, tile.index, tile.dropX, tile.dropY)
                  tile.dragging = false
                }

                onCanceled: tile.dragging = false
              }
            }
          }

          Text {
            anchors.centerIn: parent
            visible: root.arrangement.length === 0
            text: "No active display found"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }
        }

        // ---------- Selected display ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(currentLabels.implicitHeight, sideButtons.implicitHeight)
          visible: root.current !== null

          Column {
            id: currentLabels
            anchors.left: parent.left
            anchors.right: sideButtons.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(3)

            Text {
              width: parent.width
              textFormat: Text.PlainText
              text: root.currentTitle
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              font.bold: true
              elide: Text.ElideRight
            }

            Text {
              width: parent.width
              textFormat: Text.PlainText
              text: root.currentDetails
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }
          }

          Row {
            id: sideButtons
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(4)
            visible: root.arrangement.length > 1

            Repeater {
              model: [
                { side: "left", icon: "󰁍", tip: "Move to the left of the others" },
                { side: "top", icon: "󰁝", tip: "Move above the others" },
                { side: "bottom", icon: "󰁅", tip: "Move below the others" },
                { side: "right", icon: "󰁔", tip: "Move to the right of the others" }
              ]

              PanelActionButton {
                required property var modelData
                iconText: modelData.icon
                tooltipText: modelData.tip + "\nPress again to slide along the edge"
                foreground: root.foreground
                fontFamily: root.fontFamily
                bordered: true
                onClicked: root.moveTo(modelData.side)
              }
            }
          }
        }

        // ---------- Workspace number · rotation ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(numberRow.implicitHeight, rotateButton.implicitHeight)
          visible: root.current !== null

          Row {
            id: numberRow
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(3)
            visible: root.pinWorkspaces

            Repeater {
              model: root.workspaceNumbers

              Button {
                required property int modelData
                readonly property int owner: Logic.indexOfWorkspace(root.arrangement, modelData)
                text: modelData
                selected: root.current !== null && root.current.workspace === modelData
                opacity: selected || owner === -1 ? 1 : 0.55
                tooltipText: selected ? "This display shows workspace " + modelData
                  : owner === -1 ? "Show workspace " + modelData + " on this display"
                  : "Swap numbers with " + root.arrangement[owner].name
                foreground: root.foreground
                fontFamily: root.fontFamily
                fontSize: Style.font.bodySmall
                horizontalPadding: Style.space(7)
                verticalPadding: Style.space(4)
                onClicked: root.setWorkspace(modelData)
              }
            }
          }

          Button {
            id: rotateButton
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            iconText: "󰑧"
            text: "Rotate"
            tooltipText: "Turn this display by 90° (t)"
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            verticalPadding: Style.space(4)
            bordered: true
            onClicked: root.rotate()
          }
        }

        Text {
          width: parent.width
          visible: root.error !== ""
          textFormat: Text.PlainText
          text: root.error
          color: root.urgent
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.Wrap
          maximumLineCount: 4
          elide: Text.ElideRight
        }

        PanelSeparator { foreground: root.foreground }

        // ---------- Apply / Save ----------
        Row {
          width: parent.width
          spacing: Style.space(8)

          Button {
            width: (parent.width - parent.spacing) / 2
            enabled: root.changed && !root.busy
            opacity: enabled ? 1 : 0.4
            iconText: "󰄬"
            text: "Apply"
            tooltipText: "Try the layout now. It lasts until Hyprland reloads."
            foreground: root.foreground
            fontFamily: root.fontFamily
            bordered: true
            onClicked: root.apply()
          }

          Button {
            width: (parent.width - parent.spacing) / 2
            enabled: (root.changed || !root.saved) && !root.busy && root.arrangement.length > 0
            opacity: enabled ? 1 : 0.4
            iconText: "󰆓"
            text: "Save"
            tooltipText: "Write the layout to ~/.config/hypr/monitors.lua.\nThe previous file is kept as a backup."
            foreground: root.foreground
            fontFamily: root.fontFamily
            bordered: true
            onClicked: root.save()
          }
        }

        Text {
          width: parent.width
          text: root.pinWorkspaces
            ? "Drag a display · arrows move · t rotate · + − number · Enter apply"
            : "Drag a display · 1–9 select · arrows move · t rotate · Enter apply"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
        }
      }
    }
  }
}
