# Missed shortcuts

An Omarchy shell plugin that teaches you your own keyboard shortcuts. When you
do something the slow way and a shortcut would have done it, a small card shows
the shortcut for a few seconds.

It reacts to three things:

| You did | Tip |
|---|---|
| Opened an app from the launcher (SUPER + SPACE) | the shortcut that starts that app, e.g. SUPER + SHIFT + RETURN for the browser |
| Switched workspace without a shortcut, e.g. by clicking the bar | SUPER + 1 … 0 |
| Toggled a window between floating and tiling without a shortcut | SUPER + T |

It knows every binding: Omarchy's defaults and your own in
`~/.config/hypr/bindings.lua`. Changes take effect when Hyprland reloads its config.

## How it works

No key presses are read. Instead a small hook in Hyprland's Lua config wraps
every binding so that, when it fires, Hyprland announces it on its event socket
(`custom>>missedshortcuts>>fired>><id>`). The plugin listens to the same socket.
An action that arrives without such an announcement just before it was done by
other means, so the plugin looks up the binding that would have done it.

The hook also writes the list of all bindings with their keys, descriptions and
actions to `$XDG_RUNTIME_DIR/missed-shortcuts/bindings.json`.

Which window belongs to which launch shortcut is learned: when you start an app
by shortcut, the plugin remembers its window class
(`~/.local/state/saigkill.missed-shortcuts/learned.json`). Until then it falls
back to finding the window class in the command, which works for commands like
`uwsm-app -- typora`, but not for wrappers like `omarchy-launch-terminal`. So
an app you have never started by shortcut may not get a tip.

Tips are rate limited: at most one every 15 seconds, and the same tip at most
once every 30 minutes.

## Installation

1. Put the plugin in `~/.config/omarchy/plugins/saigkill.missed-shortcuts/`
   and enable it: `omarchy plugin enable saigkill.missed-shortcuts`.
2. Add the hook to `~/.config/hypr/hyprland.lua`, **before**
   `require("default.hypr.omarchy")`:

   ```lua
   pcall(dofile, os.getenv("HOME") .. "/.config/omarchy/plugins/saigkill.missed-shortcuts/hypr/missed-shortcuts.lua")
   ```

3. Check the config: `hyprctl reload && hyprctl configerrors`.

If the hook is missing, the plugin says so once in a notification and stays
quiet otherwise.

To remove it, delete that line and disable the plugin.

## Limits

- Only actions Hyprland can see. Shortcuts inside applications (Ctrl+C in the
  browser) are out of reach.
- Closing windows and fullscreen give no tips on purpose: applications do both
  themselves (quit, F11) all the time, and every one of those would trigger a
  tip.
- Mouse bindings (move/resize with SUPER + drag) and key-forwarding bindings are
  not wrapped, since they need the original key event.

## Try it

```sh
omarchy-shell missed-shortcuts test     # show a sample tip
omarchy-shell missed-shortcuts status   # bindings known, window classes learned
```

## Development

```sh
node tests/test_model.js
```

All decisions live in `Model.js` and are covered by the tests; see `AGENTS.md`.

## License

MIT
