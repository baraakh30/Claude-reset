const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getToken() {
  if (process.platform === 'darwin') {
    try {
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      const data = JSON.parse(raw);
      const oauth = data.claudeAiOauth;
      if (oauth && oauth.accessToken) {
        if (oauth.expiresAt && new Date(oauth.expiresAt) < new Date()) {
          throw new Error('OAuth token is expired. Re-login to Claude Code to refresh it.');
        }
        return oauth.accessToken;
      }
    } catch (e) {
      if (e.message.includes('expired')) throw e;
    }
  }

  const credFile = path.join(os.homedir(), '.claude', '.credentials.json');
  if (fs.existsSync(credFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(credFile, 'utf8'));
      const oauth = data.claudeAiOauth;
      if (oauth && oauth.accessToken) {
        if (oauth.expiresAt && new Date(oauth.expiresAt) < new Date()) {
          throw new Error('OAuth token is expired. Re-login to Claude Code to refresh it.');
        }
        return oauth.accessToken;
      }
    } catch (e) {
      if (e.message.includes('expired')) throw e;
    }
  }

  throw new Error('No Claude OAuth token found. Make sure you are logged in to Claude Code.');
}

module.exports = { getToken };
