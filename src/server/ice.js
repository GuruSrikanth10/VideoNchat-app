// ICE servers for WebRTC. TURN credentials are short-lived HMAC credentials
// (the "TURN REST API" scheme that coturn's use-auth-secret implements), so
// a leaked credential stops working after TURN_TTL_SECONDS.
const { createHmac } = require("crypto");

function iceServersFor(config, { now = Date.now(), user = "videonchat" } = {}) {
  const { stunUrls, turnUrls, turnSecret, turnTtlSeconds, extraServers } = config.ice;
  const iceServers = [];
  if (stunUrls.length > 0) iceServers.push({ urls: stunUrls });
  if (turnUrls.length > 0) {
    const expiresAt = Math.floor(now / 1000) + turnTtlSeconds;
    const username = `${expiresAt}:${user}`;
    const credential = createHmac("sha1", turnSecret).update(username).digest("base64");
    iceServers.push({ urls: turnUrls, username, credential });
  }
  iceServers.push(...extraServers);
  return iceServers;
}

module.exports = { iceServersFor };
