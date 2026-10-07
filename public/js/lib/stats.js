// Call quality from RTCPeerConnection.getStats(), sampled periodically.

// Summarises a stats report, given the previous summary for rates.
export function summarize(report, previous = null, now = Date.now()) {
  let rtt = null;
  let packetsLost = 0;
  let packetsReceived = 0;
  let bytesReceived = 0;
  let jitter = null;

  report.forEach((stat) => {
    if (stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") {
      if (typeof stat.currentRoundTripTime === "number") rtt = stat.currentRoundTripTime * 1000;
    }
    if (stat.type === "inbound-rtp" && !stat.isRemote) {
      packetsLost += stat.packetsLost ?? 0;
      packetsReceived += stat.packetsReceived ?? 0;
      bytesReceived += stat.bytesReceived ?? 0;
      if (stat.kind === "audio" && typeof stat.jitter === "number") jitter = stat.jitter * 1000;
    }
  });

  let lossPercent = null;
  let kbps = null;
  if (previous) {
    const lost = packetsLost - previous.packetsLost;
    const received = packetsReceived - previous.packetsReceived;
    if (lost + received > 0) lossPercent = (Math.max(lost, 0) / (lost + received)) * 100;
    const seconds = (now - previous.time) / 1000;
    if (seconds > 0) kbps = ((bytesReceived - previous.bytesReceived) * 8) / 1000 / seconds;
  }

  return { time: now, rtt, jitter, lossPercent, kbps, packetsLost, packetsReceived, bytesReceived };
}

// "good", "fair" or "poor", or null while there's nothing to judge yet.
export function rate({ rtt, lossPercent, jitter }) {
  if (rtt === null && lossPercent === null) return null;
  if ((lossPercent ?? 0) > 8 || (rtt ?? 0) > 500 || (jitter ?? 0) > 80) return "poor";
  if ((lossPercent ?? 0) > 2 || (rtt ?? 0) > 250 || (jitter ?? 0) > 40) return "fair";
  return "good";
}

export function describe(summary, quality) {
  const parts = [];
  if (summary.rtt !== null) parts.push(`${Math.round(summary.rtt)} ms round trip`);
  if (summary.lossPercent !== null) parts.push(`${summary.lossPercent.toFixed(1)}% packet loss`);
  if (summary.kbps !== null) parts.push(`${Math.round(summary.kbps)} kbps`);
  const label = { good: "Good", fair: "Fair", poor: "Poor" }[quality] ?? "Measuring";
  return parts.length ? `${label} connection: ${parts.join(", ")}` : `${label} connection`;
}
