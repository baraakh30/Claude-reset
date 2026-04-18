const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Given a target time like "17:00" and a list of ping defs, compute the next
// ping times in wall-clock local time.
function computePingSchedule(config) {
  const targetTimes = config.target_times || (config.target_time ? [config.target_time] : ['17:00']);
  const days = config.days || ['mon', 'tue', 'wed', 'thu', 'fri'];
  const pingDefs = config.pings || [{ lead_minutes: 300 }, { lead_minutes: 270 }];

  const pings = [];
  const now = new Date();

  for (const targetTimeStr of targetTimes) {
    const [tH, tM] = targetTimeStr.split(':').map(Number);

    for (const pingDef of pingDefs) {
      // Find next valid target day (one that's in config.days)
      for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() + daysAhead);
        targetDate.setHours(tH, tM || 0, 0, 0);

        const dayName = DAY_NAMES[targetDate.getDay()];
        if (!days.includes(dayName)) continue;

        const pingTime = new Date(targetDate.getTime() - pingDef.lead_minutes * 60 * 1000);
        if (pingTime > now) {
          pings.push({
            time: pingTime,
            target_time: targetTimeStr,
            lead_minutes: pingDef.lead_minutes
          });
          break;
        }
      }
    }
  }

  pings.sort((a, b) => a.time - b.time);
  return pings;
}

module.exports = { computePingSchedule };
