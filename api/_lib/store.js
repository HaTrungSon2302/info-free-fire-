const crypto = require('crypto');
const { getRedis } = require('./redis');

const SETTINGS_KEY = 'ff:settings';
const KEYS_KEY = 'ff:api_keys';

function asObject(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function defaults() {
  return {
    defaultToken: process.env.CHECK_TOKEN || '',
    apiBase: process.env.FF_API_BASE || 'https://siambhau69.eu.cc/freefireinfo/bhau',
    defaultRegion: process.env.FF_DEFAULT_REGION || 'BD',
    cacheSeconds: Math.max(30, Number(process.env.FF_CACHE_SECONDS || 180)),
    activeKeyId: null,
    cacheVersion: 1
  };
}

async function getSettings() {
  const redis = getRedis();
  const stored = asObject(await redis.get(SETTINGS_KEY), {});
  return { ...defaults(), ...stored };
}

async function saveSettings(settings) {
  const redis = getRedis();
  await redis.set(SETTINGS_KEY, settings);
  return settings;
}

async function getApiKeys() {
  const redis = getRedis();
  const keys = asObject(await redis.get(KEYS_KEY), []);
  return Array.isArray(keys) ? keys : [];
}

async function saveApiKeys(keys) {
  const redis = getRedis();
  await redis.set(KEYS_KEY, keys);
  return keys;
}

async function addApiKey(name, key, limit = 500) {
  const keys = await getApiKeys();
  const item = {
    id: crypto.randomUUID(),
    name: String(name || `Key #${keys.length + 1}`).trim(),
    key: String(key || '').trim(),
    limit: Math.max(1, Number(limit || 500))
  };
  if (!item.key) throw new Error('API key không được để trống.');
  keys.push(item);
  await saveApiKeys(keys);

  const settings = await getSettings();
  if (!settings.activeKeyId) {
    settings.activeKeyId = item.id;
    await saveSettings(settings);
  }
  return item;
}

async function getKeyState(item) {
  const redis = getRedis();
  const [rawUsed, disabled] = await Promise.all([
    redis.get(`ff:key_usage:${item.id}`),
    redis.get(`ff:key_disabled:${item.id}`)
  ]);
  const used = Math.max(0, Number(rawUsed || 0));
  return {
    ...item,
    used: Math.min(used, item.limit),
    exhausted: Boolean(disabled) || used >= item.limit
  };
}

async function listKeyStates() {
  const keys = await getApiKeys();
  return Promise.all(keys.map(getKeyState));
}

async function reserveKeyUse(item) {
  const redis = getRedis();
  if (await redis.get(`ff:key_disabled:${item.id}`)) return null;

  const used = Number(await redis.incr(`ff:key_usage:${item.id}`));
  if (used > item.limit) {
    await redis.decr(`ff:key_usage:${item.id}`);
    await redis.set(`ff:key_disabled:${item.id}`, 1);
    return null;
  }
  return used;
}

async function disableKey(id) {
  await getRedis().set(`ff:key_disabled:${id}`, 1);
}

async function resetKey(id) {
  const redis = getRedis();
  await Promise.all([
    redis.set(`ff:key_usage:${id}`, 0),
    redis.del(`ff:key_disabled:${id}`)
  ]);
}

async function deleteKey(id) {
  const keys = await getApiKeys();
  const next = keys.filter(k => k.id !== id);
  if (next.length === keys.length) return false;
  await saveApiKeys(next);
  const redis = getRedis();
  await Promise.all([
    redis.del(`ff:key_usage:${id}`),
    redis.del(`ff:key_disabled:${id}`)
  ]);

  const settings = await getSettings();
  if (settings.activeKeyId === id) {
    settings.activeKeyId = next[0]?.id || null;
    await saveSettings(settings);
  }
  return true;
}

function dayKey(date = new Date()) {
  // Thống kê theo giờ Việt Nam (Asia/Ho_Chi_Minh), không theo UTC của Vercel.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

async function recordUsage(uid, cached) {
  const redis = getRedis();
  const day = dayKey();
  const statsKey = `ff:stats:${day}`;
  const uidSet = `ff:uids:${day}`;
  const field = cached ? 'cache_hits' : 'api_calls';
  const value = await redis.hincrby(statsKey, field, 1);
  if (uid) await redis.sadd(uidSet, String(uid));
  await Promise.all([
    redis.expire(statsKey, 35 * 86400),
    redis.expire(uidSet, 35 * 86400)
  ]);
  return Number(value || 0);
}

async function getLast7Stats() {
  const redis = getRedis();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = dayKey(d);
    const [stats, unique] = await Promise.all([
      redis.hgetall(`ff:stats:${day}`),
      redis.scard(`ff:uids:${day}`)
    ]);
    days.push({
      date: day,
      apiCalls: Number(stats?.api_calls || 0),
      cacheHits: Number(stats?.cache_hits || 0),
      uniqueUids: Number(unique || 0)
    });
  }
  return days;
}

module.exports = {
  getSettings,
  saveSettings,
  getApiKeys,
  saveApiKeys,
  addApiKey,
  listKeyStates,
  reserveKeyUse,
  disableKey,
  resetKey,
  deleteKey,
  recordUsage,
  getLast7Stats
};
