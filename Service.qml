import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Headless singleton plus the tip popup. Listens to Hyprland's event socket,
// asks Model.js whether an event was something a shortcut would have done, and
// shows the shortcut. The binding list and the "a shortcut just fired" signals
// come from hypr/missed-shortcuts.lua, which the user loads in hyprland.lua.
Item {
  id: root

  // Injected by the shell.
  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property string omarchyPath: ""

  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
  readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")) + "/saigkill.missed-shortcuts"

  property var bindings: []
  property var detector: Model.newState()
  property bool learnedLoaded: false

  // The tip on screen.
  property bool opened: false
  property var tipKeys: []
  property string tipText: ""
  readonly property int duration: 6000

  function showTip(binding) {
    root.tipKeys = Model.keyCaps(binding.keys)
    root.tipText = Model.tipText(binding)
    root.opened = true
    hideTimer.restart()
  }

  function onHyprlandEvent(name, data) {
    if (name === "custom" && data === "missedshortcuts>>registry") {
      registryFile.reload()
      return
    }
    var result = Model.handleEvent(root.detector, root.bindings, name, data, Date.now())
    if (result.learned) saveLearned()
    if (result.tip && Model.allowTip(root.detector, result.tip, Date.now())) showTip(result.tip)
  }

  function saveLearned() {
    if (!root.learnedLoaded) return
    learnedFile.setText(JSON.stringify(root.detector.learned, null, 2) + "\n")
  }

  Component.onCompleted: Quickshell.execDetached(["mkdir", "-p", root.stateDir])

  Connections {
    target: Hyprland
    function onRawEvent(event) { root.onHyprlandEvent(event.name, event.data) }
  }

  FileView {
    id: registryFile
    path: root.runtimeDir + "/missed-shortcuts/bindings.json"
    printErrors: false
    onLoaded: root.bindings = Model.parseBindings(text())
    onLoadFailed: root.bindings = []
  }

  FileView {
    id: learnedFile
    path: root.stateDir + "/learned.json"
    printErrors: false
    onLoaded: {
      try {
        var learned = JSON.parse(text() || "{}")
        if (learned && typeof learned === "object") root.detector.learned = learned
      } catch (e) {}
      root.learnedLoaded = true
    }
    onLoadFailed: root.learnedLoaded = true
  }

  // Without the Hyprland hook there is nothing to compare against. Say so once.
  Timer {
    interval: 10000
    running: true
    onTriggered: {
      if (root.bindings.length > 0) return
      Quickshell.execDetached(["omarchy-notification-send", "-g", "󰌌", "Missed shortcuts",
        "The Hyprland hook is not loaded, so no tips can be shown. See the plugin README for the line to add to ~/.config/hypr/hyprland.lua."])
    }
  }

  Timer {
    id: hideTimer
    interval: root.duration
    onTriggered: root.opened = false
  }

  IpcHandler {
    target: "missed-shortcuts"
    function test(): string {
      root.showTip({ keys: "SUPER + SHIFT + RETURN", description: "Browser" })
      return "ok"
    }
    function status(): string {
      return JSON.stringify({ bindings: root.bindings.length, learned: Object.keys(root.detector.learned).length })
    }
  }

  PanelWindow {
    visible: root.opened || card.opacity > 0
    screen: {
      var monitor = Hyprland.focusedMonitor
      var screens = Quickshell.screens
      for (var i = 0; i < screens.length; i++) if (monitor && screens[i].name === monitor.name) return screens[i]
      return screens.length > 0 ? screens[0] : null
    }
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "saigkill-missed-shortcuts"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    // Visual only: never block clicks.
    mask: Region {}

    BorderSurface {
      id: card
      readonly property int pad: Style.space(16)
      width: card.borderLeft + card.pad + content.implicitWidth + card.pad + card.borderRight
      height: card.borderTop + card.pad + content.implicitHeight + card.pad + card.borderBottom
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: Style.space(150)
      color: Util.alpha(Color.background, 0.97)
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
      radius: Style.cornerRadius
      opacity: root.opened ? 1 : 0
      Behavior on opacity { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

      Column {
        id: content
        x: card.borderLeft + card.pad
        y: card.borderTop + card.pad
        spacing: Style.space(10)

        Text {
          textFormat: Text.PlainText
          text: "󰌌  There is a shortcut for that"
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          color: Util.alpha(Color.popups.text, 0.7)
        }

        Row {
          spacing: Style.space(12)

          Row {
            spacing: Style.space(6)
            anchors.verticalCenter: parent.verticalCenter
            Repeater {
              model: root.tipKeys
              Rectangle {
                required property string modelData
                width: keyLabel.implicitWidth + Style.space(16)
                height: keyLabel.implicitHeight + Style.space(8)
                radius: Math.max(2, Style.cornerRadius / 2)
                color: Util.alpha(Color.popups.text, 0.08)
                border.width: Math.max(1, Style.space(1))
                border.color: Color.accent
                Text {
                  id: keyLabel
                  anchors.centerIn: parent
                  textFormat: Text.PlainText
                  text: modelData
                  font.family: Style.font.family
                  font.bold: true
                  font.pixelSize: Style.font.title
                  color: Color.popups.text
                }
              }
            }
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.tipText
            font.family: Style.font.family
            font.pixelSize: Style.font.title
            color: Color.popups.text
            elide: Text.ElideRight
            width: Math.min(implicitWidth, Style.space(320))
          }
        }
      }
    }
  }
}
