const fs = require('fs');
const { CONFIG_FILE, CSK_DIR } = require('./paths');

const DEFAULTS = {
  target_times: ['17:00'],
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  pings: [
    { lead_minutes: 300 },
    { lead_minutes: 270 }
  ],
  auto_detect_reset: true,
  log_level: 'info',
  claude_path: 'auto'
};

const VALID_DAYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

function parseDays(input) {
  if (!input) return ['mon', 'tue', 'wed', 'thu', 'fri'];
  const s = input.trim().toLowerCase();
  if (s === 'all') return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  if (s === 'mon-fri' || s === 'weekdays') return ['mon', 'tue', 'wed', 'thu', 'fri'];
  return s.split(/[,\s]+/).map(d => d.slice(0, 3)).filter(d => VALID_DAYS.has(d));
}

function read() {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    const raw = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    // Normalize: target_time (singular) → target_times (array)
    if (raw.target_time && !raw.target_times.includes(raw.target_time)) {
      raw.target_times = [raw.target_time];
    }
    // Normalize: days to canonical 3-letter tokens
    raw.days = Array.isArray(raw.days)
      ? raw.days.map(d => String(d).trim().toLowerCase().slice(0, 3)).filter(d => VALID_DAYS.has(d))
      : parseDays(raw.days);
    return raw;
  } catch {
    return { ...DEFAULTS };
  }
}

function write(config) {
  fs.mkdirSync(CSK_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function set(key, value) {
  const config = read();
  const parts = key.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { parsed = value; }
  obj[parts[parts.length - 1]] = parsed;

  // Keep target_times in sync when target_time is set
  if (key === 'target_time') {
    config.target_times = [parsed];
    delete config.target_time;
  }

  write(config);
  return config;
}

module.exports = { read, write, set, DEFAULTS };
