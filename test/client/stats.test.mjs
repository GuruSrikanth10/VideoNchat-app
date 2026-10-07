import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, rate, describe } from "../../public/js/lib/stats.js";
import { videoLimitsFor, SLOTS } from "../../public/js/lib/rtc.js";

const report = (stats) => new Map(stats.map((s, i) => [String(i), s]));

test("summarize reads round trip, jitter, loss and bitrate", () => {
  const first = summarize(
    report([
      { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.08 },
      {
        type: "inbound-rtp",
        kind: "audio",
        packetsLost: 0,
        packetsReceived: 100,
        bytesReceived: 10_000,
        jitter: 0.01,
      },
    ]),
    null,
    1000,
  );
  assert.equal(first.rtt, 80);
  assert.equal(first.jitter, 10);
  assert.equal(first.lossPercent, null, "rates need two samples");

  const second = summarize(
    report([
      {
        type: "inbound-rtp",
        kind: "audio",
        packetsLost: 5,
        packetsReceived: 195,
        bytesReceived: 35_000,
      },
    ]),
    first,
    3000,
  );
  assert.equal(second.lossPercent, 5); // 5 lost of 100 packets in the interval
  assert.equal(second.kbps, 100); // 25 kB in 2 s
});

test("rate turns numbers into good, fair or poor", () => {
  assert.equal(rate({ rtt: null, lossPercent: null, jitter: null }), null);
  assert.equal(rate({ rtt: 60, lossPercent: 0, jitter: 5 }), "good");
  assert.equal(rate({ rtt: 300, lossPercent: 0, jitter: 5 }), "fair");
  assert.equal(rate({ rtt: 60, lossPercent: 12, jitter: 5 }), "poor");
});

test("describe explains the rating in words", () => {
  assert.equal(
    describe({ rtt: 81.4, lossPercent: 0.25, kbps: 812.6 }, "good"),
    "Good connection: 81 ms round trip, 0.3% packet loss, 813 kbps",
  );
  assert.equal(
    describe({ rtt: null, lossPercent: null, kbps: null }, null),
    "Measuring connection",
  );
});

test("video bitrate goes down as the room grows", () => {
  const rates = [2, 3, 4, 6].map((n) => videoLimitsFor(n).maxBitrate);
  assert.deepEqual(
    [...rates].sort((a, b) => b - a),
    rates,
  );
  assert.equal(videoLimitsFor(6).scaleResolutionDownBy, 2);
});

test("every connection uses the same transceiver layout", () => {
  assert.deepEqual(SLOTS, ["mic", "camera", "screen"]);
});
