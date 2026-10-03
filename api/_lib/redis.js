const { Redis } = require('@upstash/redis');

let client;

function getRedis() {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error('Redis chưa được cấu hình. Hãy kết nối Upstash Redis trong Vercel và Redeploy.');
  }

  client = new Redis({ url, token });
  return client;
}

module.exports = { getRedis };
