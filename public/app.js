/* OpenCode Go — usage vs intelligence.
 * Plain JS + hand-drawn SVG. No build step, no dependencies.
 */

const state = {
  plan: "go",
  metric: "requests",
};

const METRICS = {
  requests: {
    log: true,
    title: "Estimated requests per month",
    sub: "OpenCode’s published request estimates · log scale · higher is better",
    axis: "Requests / month",
    value: (plan) => plan.monthlyRequests,
    format: (value) => formatCompact(value),
  },
  limit: {
    log: false,
    title: "Included usage per month",
    sub: "Monthly allowance in US dollars · higher is better",
    axis: "Included / month (USD)",
    value: (plan) => plan.monthlyLimit,
    format: (value) => `$${formatCompact(value)}`,
  },
};

const numberFormat = new Intl.NumberFormat("en-NZ");
const dateFormat = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "medium",
  timeStyle: "short",
});

const NS = "http://www.w3.org/2000/svg";
const chartEl = document.getElementById("chart");
const chartWrap = document.getElementById("chart-wrap");
const tooltip = document.getElementById("tooltip");
const metaEl = document.getElementById("meta");
const noteEl = document.getElementById("chart-note");
const titleEl = document.getElementById("chart-title");
const subEl = document.getElementById("chart-sub");
const frontBody = document.getElementById("front-body");
const unlistedCard = document.getElementById("unlisted-card");
const unlistedEl = document.getElementById("unlisted");

let DATA = null;
let drawQueued = false;

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function formatCompact(value) {
  if (value == null) return "—";
  if (typeof value === "string") return value === "unlimited" ? "Unlimited" : value;
  if (value >= 1_000_000) {
    return `${trimZero(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${trimZero(value / 1_000)}k`;
  }
  return numberFormat.format(value);
}

