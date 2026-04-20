const os = require('os');
const path = require('path');

const CSK_DIR = path.join(os.homedir(), '.csk');
const CONFIG_FILE = path.join(CSK_DIR, 'config.json');
const STATE_FILE = path.join(CSK_DIR, 'state.json');
const PID_FILE = path.join(CSK_DIR, 'daemon.pid');
const LOG_DIR = path.join(CSK_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'csk.log');
const PING_LOG_FILE = path.join(LOG_DIR, 'pings.log');
const PLIST_FILE = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.csk.daemon.plist');
const SYSTEMD_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SYSTEMD_FILE = path.join(SYSTEMD_DIR, 'csk.service');

module.exports = { CSK_DIR, CONFIG_FILE, STATE_FILE, PID_FILE, LOG_DIR, LOG_FILE, PING_LOG_FILE, PLIST_FILE, SYSTEMD_DIR, SYSTEMD_FILE };
