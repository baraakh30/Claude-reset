const { computePingSchedule } = require('./schedule');

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Returns { warnings: [], infos: [] }
// Each item: { code, message, suggestion }
function validate(config, state) {
  const warnings = [];
  const infos = [];

  const now = new Date();
  const resetAt = state.usage?.five_hour_resets_at ? new Date(state.usage.five_hour_resets_at) : null;
  const targetTimes = config.target_times || [config.target_time || '17:00'];
  const pingDefs = config.pings || [{ lead_minutes: 300 }, { lead_minutes: 270 }];
  const days = config.days || ['mon', 'tue', 'wed', 'thu', 'fri'];

  // ── For each target, check each ping def ───────────────────────────────────
  for (const targetTimeStr of targetTimes) {
    const [tH, tM] = targetTimeStr.split(':').map(Number);

    for (const pingDef of pingDefs) {
      // Find the next scheduled ping for this target+lead combo
      let nextPingTime = null;
      let nextTargetTime = null;

      for (let d = 0; d <= 7; d++) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + d);
        candidate.setHours(tH, tM || 0, 0, 0);

        const dayName = DAY_NAMES[candidate.getDay()];
        if (!days.includes(dayName)) continue;

        const pingTime = new Date(candidate.getTime() - pingDef.lead_minutes * 60000);
        if (pingTime > now) {
          nextPingTime = pingTime;
          nextTargetTime = candidate;
          break;
        }
      }

      if (!nextPingTime) continue;

      const pingHour = nextPingTime.getHours();
      const leadH = Math.floor(pingDef.lead_minutes / 60);
      const leadM = pingDef.lead_minutes % 60;
      const leadStr = leadM > 0 ? `${leadH}h ${leadM}m` : `${leadH}h`;

      // ── Case 1: Ping fires before the known limit reset ──────────────────
      if (resetAt && resetAt > now && nextPingTime < resetAt) {
        // Earliest feasible ping = right after resetAt
        // → earliest target = resetAt + lead_minutes (same lead strategy)
        const earliestTarget = new Date(resetAt.getTime() + pingDef.lead_minutes * 60000);
        warnings.push({
          code: 'ping_before_reset',
          message: `Ping for target ${targetTimeStr} fires at ${fmt(nextPingTime)} — before the limit resets at ${fmt(resetAt)}. The ping will hit the limit and fail.`,
          suggestion: `Earliest feasible target with ${leadStr} lead: ${fmt(earliestTarget)}. Or set target to ${fmtHHMM(earliestTarget)} and run \`csk config set target_time ${fmtHHMM(earliestTarget)}\`.`
        });
      }

      // ── Case 2: Ping fires between midnight and 6am ──────────────────────
      if (pingHour >= 0 && pingHour < 6) {
        warnings.push({
          code: 'overnight_ping',
          message: `Ping for target ${targetTimeStr} fires at ${fmt(nextPingTime)} (${pingHour < 4 ? 'very late night' : 'early morning'}). Your computer may be asleep and miss it.`,
          suggestion: `Consider a shorter lead or later target. E.g. lead=240 fires 4h before target (reset happens 1h into your session instead).`
        });
      }

      // ── Case 3: Lead < 300 — overlap strategy (informational) ────────────
      if (pingDef.lead_minutes < 300 && pingDef.lead_minutes > 0) {
        const resetOffsetMins = 300 - pingDef.lead_minutes;
        const resetOffsetStr = resetOffsetMins >= 60
          ? `${Math.floor(resetOffsetMins / 60)}h${resetOffsetMins % 60 > 0 ? ` ${resetOffsetMins % 60}m` : ''}`
          : `${resetOffsetMins}m`;
        infos.push({
          code: 'overlap_strategy',
          message: `Lead ${pingDef.lead_minutes}m for target ${targetTimeStr}: reset happens ${resetOffsetStr} after you start working. You get ${resetOffsetStr} + full session back-to-back.`
        });
      }

      // ── Case 4: Lead > 600 (ping fires >10h before target, probably wrong)
      if (pingDef.lead_minutes > 600) {
        warnings.push({
          code: 'excessive_lead',
          message: `Lead ${pingDef.lead_minutes}m (${leadStr}) fires at ${fmt(nextPingTime)} — over 10 hours before target ${targetTimeStr}. This is likely a misconfiguration.`,
          suggestion: `Typical values: 300 (reset before target), 240–270 (reset 30–60min into session).`
        });
      }
    }
  }

  // ── Case 5: Multiple targets too close together ───────────────────────────
  if (targetTimes.length > 1) {
    const sorted = [...targetTimes].sort();
    for (let i = 0; i < sorted.length - 1; i++) {
      const [aH, aM] = sorted[i].split(':').map(Number);
      const [bH, bM] = sorted[i + 1].split(':').map(Number);
      const gapMins = (bH * 60 + (bM || 0)) - (aH * 60 + (aM || 0));
      if (gapMins > 0 && gapMins < 300) {
        warnings.push({
          code: 'targets_too_close',
          message: `Targets ${sorted[i]} and ${sorted[i + 1]} are only ${Math.floor(gapMins / 60)}h ${gapMins % 60}m apart — less than the 5-hour reset period.`,
          suggestion: `Space targets ≥5h apart, or use the overlap strategy (lead < 300) for the earlier target to get a reset mid-session.`
        });
      }
    }
  }

  // ── Case 6: No active days configured ────────────────────────────────────
  if (!days || days.length === 0) {
    warnings.push({
      code: 'no_active_days',
      message: 'No active days configured — daemon will never fire a ping.',
      suggestion: 'Run `csk config set days mon-fri` or `csk config set days all`.'
    });
  }

  // ── Case 7: Limit already reset (or close) — good news ───────────────────
  if (resetAt && resetAt <= now) {
    const agoMins = Math.round((now - resetAt) / 60000);
    if (agoMins < 60) {
      infos.push({
        code: 'recently_reset',
        message: `Limit reset ${agoMins}m ago — you have a fresh session available right now.`
      });
    }
  }

  return { warnings, infos };
}

function fmt(date) {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === new Date(now.getTime() + 86400000).toDateString();
  const prefix = isToday ? 'today' : isTomorrow ? 'tomorrow' : date.toLocaleDateString('en-US', { weekday: 'short' });
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${prefix} ${time}`;
}

function fmtHHMM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

module.exports = { validate };