function trimZero(value) {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function formatUsage(value) {
  return value === "unlimited" ? "Unlimited" : numberFormat.format(value);
}

function formatLimit(value) {
  return value === "unlimited" ? "Unlimited" : `$${numberFormat.format(value)}`;
}

function formatPrice(value) {
  if (value == null) return "—";
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function rowsForState() {
  if (!DATA) return [];
  const metric = METRICS[state.metric];
  return DATA.models
    .map((model) => {
      const plan = model[state.plan] ?? model.go;
      if (!plan) return null;
      const raw = metric.value(plan);
      const unlimited = raw === "unlimited";
      const usage = unlimited ? null : Number(raw);
      const score = model.aa?.intelligence;
      if (!Number.isFinite(score)) return null;
      if (!unlimited && !Number.isFinite(usage)) return null;
      return { model, plan, score, usage, unlimited, front: false };
    })
    .filter(Boolean);
}

function markPareto(rows) {
  // Maximise both usage and score. Unlimited usage is treated as +Infinity,
  // then walk from most usage to least, keeping points that set a new high score.
  const usageOf = (row) => (row.unlimited ? Infinity : row.usage);
  const sorted = [...rows].sort((a, b) => {
    const usageA = usageOf(a);
    const usageB = usageOf(b);
    if (usageA !== usageB) return usageB - usageA;
    return b.score - a.score;
  });

  let best = -Infinity;
  for (const row of sorted) {
    if (row.score > best + 1e-9) {
      row.front = true;
      best = row.score;
    }
  }

  return sorted.filter((row) => row.front);
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

function tickValues(min, max, log) {
  if (!log) {
    const span = max - min;
    const rough = span / 5;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step =
      [1, 2, 2.5, 5, 10].map((multiplier) => multiplier * magnitude).find(
        (candidate) => candidate >= rough
      ) ?? rough;
    const ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) {
      ticks.push(Math.round(value * 1000) / 1000);
    }
    return ticks;
  }

  const ticks = [];
  const start = Math.floor(Math.log10(min));
  const end = Math.ceil(Math.log10(max));
  for (let exponent = start; exponent <= end; exponent += 1) {
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * 10 ** exponent;
      if (value >= min && value <= max) ticks.push(value);
    }
  }
  return ticks;
}

function svgElement(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, String(value));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function draw() {
  if (!DATA) return;
  const metric = METRICS[state.metric];
  const rows = rowsForState();
  const front = markPareto(rows);

  titleEl.textContent = metric.title;
  subEl.textContent = metric.sub;

  renderFrontTable(front);
  renderNote(rows, front);

  const width = Math.max(320, chartEl.clientWidth || 900);
  const height = Math.round(Math.min(560, Math.max(400, width * 0.58)));
  const margin = {
    top: 26,
    right: width < 620 ? 92 : 122,
    bottom: 58,
    left: width < 620 ? 48 : 58,
  };
  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;

  const finite = rows.filter((row) => !row.unlimited);
  if (!finite.length) {
    chartEl.innerHTML = '<p class="state">No matched models for this selection.</p>';
    return;
  }

  const maxFinite = Math.max(...finite.map((row) => row.usage));
  const minFinite = Math.min(...finite.map((row) => row.usage));
  const hasUnlimited = rows.some((row) => row.unlimited);

  let domainMin;
  let domainMax;
  let unlimitedX = null;

  if (metric.log) {
    domainMin = Math.max(1, minFinite / 1.7);
    if (hasUnlimited) {
      unlimitedX = maxFinite * 2.5;
      domainMax = unlimitedX * 1.35;
    } else {
      domainMax = maxFinite * 1.5;
    }
  } else {
    domainMin = 0;
    if (hasUnlimited) {
      domainMax = maxFinite * 1.3;
      unlimitedX = domainMax * 0.94;
    } else {
      domainMax = maxFinite * 1.15;
    }
  }

  const log = metric.log;
  const xScale = (value) => {
    if (log) {
      const lo = Math.log10(domainMin);
      const hi = Math.log10(domainMax);
      return plotLeft + ((Math.log10(value) - lo) / (hi - lo)) * (plotRight - plotLeft);
    }
    return plotLeft + ((value - domainMin) / (domainMax - domainMin)) * (plotRight - plotLeft);
  };

  const maxScore = Math.max(...rows.map((row) => row.score));
  const yMax = Math.max(10, Math.ceil((maxScore + 2) / 10) * 10);
  const yScale = (value) =>
    plotBottom - (value / yMax) * (plotBottom - plotTop);

  chartEl.replaceChildren();
  const svg = svgElement(
    "svg",
    {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `Scatter plot of ${rows.length} OpenCode Go models by included usage and Artificial Analysis intelligence. ${front.length} models are on the Pareto front.`,
    },
    chartEl
  );

  // Y grid + labels
  for (let score = 0; score <= yMax; score += 10) {
    const y = yScale(score);
    svgElement(
      "line",
      {
        x1: plotLeft,
        x2: plotRight,
        y1: y,
        y2: y,
        stroke: "var(--grid)",
        "stroke-width": 1,
      },
      svg
    );
    svgElement(
      "text",
      {
        x: plotLeft - 10,
        y: y + 4,
        "text-anchor": "end",
        class: "tick-label",
      },
      svg
    ).textContent = score;
  }

  // X grid + labels
  const ticks = tickValues(domainMin, domainMax, log);
  for (const value of ticks) {
    if (unlimitedX != null && Math.abs(value - unlimitedX) / unlimitedX < 0.24) continue;
    const x = xScale(value);
    svgElement(
      "line",
      {
        x1: x,
        x2: x,
        y1: plotTop,
        y2: plotBottom,
        stroke: "var(--grid)",
        "stroke-width": 1,
      },
      svg
    );
    svgElement(
      "text",
      {
        x,
        y: plotBottom + 18,
        "text-anchor": "middle",
        class: "tick-label",
      },
      svg
    ).textContent = metric.format(value);
  }

  if (unlimitedX != null) {
    const x = xScale(unlimitedX);
    svgElement(
      "line",
      {
        x1: x,
        x2: x,
        y1: plotTop,
        y2: plotBottom,
        stroke: "var(--grid)",
        "stroke-width": 1,
        "stroke-dasharray": "3 4",
      },
      svg
    );
    svgElement(
      "text",
      { x, y: plotBottom + 18, "text-anchor": "middle", class: "tick-label" },
      svg
    ).textContent = "∞";
  }

  // Axis titles
  svgElement(
    "text",
    {
      x: (plotLeft + plotRight) / 2,
      y: height - 8,
      "text-anchor": "middle",
      class: "axis-title",
    },
    svg
  ).textContent = metric.axis;

  svgElement(
    "text",
    {
      x: 13,
      y: (plotTop + plotBottom) / 2,
      "text-anchor": "middle",
      transform: `rotate(-90 13 ${(plotTop + plotBottom) / 2})`,
      class: "axis-title",
    },
    svg
  ).textContent = "AA intelligence index";

  // Pareto staircase
  const frontPoints = front
    .slice()
    .sort((a, b) => {
      const ax = a.unlimited ? Infinity : a.usage;
      const bx = b.unlimited ? Infinity : b.usage;
      return ax - bx || a.score - b.score;
    });

  if (frontPoints.length > 1) {
    // Upper-right boundary: the most usage available at each intelligence level.
    // Sorted left-to-right by usage, the front steps downwards.
    const at = (row) => ({
      x: xScale(row.unlimited ? unlimitedX : row.usage),
      y: yScale(row.score),
    });
    let path = `M${plotLeft.toFixed(1)},${at(frontPoints[0]).y.toFixed(1)}`;
    for (let index = 1; index < frontPoints.length; index += 1) {
      const previous = at(frontPoints[index - 1]);
      const current = at(frontPoints[index]);
      path += `H${previous.x.toFixed(1)}V${current.y.toFixed(1)}`;
    }
    path += `H${at(frontPoints[frontPoints.length - 1]).x.toFixed(1)}`;
    svgElement("path", { d: path, class: "frontier" }, svg);
  }

  const positioned = [];
  for (const row of rows) {
    if (row.unlimited && unlimitedX == null) continue;
    const x = xScale(row.unlimited ? unlimitedX : row.usage);
    const y = yScale(row.score);
    positioned.push({ row, x, y });
  }

  // Draw non-front points first so the front sits on top.
  positioned.sort((a, b) => Number(a.row.front) - Number(b.row.front));

  for (const { row, x, y } of positioned) {
    const group = svgElement(
      "g",
      {
        class: `point ${row.front ? "front" : "other"}${row.unlimited ? " unlimited" : ""}`,
        tabindex: 0,
        role: "button",
        "aria-label": `${row.model.name}, intelligence ${row.score.toFixed(
          1
        )}, ${formatUsage(row.plan.monthlyRequests)} requests per month${
          row.front ? ", Pareto front" : ""
        }`,
      },
      svg
    );

    svgElement("circle", { cx: x, cy: y, r: 13, class: "halo" }, group);
    svgElement(
      "circle",
      { cx: x, cy: y, r: row.front ? 6 : 5, class: "mark" },
      group
    );

    group.addEventListener("pointerenter", (event) => showTooltip(row, event));
    group.addEventListener("pointermove", (event) => moveTooltip(event));
    group.addEventListener("pointerleave", hideTooltip);
    group.addEventListener("focus", () => showTooltipAt(row, x, y));
    group.addEventListener("blur", hideTooltip);
  }

  // Labels for frontier points, with a small greedy collision nudge.
  const labels = frontPoints.map((row) => {
    const x = xScale(row.unlimited ? unlimitedX : row.usage);
    const y = yScale(row.score);
    return { row, x, y, anchor: x > plotRight - 105 ? "end" : "start" };
  });
  const placed = [];
  labels.sort((a, b) => a.y - b.y);
  for (const label of labels) {
    let labelY = label.y - 11;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const collides = placed.some(
        (other) =>
          Math.abs(other.labelY - labelY) < 13 &&
          Math.abs(other.x - label.x) < 170
      );
      if (!collides) break;
      labelY += 13;
    }
    placed.push({ ...label, labelY });
    const text = svgElement(
      "text",
      {
        x: label.anchor === "end" ? label.x - 10 : label.x + 10,
        y: labelY,
        "text-anchor": label.anchor,
        class: "point-label",
      },
      svg
    );
    text.textContent = label.row.model.name;
  }
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

function tooltipHtml(row) {
  const model = row.model;
  const aa = model.aa;
  const plan = row.plan;
  const notes = model.notes?.length ? model.notes.join(" · ") : null;
  const variant = aa.name && aa.name !== model.name ? aa.name : null;

  return `
    <div class="tt-title">${escapeHtml(model.name)}</div>
    ${variant ? `<div class="tt-sub">AA: ${escapeHtml(variant)}</div>` : ""}
    <div class="tt-grid">
      <span>Intelligence</span><b>${aa.intelligence.toFixed(1)}</b>
      <span>Requests / month</span><b>${formatUsage(plan.monthlyRequests)}</b>
      <span>Included usage</span><b>${formatLimit(plan.monthlyLimit)}</b>
      <span>Price / 1M</span><b>${formatPrice(model.input)} in · ${formatPrice(model.output)} out</b>
      <span>Creator</span><b>${escapeHtml(aa.creator ?? "—")}</b>
    </div>
    ${row.front ? '<span class="tt-badge">Pareto front</span>' : ""}
    ${notes ? `<div class="tt-note">${escapeHtml(notes)}</div>` : ""}
  `;
}

function showTooltip(row, event) {
  tooltip.innerHTML = tooltipHtml(row);
  tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const wrapRect = chartWrap.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;

  let left = event.clientX - wrapRect.left + 16;
  if (left + width > wrapRect.width - 8) {
    left = event.clientX - wrapRect.left - width - 16;
  }
  left = Math.max(8, Math.min(left, wrapRect.width - width - 8));

  let top = event.clientY - wrapRect.top - 12;
  if (top - height < 0) top = event.clientY - wrapRect.top + 22 + height;
  top = Math.min(top, wrapRect.height - 8);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTooltipAt(row, x, y) {
  const wrapRect = chartWrap.getBoundingClientRect();
  showTooltip(row, {
    clientX: wrapRect.left + x,
    clientY: wrapRect.top + y,
  });
}

function hideTooltip() {
  tooltip.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Table + meta                                                        */
/* ------------------------------------------------------------------ */

function renderFrontTable(front) {
  const rows = front
    .slice()
    .sort((a, b) => b.score - a.score || b.usage - a.usage);

  if (!rows.length) {
    frontBody.innerHTML = '<tr><td colspan="4">No frontier models.</td></tr>';
    return;
  }

  frontBody.innerHTML = rows
    .map((row, index) => {
      const model = row.model;
      const aa = model.aa;
      const notes = model.notes?.length ? model.notes.join(" · ") : null;
      const variant = aa.name && aa.name !== model.name ? `AA: ${aa.name}` : null;
      return `
        <tr>
          <td>
            <span class="rank">${index + 1}</span><span class="model-name">${escapeHtml(
        model.name
      )}</span>
            ${variant ? `<span class="model-aa">${escapeHtml(variant)}</span>` : ""}
            ${notes ? `<span class="promo">${escapeHtml(notes)}</span>` : ""}
          </td>
          <td class="num"><span class="score">${aa.intelligence.toFixed(1)}</span></td>
          <td class="num">${formatUsage(row.plan.monthlyRequests)}</td>
          <td class="num">${formatLimit(row.plan.monthlyLimit)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderUnlisted() {
  const names = [...(DATA.unmatched ?? [])].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );

  if (!names.length) {
    unlistedCard.hidden = true;
    unlistedEl.innerHTML = "";
    return;
  }

  unlistedEl.innerHTML = names
    .map((name) => `<li class="chip">${escapeHtml(name)}</li>`)
    .join("");
  unlistedCard.hidden = false;
}

function renderNote(rows, front) {
  const matched = DATA.models.length;
  const unmatched = DATA.unmatched?.length ?? 0;
  const unlimited = rows.filter((row) => row.unlimited).length;
  const parts = [
    `<em>${matched}</em> matched models plotted · <em>${front.length}</em> on the Pareto front`,
  ];
  if (unmatched) {
    parts.push(
      `${unmatched} Go model${unmatched === 1 ? "" : "s"} without an AA score listed below`
    );
  }
  if (unlimited) parts.push("∞ = unlimited free model");
  noteEl.innerHTML = `${parts.join(" · ")}.`;
}

function renderMeta() {
  const matched = DATA.models.length;
  const total = matched + (DATA.unmatched?.length ?? 0);
  const updated = new Date(DATA.generatedAt);
  metaEl.textContent = `Updated ${dateFormat.format(updated)} · ${matched} of ${total} Go models matched to Artificial Analysis`;
}

/* ------------------------------------------------------------------ */
/* Controls + boot                                                     */
/* ------------------------------------------------------------------ */

function syncControls() {
  for (const button of document.querySelectorAll("[data-plan]")) {
    button.setAttribute("aria-pressed", String(button.dataset.plan === state.plan));
  }
  for (const button of document.querySelectorAll("[data-metric]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.metric === state.metric)
    );
  }
}

function readUrlState() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (["go", "go-plus"].includes(params.get("plan"))) state.plan = params.get("plan");
  if (["requests", "limit"].includes(params.get("metric"))) {
    state.metric = params.get("metric");
  }
}

function writeUrlState() {
  const params = new URLSearchParams({ plan: state.plan, metric: state.metric });
  history.replaceState(null, "", `#${params.toString()}`);
}

document.getElementById("plan-control").addEventListener("click", (event) => {
  const button = event.target.closest("[data-plan]");
  if (!button || button.dataset.plan === state.plan) return;
  state.plan = button.dataset.plan;
  syncControls();
  writeUrlState();
  draw();
});

document.getElementById("metric-control").addEventListener("click", (event) => {
  const button = event.target.closest("[data-metric]");
  if (!button || button.dataset.metric === state.metric) return;
  state.metric = button.dataset.metric;
  syncControls();
  writeUrlState();
  draw();
});

window.addEventListener("resize", () => {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
});

async function boot() {
  readUrlState();
  syncControls();
  try {
    const response = await fetch(`./data/latest.json?_=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    DATA = await response.json();
    renderMeta();
    renderUnlisted();
    draw();
  } catch (error) {
    metaEl.textContent = "Could not load data.";
    chartEl.innerHTML = `<p class="state"><strong>Data unavailable.</strong><br />${escapeHtml(
      error.message
    )}</p>`;
    noteEl.textContent = "";
  }
}

boot();
