# Claude Code Session Keeper — Plan

A background daemon that keeps your Claude Code session limit "warm" so when
you sit down to work, you're never waiting 5 hours for a reset.

---

## The Problem

Claude Code (Pro) has a shared session limit that resets **5 hours after your
last session started**. If you used it briefly at 9am and then come back at
5pm, your reset clock has long expired — but the new session you triggered at
9am already consumed some or all of your limit, and now you've triggered a
fresh 5-hour wait.

The fix: automatically trigger a tiny session (just `"hi"`) a calculated time
before you plan to work, so the reset clock is already counting down and by the
time you open your laptop, the limit is fresh (or very close to it).

---

## Core Concept

```
You want to work at 5:00 PM
  └─ Tool calculates:  5:00 PM  minus 4h 30m  = 12:30 PM  ← ping 1
                       5:00 PM  minus 5h 00m  = 12:00 PM  ← ping 2 (safety)
```

Two staggered pings ensure at least one "catches" the right window. By 5pm,
the 5-hour clock started at noon has expired → fresh session ready.

---

## Features

### Configuration
- **Target time** — when you plan to start working (e.g. `17:00`)
- **Lead time** — how far before your target the pings fire (default: 5h, 4.5h)
- **Ping count** — how many staggered pings to send (default: 2)
- **Ping interval** — gap between staggered pings (default: 30 min)
- **Days active** — which days of the week to run (e.g. `mon-fri` or `all`)
- **Auto-detect reset** — whether to parse Claude output for reset time info
- **Log level** — `silent | info | verbose`

### CLI Commands
```
csk start          Start the daemon
csk stop           Stop the daemon
csk status         Show daemon state, next ping time, last ping result
csk info           Show full config + session limit status
csk config set     Set a config value interactively
csk logs           Tail the log file
csk ping now       Manually fire a ping immediately (for testing)
csk reset-time     Show detected/estimated time until limit reset
```

### Session Limit Detection
Three methods, used in priority order — all return an **exact timestamp**, not a guess:

1. **OAuth Usage API** — proactive, call before any ping
2. **Unix timestamp in error output** — reactive, when limit is already hit
3. **`last_ping + 5h` estimate** — fallback only if token is missing

---

## File Structure

```
~/.csk/
├── config.json        ← user configuration
├── state.json         ← runtime state (last ping, detected reset time, etc.)
├── daemon.pid         ← PID of running daemon
└── logs/
    ├── csk.log        ← main log
    └── pings.log      ← per-ping record (time, result, response snippet)
```

---

## config.json (Example)

```json
{
  "target_time": "17:00",
  "days": ["mon", "tue", "wed", "thu", "fri"],
  "pings": [
    { "lead_minutes": 300 },
    { "lead_minutes": 270 }
  ],
  "auto_detect_reset": true,
  "log_level": "info",
  "claude_path": "auto"
}
```

- `lead_minutes: 300` = 5 hours before target → ping at 12:00
- `lead_minutes: 270` = 4.5 hours before target → ping at 12:30
- `claude_path: "auto"` = daemon resolves it via `which claude` on start

---

## state.json (Runtime State)

```json
{
  "daemon_started": "2026-04-18T08:00:00",
  "last_ping": {
    "time": "2026-04-18T12:00:00",
    "result": "success",
    "response_snippet": "Hello! How can I help..."
  },
  "usage": {
    "five_hour_utilization": 12.4,
    "five_hour_resets_at": "2026-04-18T17:00:00Z",
    "seven_day_utilization": 34.1,
    "seven_day_resets_at": "2026-04-24T12:00:00Z",
    "source": "oauth_api",
    "fetched_at": "2026-04-18T12:01:00Z"
  },
  "next_ping": "2026-04-18T12:30:00"
}
```

---

## `csk status` Output (Example)

```
● Claude Session Keeper — RUNNING

  Daemon started :  Today 08:00
  Next ping      :  Today 12:30  (in 43 min)
  Last ping      :  Today 12:00  ✓ success
  5hr usage      :  12%  resets Today 17:00  (exact, via API)
  7day usage     :  34%  resets Thu 24 Apr 12:00
  Target time    :  Today 17:00

  Config: target=17:00 | days=mon-fri | pings=2 | interval=30min
```

---

## `csk info` Output (Example)

```
Claude Session Keeper — Info
─────────────────────────────────────
Config file     :  ~/.csk/config.json
Target time     :  17:00 (Mon–Fri)
Ping schedule   :  12:00 PM, 12:30 PM
Claude path     :  /usr/local/bin/claude  (auto-resolved)
Log level       :  info
─────────────────────────────────────
Session Status  (source: OAuth API, fetched 2 min ago)
  5hr usage     :  12%  → resets Today 17:00:00 UTC  ✓ exact
  7day usage    :  34%  → resets Thu Apr 24 12:00:00 UTC
  Last ping     :  Today 12:00 — SUCCESS
─────────────────────────────────────
State file      :  ~/.csk/state.json
Log file        :  ~/.csk/logs/csk.log
Daemon PID      :  38291
```

---

## How Session Limit Detection Works

Three methods are tried in order. All produce an **exact UTC timestamp** except
the last-resort fallback.

---

### Method 1 — OAuth Usage API (primary, proactive)

Claude Code stores an OAuth token locally after login. The daemon reads it and
calls Anthropic's usage endpoint directly:

```
GET https://api.anthropic.com/api/oauth/usage
Headers:
  Authorization: Bearer <token>
  anthropic-beta: oauth-2025-04-20
```

**Token location:**
- **Linux / WSL**: `~/.claude/.credentials.json` → `.claudeAiOauth.accessToken`
- **macOS**: keychain entry `"Claude Code-credentials"` → same JSON structure,
  read via `security find-generic-password -s "Claude Code-credentials" -w`

