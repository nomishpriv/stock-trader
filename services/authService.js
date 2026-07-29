const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE = 'https://app.stockintel.com/api';
const PHONE = process.env.STOCKINTEL_PHONE || '';
const PASSWORD = process.env.STOCKINTEL_PASSWORD || '';
const DEVICE_ID = process.env.DEVICE_ID || '';

const TOKEN_FILE = path.join(__dirname, '..', '.token.json');

// ========== TOKEN MANAGEMENT ==========
async function loadToken() {
  try {
    await fs.promises.access(TOKEN_FILE);
    const raw = await fs.promises.readFile(TOKEN_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.expiry > Date.now()) return data.token;
  } catch { }
  return null;
}

async function saveToken(token) {
  try {
    const dir = path.dirname(TOKEN_FILE);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      TOKEN_FILE,
      JSON.stringify({ token, expiry: Date.now() + 3500000 })
    );
  } catch (e) {
    console.error('❌ Failed to save token:', e.message);
  }
}

let loginPromise = null;

async function loginAndGetToken() {
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    try {
      console.log('🔑 Auto-login...');
      const { data } = await axios.post(`${BASE}/login`, {
        phone: PHONE, password: PASSWORD,
        device: { id: DEVICE_ID, name: 'Chrome', os: 'windows', type: 'desktop' }
      }, { timeout: 10000 });

      const token = data?.data?.access_token;
      if (token) {
        await saveToken(token);
        console.log('✅ Auto-login success');
        return token;
      }
      return null;
    } catch (e) {
      if (e.response?.status === 429) {
        console.log('⏳ Rate limited — using manual token');
      }
      return null;
    } finally {
      loginPromise = null;
    }
  })();

  return loginPromise;
}

async function getToken() {
  const stored = await loadToken();
  if (stored) return stored;

  const newToken = await loginAndGetToken();
  if (newToken) return newToken;

  return process.env.STOCKINTEL_TOKEN || '';
}

// ========== API INSTANCE ==========
const api = axios.create({ baseURL: BASE, timeout: 15000 });

api.interceptors.request.use(async (config) => {
  config.headers.Authorization = `Bearer ${await getToken()}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 403) {
      console.log('🔄 Token expired, refreshing...');
      try { await fs.promises.unlink(TOKEN_FILE); } catch { }
      const newToken = await loginAndGetToken();
      if (newToken) {
        err.config.headers.Authorization = `Bearer ${newToken}`;
        return api(err.config);
      }
    }
    return Promise.reject(err);
  }
);

// Test login
async function testLogin() {
  try {
    const token = await getToken();
    if (token) {
      console.log('✅ Authentication working');
      return true;
    }
    return false;
  } catch (e) {
    console.error('❌ Auth test failed:', e.message);
    return false;
  }
}

module.exports = {
  api,
  getToken,
  loginAndGetToken,
  testLogin
};