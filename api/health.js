const { getRedis } = require('./_lib/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const redis = getRedis();
    await redis.set('ff:health', Date.now(), { ex: 60 });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, service: 'ff-checker-vercel', redis: 'connected' }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, redis: 'error', message: error.message }));
  }
};
