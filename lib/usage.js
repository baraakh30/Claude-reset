const https = require('https');
const { getToken } = require('./token');

const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _cacheTime = 0;

async function fetchUsage(forceRefresh = false) {
  if (!forceRefresh && _cache && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cache;
  }

  const token = getToken();

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`API returned ${res.statusCode}: ${data}`));
            return;
          }
          const parsed = JSON.parse(data);
          _cache = {
            five_hour_utilization: parsed.five_hour?.utilization ?? null,
            five_hour_resets_at: parsed.five_hour?.resets_at ?? null,
            seven_day_utilization: parsed.seven_day?.utilization ?? null,
            seven_day_resets_at: parsed.seven_day?.resets_at ?? null,
            source: 'oauth_api',
            fetched_at: new Date().toISOString(),
            raw: parsed
          };
          _cacheTime = Date.now();
          resolve(_cache);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

module.exports = { fetchUsage };
