# Preventio

Keep your computer awake — cross-platform, no Electron, and it can **auto-activate
while Claude Code is working** so long tasks never stall on a sleeping machine.

Preventio prevents your system from going to sleep during idle periods. You control
it from a menu-bar / system-tray toggle, from the command line, or hands-free via
Claude Code hooks. Under the hood it uses each OS's native sleep-inhibition
mechanism — no kernel hacks, no fake mouse jiggling.

| OS | Mechanism |
|----|-----------|
| macOS | `caffeinate` |
| Windows | `SetThreadExecutionState` (via PowerShell) |
| Linux | `systemd-inhibit` |

## Why

While Claude Code runs a long task there's no keyboard or mouse input, so the
machine hits its idle timer and sleeps mid-task. Preventio holds the system awake
for as long as Claude Code is active (including during long, input-less tool calls)
and releases it shortly after you're done.

## Requirements

- **Node.js ≥ 18** (you already have it if you run Claude Code)
- macOS, Windows, or Linux (Linux tray needs AppIndicator support; the daemon also
  runs headless without a tray — see [Linux / headless](#linux--headless))

## Install

```bash
npm install -g preventio
```

Or run without installing:

```bash
npx preventio <command>
```

To hack on it locally:

```bash
git clone https://github.com/Hikhakk/preventio.git
cd preventio
npm install      # builds automatically via the prepare script
npm link         # makes the `preventio` command available
```

## Usage

### Menu-bar / tray toggle

```bash
preventio start
```

This launches the daemon with a tray icon. Click it for:

- **Keep awake (manual)** — toggle staying awake on/off
- **Also keep screen on** — also prevent the display from sleeping (off by default)
- a status line showing whether you're awake and why
- **Quit**

To start it automatically at login, add `preventio start` to your OS login items
(macOS: System Settings → General → Login Items; Windows: Startup folder; Linux:
your desktop's autostart).

### Command line

```bash
preventio on               # keep awake now
preventio off              # allow sleep again
preventio status           # show current state
preventio keepdisplay on   # also keep the screen on
preventio keepdisplay off
```

`preventio on` / hooks auto-start a background daemon if one isn't already running,
so you don't have to keep a terminal open.

### Claude Code auto-keep-awake

Wire Preventio into Claude Code so your machine stays awake automatically whenever
Claude Code is working:

```bash
preventio install-hooks
```

This adds hooks to `~/.claude/settings.json` (merging with any existing hooks). From
then on:

- a Claude Code session keeps the machine awake while it's open,
- each tool call holds the machine awake for its whole duration (this is what saves
  you during a 20-minute build or test run with no input),
- the hold is released when the session ends or goes idle.

Remove them anytime:

```bash
preventio uninstall-hooks
```

## How it works

Preventio keeps a directory of **holds** at `~/.preventio/holds/`. Each hold is one
reason to stay awake — a manual toggle, an open Claude Code session, or an in-flight
tool call. A small background **daemon** watches that directory and keeps the OS
awake whenever at least one hold exists, using the native mechanism for your
platform. Manual holds last until you remove them; session holds expire after 30
minutes of silence (so a crashed or forgotten session can't keep you awake forever);
tool holds last for the length of the tool call.

## Linux / headless

The tray needs a desktop with AppIndicator/SNI support. On servers or minimal
setups, run the daemon without a tray:

```bash
preventio start --no-tray
```

Everything else (`on`, `off`, `status`, hooks) works the same.

## Uninstall

```bash
preventio uninstall-hooks   # remove Claude Code hooks
npm uninstall -g preventio
```

## License

MIT © Hikhakk
