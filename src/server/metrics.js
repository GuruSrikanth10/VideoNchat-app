// Operational metrics in the Prometheus text format, kept dependency-free.
// Nothing here identifies a person or a room: only counts and timings.

const escape = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const labelText = (labels) => {
  const pairs = Object.entries(labels);
  return pairs.length ? `{${pairs.map(([k, v]) => `${k}="${escape(v)}"`).join(",")}}` : "";
};

class Counter {
  #values = new Map(); // label text -> value

  constructor(name, help) {
    this.name = name;
    this.help = help;
  }

  inc(labels = {}, by = 1) {
    const key = labelText(labels);
    this.#values.set(key, (this.#values.get(key) ?? 0) + by);
  }

  get(labels = {}) {
    return this.#values.get(labelText(labels)) ?? 0;
  }

  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [labels, value] of this.#values) lines.push(`${this.name}${labels} ${value}`);
    return lines.join("\n");
  }
}

class Histogram {
  #counts;
  #sum = 0;
  #count = 0;

  constructor(name, help, buckets) {
    this.name = name;
    this.help = help;
    this.buckets = buckets;
    this.#counts = buckets.map(() => 0);
  }

  observe(value) {
    this.buckets.forEach((bound, i) => {
      if (value <= bound) this.#counts[i] += 1;
    });
    this.#sum += value;
    this.#count += 1;
  }

  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    this.buckets.forEach((bound, i) => {
      lines.push(`${this.name}_bucket{le="${bound}"} ${this.#counts[i]}`);
    });
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.#count}`);
    lines.push(`${this.name}_sum ${Number(this.#sum.toFixed(3))}`);
    lines.push(`${this.name}_count ${this.#count}`);
    return lines.join("\n");
  }
}

const gauge = (name, help, value) =>
  [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`].join("\n");

// gauges() returns the current { rooms, participants, connections }.
function createMetrics({ gauges = () => ({}) } = {}) {
  const metrics = {
    joins: new Counter("videonchat_joins_total", "Join attempts, by result."),
    chatMessages: new Counter("videonchat_chat_messages_total", "Chat messages sent."),
    reactions: new Counter("videonchat_reactions_total", "Reactions sent."),
    knocks: new Counter("videonchat_knocks_total", "Requests to join a locked meeting."),
    peerConnections: new Counter(
      "videonchat_peer_connections_total",
      "Peer connections that connected, by whether they were relayed through TURN.",
    ),
    iceFailures: new Counter("videonchat_ice_failures_total", "Peer connections that failed."),
    firstVideo: new Histogram(
      "videonchat_time_to_first_video_seconds",
      "Time from someone appearing in a call to their first video frame.",
      [0.5, 1, 2, 3, 5, 10, 20, 60],
    ),
    clientErrors: new Counter("videonchat_client_errors_total", "Errors reported by browsers."),
    cspViolations: new Counter(
      "videonchat_csp_violations_total",
      "Content-Security-Policy violations reported by browsers, by directive.",
    ),
  };

  metrics.render = () => {
    const { rooms = 0, participants = 0, connections = 0 } = gauges();
    return `${[
      gauge("videonchat_rooms", "Rooms with someone in them.", rooms),
      gauge("videonchat_participants", "People in a room.", participants),
      gauge("videonchat_connections", "Open realtime connections.", connections),
      gauge(
        "process_uptime_seconds",
        "Seconds since the server started.",
        Math.round(process.uptime()),
      ),
      gauge(
        "process_resident_memory_bytes",
        "Resident memory of the server process.",
        process.memoryUsage().rss,
      ),
      ...Object.values(metrics)
        .filter((metric) => typeof metric?.render === "function")
        .map((metric) => metric.render()),
    ].join("\n")}\n`;
  };
  return metrics;
}

module.exports = { createMetrics, Counter, Histogram };
