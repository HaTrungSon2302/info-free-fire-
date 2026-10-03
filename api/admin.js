const { isAdmin, setSessionCookie, clearSessionCookie } = require('./_lib/auth');
const {
  getSettings,
  saveSettings,
  addApiKey,
  listKeyStates,
  resetKey,
  deleteKey,
  getLast7Stats
} = require('./_lib/store');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function actionOf(req) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return url.searchParams.get('action') || bodyOf(req).action || '';
}

async function statePayload() {
  const [settings, keys, stats] = await Promise.all([
    getSettings(),
    listKeyStates(),
    getLast7Stats()
  ]);
  return {
    settings,
    keys: keys.map(k => ({ ...k, active: k.id === settings.activeKeyId })),
    stats
  };
}

module.exports = async function handler(req, res) {
  try {
    const action = actionOf(req);
    const body = bodyOf(req);

    if (action === 'login') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method không hợp lệ' });
      const adminUser = process.env.ADMIN_USERNAME;
      const adminPass = process.env.ADMIN_PASSWORD;
      if (!adminUser || !adminPass) {
        return send(res, 503, { ok: false, message: 'ADMIN_USERNAME/ADMIN_PASSWORD chưa được cấu hình trên Vercel.' });
      }
      if (body.username !== adminUser || body.password !== adminPass) {
        return send(res, 401, { ok: false, message: 'Sai tài khoản hoặc mật khẩu.' });
      }
      setSessionCookie(res, adminUser);
      return send(res, 200, { ok: true });
    }

    if (action === 'logout') {
      clearSessionCookie(res);
      return send(res, 200, { ok: true });
    }

    if (!isAdmin(req)) return send(res, 401, { ok: false, message: 'Bạn chưa đăng nhập.' });

    if (action === 'state' || (!action && req.method === 'GET')) {
      return send(res, 200, { ok: true, ...(await statePayload()) });
    }

    if (action === 'settings' && req.method === 'POST') {
      const current = await getSettings();
      const next = {
        ...current,
        defaultToken: String(body.defaultToken ?? current.defaultToken).trim(),
        apiBase: String(body.apiBase ?? current.apiBase).trim(),
        defaultRegion: String(body.defaultRegion ?? current.defaultRegion).trim() || 'BD',
        cacheSeconds: Math.max(30, Number(body.cacheSeconds ?? current.cacheSeconds ?? 180))
      };
      if (!/^https?:\/\//i.test(next.apiBase)) {
        return send(res, 400, { ok: false, message: 'API Base phải bắt đầu bằng http:// hoặc https://' });
      }
      await saveSettings(next);
      return send(res, 200, { ok: true, ...(await statePayload()) });
    }

    if (action === 'addKey' && req.method === 'POST') {
      await addApiKey(body.name, body.key, body.limit || 500);
      return send(res, 200, { ok: true, ...(await statePayload()) });
    }

    if (action === 'activateKey' && req.method === 'POST') {
      const settings = await getSettings();
      const keys = await listKeyStates();
      if (!keys.some(k => k.id === body.id)) return send(res, 404, { ok: false, message: 'Không tìm thấy key.' });
      settings.activeKeyId = body.id;
      await saveSettings(settings);
      return send(res, 200, { ok: true, ...(await statePayload()) });
    }

    if (action === 'resetKey' && req.method === 'POST') {
      await resetKey(body.id);
      return send(res, 200, { ok: true, ...(await statePayload()) });
    }

    if (action === 'deleteKey' && req.method === 'POST') {
      const keys = await listKeyStates();
      if (keys.length <= 1) return send(res, 400, { ok: false, message: 'Không thể xóa key cuối cùng.' });
      const ok = await deleteKey(body.id);
      if (!ok) return send(res, 404, { ok: false, message: 'Không tìm thấy key.' });
      return send(res, 200, { ok: true, ...(await statePayload()) });
    }

    if (action === 'clearCache' && req.method === 'POST') {
      const settings = await getSettings();
      settings.cacheVersion = Number(settings.cacheVersion || 1) + 1;
      await saveSettings(settings);
      return send(res, 200, { ok: true, ...(await statePayload()) });
    }

    return send(res, 404, { ok: false, message: 'Action không tồn tại.' });
  } catch (error) {
    return send(res, 500, { ok: false, message: error.message || 'Lỗi máy chủ' });
  }
};
