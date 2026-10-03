# AGENTS.md

Guidance for AI agents working in this repository. The README documents *what*
the plugin does; this file records *how* to change it without breaking it.

## What this is

An Omarchy shell plugin (Quickshell/QML, kind `service`, id
`saigkill.missed-shortcuts`) plus a Lua hook for Hyprland's config
(`hypr/missed-shortcuts.lua`). The hook records bindings and announces when one
fires; the service compares that with Hyprland's events and shows a tip.

## The rules that matter most

**Never read key presses.** The plugin learns only *that* a binding fired, via
the custom event the hook dispatches. No evdev, no libinput, no keylogger
fallback, not even optionally.

**The hook must never break a binding.** It runs inside the user's
`hyprland.lua` before Omarchy's defaults. Every wrapped `hl.bind` falls back to
the original call if wrapping fails, and the user loads the hook with
`pcall(dofile, ...)`. Mouse bindings and key-forwarding dispatchers (`pass`,
`send_shortcut`, `send_key_state`, `window.drag`, `window.resize`) are passed
through unwrapped because they need the original key event.

**A false tip is worse than a missed one.** Only events whose cause can be told
apart reliably produce tips. Closing windows and fullscreen are excluded because
applications trigger them themselves. A new event type needs a test that shows
it stays silent when a shortcut, a new window or a monitor change explains it.

## Facts the design rests on (Hyprland 0.56, verified 2026-10-02)

- `hl.dsp.event("x")` produces `custom>>x` on `.socket2.sock`.
- `hl.timer(..., { timeout = 0 })` never fires; use 200 ms.
- Dispatcher objects are userdata (`HL.Dispatcher`); the hook tags them when
  they are created through `hl.dsp.*`, because they cannot be inspected later.
- Bindings pressed from a virtual keyboard (wtype) do not fire, so end-to-end
  tests need real key presses.
- The launcher is the layer `omarchy-menu`; selecting an app sends
  `closelayer>>omarchy-menu` before the app's `openwindow`.

## Before you change anything

```sh
node tests/test_model.js
```

It must be green before and after. All decisions live in `Model.js`, with no
shell, file or process access. `Service.qml` only wires events in and the tip out.

## Deploying to test

`~/.config/omarchy/plugins/saigkill.missed-shortcuts` is a symlink to this repo.

```sh
omarchy plugin validate .
hyprctl reload && hyprctl configerrors           # after changing the hook
OMARCHY_SHELL_IPC_TIMEOUT=15s omarchy-shell missed-shortcuts status
OMARCHY_SHELL_IPC_TIMEOUT=15s omarchy-shell missed-shortcuts test
journalctl --user --since "-2min" | grep -i missed
```

Never edit anything under `~/.local/share/omarchy/` or `/usr/share/omarchy/`.

## Conventions

2-space indent, no semicolons in QML/JS, `var` in functions, `root.` prefix.
Theme values from `qs.Commons`, components from `qs.Ui`. Code, comments and docs
in English. Bump `version` in `manifest.json` for user-visible changes.
