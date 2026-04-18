const fs = require('fs');
const { PID_FILE, LOG_FILE, LOG_DIR, CSK_DIR } = require('./paths');
const configLib = require('./config');
const stateLib = require('./state');
const { fetchUsage } = require('./usage');
const { runPing } = require('./ping');
const { computePingSchedule } = require('./schedule');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stdout.write(line + '\n');
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

async function refreshUsage() {
  try {
    const usage = await fetchUsage(true);
    stateLib.update({ usage });
    log(`Usage: 5hr=${usage.five_hour_utilization?.toFixed(1)}% resets ${usage.five_hour_resets_at}`);
    return usage;
  } catch (e) {
    log(`Usage fetch failed: ${e.message}`);
    return null;
  }
}

async function doPing(cfg) {
  log('Firing ping...');
  const result = runPing(cfg.claude_path);
  log(`Ping: ${result.result} | ${result.response_snippet.replace(/\n/g, ' ').slice(0, 100)}`);

  const patch = { last_ping: result };

  if (result.reset_at) {
    log(`Reset time from error output: ${result.reset_at}`);
    const cur = stateLib.read();
    patch.usage = {
      ...(cur.usage || {}),
      five_hour_resets_at: result.reset_at,
      source: 'error_output',
      fetched_at: new Date().toISOString()
    };
  }

  stateLib.update(patch);
  return result;
}

async function mainLoop() {
  fs.mkdirSync(CSK_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  fs.writeFileSync(PID_FILE, String(process.pid));
  stateLib.update({ daemon_started: new Date().toISOString() });
  log(`Daemon started (PID=${process.pid})`);

  await refreshUsage();

  const firedPings = new Set();
  let scheduledPings = [];
  let nextScheduleAt = 0;
  let lastUsageFetchAt = Date.now();

  const USAGE_INTERVAL_MS = 5 * 60 * 1000;
  const CHECK_INTERVAL_MS = 15 * 1000;
  const RESCHEDULE_INTERVAL_MS = 5 * 60 * 1000;

  async function tick() {
    const cfg = configLib.read();
    const now = Date.now();

    if (now - lastUsageFetchAt > USAGE_INTERVAL_MS) {
      await refreshUsage();
      lastUsageFetchAt = now;
    }

    if (now > nextScheduleAt) {
      scheduledPings = computePingSchedule(cfg);
      nextScheduleAt = now + RESCHEDULE_INTERVAL_MS;

      if (scheduledPings.length > 0) {
        const next = scheduledPings[0];
        stateLib.update({ next_ping: next.time.toISOString() });
        log(`Next ping: ${next.time.toISOString()} (${next.lead_minutes}min before ${next.target_time})`);
      } else {
        stateLib.update({ next_ping: null });
        log('No pings scheduled (outside active days/times)');
      }
    }

    const nowDate = new Date();
    for (const ping of scheduledPings) {
      const key = ping.time.toISOString();
      if (firedPings.has(key)) continue;
      if (ping.time <= nowDate) {
        firedPings.add(key);
        await doPing(cfg);
        nextScheduleAt = 0; // force reschedule after firing
      }
    }
  }

  // Initial tick immediately
  try { await tick(); } catch (e) { log(`Tick error: ${e.message}`); }

  const timer = setInterval(async () => {
    try { await tick(); } catch (e) { log(`Tick error: ${e.message}`); }
  }, CHECK_INTERVAL_MS);

  function cleanup(signal) {
    log(`Daemon stopping (${signal})`);
    clearInterval(timer);
    try { fs.unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  }

  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));

  log('Daemon running — checking every 15s');
}

module.exports = { mainLoop };
