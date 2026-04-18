const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const { PING_LOG_FILE, LOG_DIR } = require('./paths');

function resolveClaude(claudePath) {
  if (claudePath !== 'auto') return claudePath;
  try {
    return execSync('which claude', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('`claude` not found in PATH. Set claude_path in config: csk config set claude_path /path/to/claude');
  }
}

// Convert a local time string (YYYY-MM-DDTHH:MM:SS, no tz) in a named timezone to UTC Date
function tzLocalToUTC(localStr, tz) {
  const fakeUTC = new Date(localStr + 'Z');
  const tzDisplay = new Date(fakeUTC.toLocaleString('en-US', { timeZone: tz }));
  const offset = fakeUTC - tzDisplay;
  return new Date(fakeUTC.getTime() + offset);
}

// Parse "You've hit your limit · resets 12am (Asia/Hebron)" → ISO UTC string
function parseResetFromOutput(output) {
  // Match "resets 12am", "resets 1:30pm", "resets 11:59pm" etc. with optional timezone
  const match = output.match(/resets\s+(\d{1,2}(?::\d{2})?(?:am|pm))\s*(?:\(([^)]+)\))?/i);
  if (!match) return null;

  const timeStr = match[1].toLowerCase();
  const tz = match[2] || Intl.DateTimeFormat().resolvedOptions().timeZone;

  let hour = parseInt(timeStr);
  let minute = 0;
  if (timeStr.includes(':')) {
    minute = parseInt(timeStr.split(':')[1]);
  }
  const isPm = timeStr.endsWith('pm');
  const isAm = timeStr.endsWith('am');
  if (isPm && hour !== 12) hour += 12;
  if (isAm && hour === 12) hour = 0;

  const now = new Date();
  for (let daysAhead = 0; daysAhead <= 1; daysAhead++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + daysAhead);

    // Get the date in target timezone
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(candidate);

    const y = parts.find(p => p.type === 'year').value;
    const mo = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    const localStr = `${y}-${mo}-${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

    const resetUTC = tzLocalToUTC(localStr, tz);
    if (resetUTC > now) return resetUTC.toISOString();
  }

  return null;
}

function runPing(claudePath) {
  const bin = resolveClaude(claudePath);
  const result = spawnSync(bin, ['-p', 'hi'], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env }
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const combined = [stdout, stderr].filter(Boolean).join('\n');

  const isLimitHit = /hit your limit/i.test(combined);
  const isSuccess = result.status === 0 && !isLimitHit;

  let resetAt = null;
  if (isLimitHit) {
    resetAt = parseResetFromOutput(combined);
  }

  // Also handle pipe-delimited unix timestamp fallback
  if (!resetAt) {
    const pipeMatch = combined.match(/\|(\d{9,13})\b/);
    if (pipeMatch) {
      const ts = parseInt(pipeMatch[1]);
      resetAt = new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
    }
  }

  const entry = {
    time: new Date().toISOString(),
    result: isSuccess ? 'success' : isLimitHit ? 'limit_hit' : 'error',
    exit_code: result.status,
    response_snippet: combined.slice(0, 200),
    reset_at: resetAt
  };

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(PING_LOG_FILE, JSON.stringify(entry) + '\n');

  return entry;
}

module.exports = { runPing, parseResetFromOutput, resolveClaude };
