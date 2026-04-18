const chalk = require('chalk');

function formatTime(isoStr) {
  if (!isoStr) return chalk.gray('—');
  const d = new Date(isoStr);
  const now = new Date();

  const todayStr = now.toDateString();
  const tomorrowStr = new Date(now.getTime() + 86400000).toDateString();

  let prefix;
  if (d.toDateString() === todayStr) prefix = 'Today';
  else if (d.toDateString() === tomorrowStr) prefix = 'Tomorrow';
  else prefix = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${prefix} ${time}`;
}

function formatRelative(isoStr) {
  if (!isoStr) return '';
  const diff = new Date(isoStr) - new Date();
  if (diff < 0) return chalk.gray('passed');
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${mins % 60}m`;
  return `in ${mins}m`;
}

function usageBar(pct) {
  if (pct == null) return chalk.gray('?');
  const filled = Math.round(Math.min(pct, 100) / 10);
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(10 - filled));
}

function colorPct(pct) {
  if (pct == null) return chalk.gray('?%');
  const s = pct.toFixed(1) + '%';
  return pct > 80 ? chalk.red(s) : pct > 50 ? chalk.yellow(s) : chalk.green(s);
}

function printStatus(state, config, daemonRunning) {
  const dot = daemonRunning ? chalk.green('●') : chalk.red('○');
  const label = daemonRunning ? chalk.bold.green('RUNNING') : chalk.bold.red('STOPPED');

  console.log();
  console.log(`${dot} Claude Session Keeper — ${label}`);
  console.log();

  if (state.daemon_started) {
    console.log(`  Daemon started :  ${formatTime(state.daemon_started)}`);
  }

  if (state.next_ping) {
    console.log(`  Next ping      :  ${formatTime(state.next_ping)}  ${chalk.dim(formatRelative(state.next_ping))}`);
  } else if (daemonRunning) {
    console.log(`  Next ping      :  ${chalk.dim('none scheduled today')}`);
  }

  if (state.last_ping) {
    const p = state.last_ping;
    const icon =
      p.result === 'success' ? chalk.green('✓ success') :
      p.result === 'limit_hit' ? chalk.yellow('⚠ limit hit') :
      chalk.red('✗ error');
    console.log(`  Last ping      :  ${formatTime(p.time)}  ${icon}`);
  }

  if (state.usage) {
    const u = state.usage;
    const exact = u.source === 'oauth_api';
    const srcNote = exact ? '' : chalk.gray(' ~estimate');

    if (u.five_hour_resets_at != null) {
      console.log(`  5hr usage      :  ${colorPct(u.five_hour_utilization)}  ${usageBar(u.five_hour_utilization)}  resets ${formatTime(u.five_hour_resets_at)}  ${chalk.dim(formatRelative(u.five_hour_resets_at))}${srcNote}`);
    }
    if (u.seven_day_resets_at != null) {
      console.log(`  7day usage     :  ${colorPct(u.seven_day_utilization)}  ${usageBar(u.seven_day_utilization)}  resets ${formatTime(u.seven_day_resets_at)}${srcNote}`);
    }

    const agoMins = u.fetched_at ? Math.round((Date.now() - new Date(u.fetched_at)) / 60000) : null;
    if (agoMins !== null) {
      console.log(`  Usage source   :  ${chalk.dim(u.source + ', fetched ' + agoMins + ' min ago')}`);
    }
  }

  const targetTimes = config.target_times || [config.target_time || '17:00'];
  const days = (config.days || []).join('-');
  const pingCount = (config.pings || []).length;
  const pings = config.pings || [];
  const interval = pings.length > 1
    ? Math.abs(pings[0].lead_minutes - pings[1].lead_minutes) + 'min'
    : '—';

  console.log();
  console.log(chalk.dim(`  Config: target=${targetTimes.join(',')} | days=${days} | pings=${pingCount} | interval=${interval}`));
  console.log();
}

function printInfo(state, config) {
  const { CONFIG_FILE, STATE_FILE, LOG_FILE, PID_FILE } = require('./paths');
  const { execSync } = require('child_process');
  const fs = require('fs');

  const targetTimes = config.target_times || [config.target_time || '17:00'];

  const pingSchedule = (config.pings || []).map(p => {
    const [tH, tM] = (targetTimes[0] || '17:00').split(':').map(Number);
    const totalMins = tH * 60 + (tM || 0) - p.lead_minutes;
    const normalized = ((totalMins % 1440) + 1440) % 1440;
    const h = Math.floor(normalized / 60);
    const m = normalized % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }).join(', ');

  let claudePath = config.claude_path;
  if (claudePath === 'auto') {
    try { claudePath = execSync('which claude', { encoding: 'utf8' }).trim(); }
    catch { claudePath = chalk.red('not found in PATH'); }
  }

  const sep = chalk.dim('─'.repeat(45));
  console.log();
  console.log(chalk.bold('Claude Session Keeper — Info'));
  console.log(sep);
  console.log(`Config file     :  ${CONFIG_FILE}`);
  console.log(`Target time     :  ${targetTimes.join(', ')} (${(config.days || []).join('–')})`);
  console.log(`Ping schedule   :  ${pingSchedule}`);
  console.log(`Claude path     :  ${claudePath}`);
  console.log(`Log level       :  ${config.log_level}`);
  console.log(sep);

  if (state.usage) {
    const u = state.usage;
    const agoMins = u.fetched_at ? Math.round((Date.now() - new Date(u.fetched_at)) / 60000) : 0;
    console.log(`Session Status  ${chalk.dim('(source: ' + u.source + ', fetched ' + agoMins + ' min ago)')}`);
    if (u.five_hour_resets_at != null) {
      const exact = u.source === 'oauth_api' ? chalk.green('✓ exact') : chalk.yellow('~estimate');
      console.log(`  5hr usage     :  ${colorPct(u.five_hour_utilization)}  → resets ${formatTime(u.five_hour_resets_at)}  ${exact}`);
    }
    if (u.seven_day_resets_at != null) {
      console.log(`  7day usage    :  ${colorPct(u.seven_day_utilization)}  → resets ${formatTime(u.seven_day_resets_at)}`);
    }
    if (state.last_ping) {
      const p = state.last_ping;
      const r = p.result === 'success' ? chalk.green('SUCCESS') : chalk.yellow(p.result.toUpperCase().replace('_', ' '));
      console.log(`  Last ping     :  ${formatTime(p.time)} — ${r}`);
    }
  } else {
    console.log(chalk.gray('Session Status  :  not fetched yet — run `csk reset-time` to fetch'));
  }

  console.log(sep);
  console.log(`State file      :  ${STATE_FILE}`);
  console.log(`Log file        :  ${LOG_FILE}`);
  if (fs.existsSync(PID_FILE)) {
    console.log(`Daemon PID      :  ${fs.readFileSync(PID_FILE, 'utf8').trim()}`);
  }
  console.log();
}

module.exports = { printStatus, printInfo, formatTime, formatRelative };
