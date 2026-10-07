// Token buckets: each event type allows a burst of `capacity` messages,
// refilled at `perSecond`. Messages beyond that are dropped.

const RATE_LIMITS = {
  "room:join": { capacity: 5, perSecond: 0.2 },
  "room:leave": { capacity: 5, perSecond: 1 },
  // Knocking on a locked room; each knock interrupts the host.
  "room:knock": { capacity: 3, perSecond: 0.1 },
  "chat:send": { capacity: 10, perSecond: 1 },
  "chat:typing": { capacity: 10, perSecond: 2 },
  "media:state": { capacity: 20, perSecond: 5 },
  "reaction:send": { capacity: 10, perSecond: 2 },
  // ICE candidates arrive in bursts while connections are set up.
  "rtc:signal": { capacity: 400, perSecond: 100 },
  default: { capacity: 20, perSecond: 5 },
};

function createLimiter(limits = RATE_LIMITS, now = () => Date.now()) {
  const buckets = new Map();
  return {
    allow(event) {
      const { capacity, perSecond } = limits[event] ?? limits.default;
      const time = now();
      const bucket = buckets.get(event) ?? { tokens: capacity, updated: time };
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + ((time - bucket.updated) / 1000) * perSecond,
      );
      bucket.updated = time;
      buckets.set(event, bucket);
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}

module.exports = { createLimiter, RATE_LIMITS };
