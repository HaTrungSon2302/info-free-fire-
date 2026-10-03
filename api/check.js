const { getRedis } = require('./_lib/redis');
const {
  getSettings,
  getApiKeys,
  saveSettings,
  reserveKeyUse,
  disableKey,
  recordUsage
} = require('./_lib/store');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body, null, 2));
}

function getQuery(req) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return url.searchParams;
}

function looksLikeQuotaError(httpCode, data, rawText) {
  if ([401, 403, 429].includes(httpCode)) return true;
  const text = `${JSON.stringify(data || {})} ${rawText || ''}`.toLowerCase();
  return ['quota', 'limit', 'exceed', 'exhaust', 'too many request', 'maximum request'].some(x => text.includes(x));
}

function normalizeUpstream(data, req, cacheSeconds, apiCallsToday) {
  const now = new Date();
  return {
    IP: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'Vercel',
    DiaChi: req.headers.host || '',
    SoLuotHomNaySeverDung: apiCallsToday,
    basicInfo: data?.basicInfo || {},
    profileInfo: data?.profileInfo || {},
    clanBasicInfo: data?.clanBasicInfo || {},
    petInfo: data?.petInfo || {},
    socialInfo: data?.socialInfo || {},
    diamondCostRes: data?.diamondCostRes || {},
    creditScoreInfo: data?.creditScoreInfo || {},
    cached_at: now.toISOString(),
    next_update: new Date(now.getTime() + cacheSeconds * 1000).toISOString(),
    cache_seconds: cacheSeconds
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { status: 'error', message: 'Chỉ hỗ trợ GET' });

  try {
    const params = getQuery(req);
    const rawUid = params.get('UID') || params.get('uid') || '';
    const token = params.get('Token') || params.get('token') || '';
    const uid = rawUid.replace(/\D/g, '');

    if (!uid) return send(res, 400, { status: 'error', message: 'Thiếu tham số UID' });

    const settings = await getSettings();
    if (!settings.defaultToken) {
      return send(res, 503, { status: 'error', message: 'CHECK_TOKEN chưa được cấu hình' });
    }
    if (token !== settings.defaultToken) {
      return send(res, 403, { status: 'error', message: 'Token không hợp lệ' });
    }

    const redis = getRedis();
    const cacheSeconds = Math.max(30, Number(settings.cacheSeconds || 180));
    const cacheKey = `ff:cache:v${settings.cacheVersion || 1}:${uid}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      await recordUsage(uid, true);
      return send(res, 200, cached);
    }

    const keys = await getApiKeys();
    if (!keys.length) {
      return send(res, 503, { status: 'error', message: 'Chưa có API key. Hãy thêm key trong trang admin.' });
    }

    const ordered = [
      ...keys.filter(k => k.id === settings.activeKeyId),
      ...keys.filter(k => k.id !== settings.activeKeyId)
    ];

    let lastError = null;

    for (const item of ordered) {
      const reserved = await reserveKeyUse(item);
      if (reserved === null) continue;

      const upstream = new URL(settings.apiBase);
      upstream.searchParams.set('uid', uid);
      upstream.searchParams.set('region', settings.defaultRegion || 'BD');
      upstream.searchParams.set('key', item.key);

      let response;
      let text = '';
      let data = null;

      try {
        response = await fetch(upstream, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 FFChecker-Vercel/1.0' },
          signal: AbortSignal.timeout(15000)
        });
        text = await response.text();
        try { data = JSON.parse(text); } catch { data = null; }
      } catch (error) {
        lastError = { status: 'error', message: `Upstream không phản hồi: ${error.message}` };
        break;
      }

      if (looksLikeQuotaError(response.status, data, text)) {
        await disableKey(item.id);
        lastError = { status: 'error', message: `API key ${item.name} đã hết lượt hoặc bị từ chối`, http: response.status };
        continue;
      }

      const apiError = !data || (String(data.status || '').toLowerCase() === 'error');
      if (!response.ok || apiError) {
        lastError = data || { status: 'error', message: 'API upstream trả dữ liệu lỗi', http: response.status };
        break;
      }

      if (settings.activeKeyId !== item.id) {
        settings.activeKeyId = item.id;
        await saveSettings(settings);
      }

      const apiCallsToday = await recordUsage(uid, false);
      const result = normalizeUpstream(data, req, cacheSeconds, apiCallsToday);
      await redis.set(cacheKey, result, { ex: cacheSeconds });
      return send(res, 200, result);
    }

    if (lastError) return send(res, 502, lastError);
    return send(res, 503, {
      status: 'error',
      message: 'Tất cả API key đều đã hết 500 lượt hoặc đang bị khóa. Hãy thêm/reset key trong admin.'
    });
  } catch (error) {
    return send(res, 500, { status: 'error', message: error.message || 'Lỗi máy chủ' });
  }
};
