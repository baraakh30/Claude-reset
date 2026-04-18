const fs = require('fs');
const { STATE_FILE, CSK_DIR } = require('./paths');

const EMPTY = {
  daemon_started: null,
  last_ping: null,
  usage: null,
  next_ping: null
};

function read() {
  if (!fs.existsSync(STATE_FILE)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

function write(state) {
  fs.mkdirSync(CSK_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function update(patch) {
  write({ ...read(), ...patch });
}

module.exports = { read, write, update };
