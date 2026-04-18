# csk — Claude Session Keeper

A background daemon that keeps your Claude Code session limit warm.  
You sit down to work — the limit is already reset and waiting.

---

## The Problem

Claude Code's usage limit resets **5 hours after your last session started**.  
If you used it briefly at 9am and come back at 5pm, you've already burned the window — you're waiting another 5 hours.

`csk` fixes this by automatically firing a tiny `claude -p "hi"` ping at a calculated time before you plan to work, so the 5-hour clock expires right as you sit down.

---

## How It Works

```
You want to work at 5:00 PM
  └─ csk pings at  12:00 PM  (5h lead)   ← starts 5hr clock
                   12:30 PM  (4.5h lead) ← safety net

By 5:00 PM → clock expired → fresh session ready
```

The daemon reads your exact reset time from Anthropic's OAuth usage API (the same token Claude Code already stores locally), so everything is based on real timestamps — no guessing.

---

## Install

**Requirements:** Node.js 16+, Claude Code CLI installed and logged in.

```bash
git clone https://github.com/baraakh30/claude-reset.git
cd claude-reset
npm install
npm link
```

This installs `csk` globally as a shell command.

---

## Quick Start

```bash
csk init                            # create ~/.csk/ with default config
csk config set target_time 17:00   # set when you plan to start working
csk reset-time                     # verify it can read your reset times
csk ping now                       # test a ping (safe, just says "hi")
csk start                          # start the daemon
```

---

## Commands

| Command | Description |
|---------|-------------|
| `csk start` | Start the background daemon |
| `csk stop` | Stop the daemon |
| `csk status` | Show daemon state, next ping, session usage |
| `csk info` | Full config + session limit details |
| `csk reset-time` | Fetch exact reset times from Anthropic's API |
| `csk ping now` | Fire a ping immediately (for testing) |
| `csk logs` | Tail the daemon log |
| `csk config set` | Interactive config wizard |
| `csk config set <key> <value>` | Set a single value (scriptable) |
| `csk config show` | Print current config as JSON |
| `csk init` | Initialize `~/.csk/` directory |

---

## Configuration

Run `csk config set` with no arguments for the interactive wizard.  
Or set values directly:

```bash
csk config set target_time 17:00
csk config set days mon-fri          # or: all, or: mon,wed,fri
csk config set pings '[{"lead_minutes":300},{"lead_minutes":270}]'
```

**config.json** lives at `~/.csk/config.json`:

```json
{
  "target_times": ["17:00"],
  "days": ["mon", "tue", "wed", "thu", "fri"],
  "pings": [
    { "lead_minutes": 300 },
    { "lead_minutes": 270 }
  ],
  "log_level": "info",
  "claude_path": "auto"
}
```

### Multiple target times

```bash
csk config set target_times '["09:00","17:00"]'
```

Schedules pings for both sessions. Space them at least 5 hours apart.

---

## Lead Time Strategy

`lead_minutes` controls how many minutes before your target each ping fires.

| Lead | Ping fires | Limit resets | Effect |
|------|-----------|-------------|--------|
| 300 (5h) | 12:00 PM | 5:00 PM | Reset exactly at target — start fresh |
| 240 (4h) | 1:00 PM | 6:00 PM | Reset 1h into your session — get 1h + full session (6h total) |
| 270 (4.5h) | 12:30 PM | 5:30 PM | Reset 30m in — useful safety net |

**The overlap trick:** if you set `lead_minutes` to less than 300, the reset happens *while you're already working*. You get that time before the reset plus a full fresh session after — effectively chaining two back-to-back.

For a 17:00 target with `lead_minutes: 240`:  
→ ping at 13:00 → reset at 18:00 → you work 17:00–18:00 (1h), reset kicks in, continue until 23:00. **6 hours total.**

---

## Smart Validation

`csk` warns you when a config won't work:

- **Ping fires before your limit resets** — tells you the earliest feasible target and gives you the exact command to fix it
- **Overnight ping (midnight–6am)** — your machine is probably asleep
- **Two targets less than 5h apart** — can't chain sessions that close
- **Lead > 10 hours** — likely a typo
- **Overlap strategy** — explains the 1h + full session benefit when lead < 300

Warnings appear after every `csk config set` and in `csk status`.

---

## Daemon

### macOS (launchd)
`csk start` installs a launchd agent at `~/Library/LaunchAgents/com.csk.daemon.plist` with `KeepAlive: true` — it auto-restarts if it crashes and survives reboots.

### Linux — systemd ⚠️ experimental
`csk start` writes a systemd user service to `~/.config/systemd/user/csk.service`, enables lingering so it survives logout, and starts it with `systemctl --user enable --now csk`. Falls back to a detached process if systemd is unavailable.

> Linux support is experimental. If you run into issues please open a GitHub issue.

---

## Files

```
~/.csk/
├── config.json      — your settings
├── state.json       — runtime state (last ping, usage, next ping)
├── daemon.pid       — PID of running daemon
└── logs/
    ├── csk.log      — daemon activity log
    └── pings.log    — per-ping record (time, result, response snippet)
```

---

## How Reset Time Is Detected

Three methods, tried in order:

1. **OAuth API** (primary) — reads the token Claude Code stores locally, calls `api.anthropic.com/api/oauth/usage`, gets exact UTC timestamps. Cached for 5 minutes.
2. **CLI error output** (reactive) — if a ping hits the limit, parses the reset time from the error message (e.g. `resets 12am (Asia/Hebron)`).
3. **`last_ping + 5h`** (fallback) — estimate only, shown with `~` in status.

---

## Recommendations

**For a standard workday (work at 9am and 5pm):**
```bash
csk config set target_times '["09:00","17:00"]'
csk config set pings '[{"lead_minutes":300},{"lead_minutes":270}]'
```

**For maximum daily usage (overlap strategy):**
```bash
csk config set target_times '["09:00","14:00","19:00"]'
csk config set pings '[{"lead_minutes":240},{"lead_minutes":210}]'
```
Pings fire at 05:00, 10:00, 15:00. Each session resets 1 hour in, giving you 1h + 5h = 6h per block, ~18 hours of usable time across the day.

**For weekend warriors:**
```bash
csk config set days all
```