**Response shape:**
```json
{
  "five_hour": {
    "utilization": 12.4,
    "resets_at": "2026-04-18T17:00:00Z"
  },
  "seven_day": {
    "utilization": 34.1,
    "resets_at": "2026-04-24T12:00:00Z"
  }
}
```

`resets_at` is an ISO 8601 UTC timestamp — parse it directly, no math needed.

**Important:** This endpoint is itself rate-limited. Cache the result in
`state.json` and only re-fetch every 3–5 minutes at most.

---

### Method 2 — Unix timestamp in error output (reactive)

When `claude -p "hi"` hits the limit, the CLI outputs a 429 error that contains
a Unix timestamp in this format:

```
Claude AI usage limit reached|1752001200
```

The number after `|` is a standard Unix epoch timestamp. Convert with:
```js
new Date(1752001200 * 1000).toISOString()
```

No fragile string parsing — just split on `|` and call `parseInt()`.

---

### Method 3 — Calculation fallback (last resort)

If the token is missing, expired, or the API call fails:

```
reset_time = last_successful_ping_time + 5 hours
```

This is an estimate but is accurate enough for scheduling purposes. Shown in
`csk status` with a `~` prefix to indicate it's not exact.

---

### Detection Priority Table

| Method | Trigger | Accuracy | Notes |
|--------|---------|----------|-------|
| OAuth API | On daemon start + every 5 min | ✅ Exact UTC | Cache response, don't over-call |
| Error timestamp | When ping returns 429 | ✅ Exact UTC | Parse `\|UNIXTIMESTAMP` from stderr |
| `+5h` estimate | API unavailable | ⚠️ ~Estimate | Shown with `~` in UI |

---

## Daemon Mechanism

The daemon is a **long-running background process** (not a cron job) so it can:
- React dynamically to detected reset times
- Reschedule pings if a ping fails
- Show live state via `csk status`

### On macOS
Runs as a **launchd agent** (`.plist` in `~/Library/LaunchAgents/`).
`csk start` installs and loads it. `csk stop` unloads it.

### On Linux
Runs as a **systemd user service**.
`csk start` writes the unit file and calls `systemctl --user start`.

### On Windows
Runs as a **scheduled task** via Task Scheduler.
`csk start` registers it via `schtasks`.

---

## Tech Stack Options

| Option | Pros | Cons |
|--------|------|------|
| **Node.js** | Easy async scheduling, `node-cron`, cross-platform, good CLI libs (`commander`, `chalk`, `ora`) | Requires Node installed |
| **Python** | `schedule` lib, `click` for CLI, ships with most systems | Slightly more verbose |
| **Go** | Single binary, no runtime needed, great for daemons | More complex to build |

**Recommendation: Node.js**
- `commander` — CLI argument parsing
- `node-cron` — ping scheduling
- `chalk` + `ora` — nice terminal output
- `execa` — run `claude -p "hi"` and capture output cleanly
- Compiles to a standalone binary with `pkg` if desired

---

## Build Steps (High Level)

1. **Scaffold** — `csk init` creates `~/.csk/` and writes default `config.json`
2. **Token reader** — reads OAuth token from `~/.claude/.credentials.json`
   (Linux) or macOS keychain; validates it hasn't expired
3. **Usage API client** — calls `api.anthropic.com/api/oauth/usage`, caches
   result in `state.json` with a 5-minute TTL
4. **Ping runner** — executes `claude -p "hi"`, captures stdout+stderr, parses
   `|UNIXTIMESTAMP` from any 429 error, writes to `pings.log`, updates `state.json`
5. **Daemon loop** — on start, read config → fetch usage → compute ping times →
   schedule them → sleep → repeat for next day
6. **CLI** — all commands read `state.json` and `config.json` for display;
   `start/stop` manage the OS-level daemon
7. **Config editor** — `csk config set target_time 18:00` updates `config.json`
   and signals daemon to recompute schedule

---

## Edge Cases to Handle

| Scenario | Handling |
|----------|----------|
| Computer asleep at ping time | Daemon reschedules missed ping to fire on wake |
| Claude not in PATH | `csk start` detects this and errors clearly with fix instructions |
| Ping fails (network/auth) | Retry after 5 min, log failure, alert in `csk status` |
| Already at limit when pinging | Parse reset time from error, update state |
| Target time changes mid-day | `csk config set` triggers immediate reschedule |
| Multiple target times in one day | Config supports array: `"target_times": ["09:00", "17:00"]` |

---

## What to Build First (Milestone Order)

1. **Token reader** — read `~/.claude/.credentials.json`, confirm token is valid
2. **`csk reset-time`** — call the OAuth usage API, print `five_hour.resets_at`
   raw; proves the core data source works before building anything else
3. **`csk ping now`** — ping runner with stdout/stderr capture + `|timestamp` parser
4. **`csk status`** + `state.json` — tracking and display
5. **Daemon scheduling** — the cron-like loop
6. **`csk start / stop`** — OS daemon integration (launchd / systemd / schtasks)
7. **`csk config set`** — interactive config editing
8. **Polish** — colors, formatting, error messages, token expiry warnings

---

## Summary

This is a **~500–800 line Node.js project** that could realistically be
built in a single focused session. The hardest part is the OS daemon
integration (launchd/systemd/schtasks) — everything else is straightforward
scheduling and file I/O.

The reset time detection is cleaner than originally assumed: Anthropic exposes
an OAuth usage API that returns exact UTC timestamps for both the 5-hour and
7-day limits. No guessing, no fragile parsing — just read the token that Claude
Code already stores locally and call the endpoint.

Once built, you configure it once (`csk config set target_time 17:00`) and
never think about session limits again.
