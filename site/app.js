// nodemap page. Reads only the crawler's published files and shows nothing
// the crawler withheld: no per-node version, no cross-tabs, no graph. No
// library: the atlas is decoded and projected here, the chart is plain SVG.

const SCHEMA = 1;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const $ = (id) => document.getElementById(id);
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const fmt = (n) => n.toLocaleString("en-US");

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function getLines(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return [];
  const text = await r.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function countryName(code) {
  try { return regionNames.of(code) || code; } catch { return code; }
}

function showEmpty(why) {
  $("app").hidden = true;
  $("empty").hidden = false;
  if (why) $("empty-why").textContent = why;
}

// ---- tiles -----------------------------------------------------------------

function renderTiles(cur, history) {
  const observed = cur.public_nodes + cur.non_public_nodes;
  $("t-nodes").textContent = fmt(observed);
  const delta = weekDelta(history, observed);
  const sub = $("t-nodes-sub");
  if (delta === null) {
    sub.textContent = `${fmt(cur.public_nodes)} answer RPC`;
    sub.className = "sub";
  } else {
    const up = delta >= 0;
    sub.textContent = `${up ? "↗" : "↘"} ${pct(Math.abs(delta), 1)} vs last week`;
    sub.className = `sub ${up ? "up" : ""}`;
  }

  $("t-countries").textContent = fmt(Object.keys(cur.countries).length);

  const g = cur.graph;
  if (!g) {
    $("t-lcc").textContent = "—";
    $("t-lcc-sub").textContent = "below population floor";
    $("t-top").textContent = "—";
    $("t-top-sub").textContent = "below population floor";
    return;
  }
  $("t-lcc").textContent = pct(g.largest_component_fraction);
  const lcc = $("t-lcc-sub");
  lcc.title = `Share of the ${fmt(g.population)} observed nodes that sit in one connected mesh. ` +
    "Near 100% means every node can reach every other through peers; lower means the network is splitting.";
  if (g.largest_component_fraction >= 0.95) { lcc.textContent = "single healthy mesh"; lcc.className = "sub tip"; }
  else if (g.largest_component_fraction >= 0.8) { lcc.textContent = "mostly one mesh"; lcc.className = "sub tip warn"; }
  else { lcc.textContent = "fragmenting"; lcc.className = "sub tip bad"; }

  $("t-top-label").textContent = `Top-${g.top_n} peer share`;
  $("t-top").textContent = pct(g.top_n_share);
  const top = $("t-top-sub");
  top.title = `Share of all reported peer connections that land on the ${g.top_n} most-connected nodes. ` +
    "Low means connections are spread across many nodes; high means the mesh leans on a few hubs. " +
    "Measured from the peer lists of the nodes that answer RPC.";
  if (g.top_n_share < 0.25) { top.textContent = "low hub reliance"; top.className = "sub tip"; }
  else if (g.top_n_share < 0.5) { top.textContent = "moderate hub reliance"; top.className = "sub tip warn"; }
  else { top.textContent = "high hub reliance"; top.className = "sub tip bad"; }
}

// weekDelta compares the observed count with the line closest to seven days
// ago, only when the history really spans a week; otherwise null.
function weekDelta(history, observed) {
  if (history.length < 2) return null;
  const latest = new Date(history[history.length - 1].at).getTime();
  const target = latest - 7 * DAY;
  if (new Date(history[0].at).getTime() > target + 6 * HOUR) return null;
  let best = null;
  for (const line of history) {
    const t = new Date(line.at).getTime();
    if (best === null || Math.abs(t - target) < Math.abs(new Date(best.at).getTime() - target)) best = line;
  }
  const then = best.public_nodes + best.non_public_nodes;
  return then > 0 ? (observed - then) / then : null;
}

// ---- choropleth -------------------------------------------------------------

// decodeTopo turns a TopoJSON "countries" object into polygons of lon/lat.
function decodeTopo(topo) {
  const tf = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      if (tf) { x += dx; y += dy; return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]]; }
      return [dx, dy];
    });
  });
  const ring = (idx) => idx.flatMap((i, n) => {
    const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    return n === 0 ? a : a.slice(1);
  });
  const polygon = (rings) => rings.map(ring);
  return topo.objects.countries.geometries.map((g) => ({
    id: String(g.id),
    name: g.properties && g.properties.name,
    polygons: g.type === "Polygon" ? [polygon(g.arcs)] : g.type === "MultiPolygon" ? g.arcs.map(polygon) : [],
  }));
}

// Equirectangular, cropped to the inhabited latitudes; Antarctica is left
// out. The height keeps degrees square: 900 * 142 / 360.
const MAP = { w: 900, h: 355, latTop: 84, latBottom: -58 };
function project([lon, lat]) {
  const x = ((lon + 180) / 360) * MAP.w;
  const y = ((MAP.latTop - lat) / (MAP.latTop - MAP.latBottom)) * MAP.h;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

// splitAntimeridian cuts a ring wherever it jumps across 180° longitude,
// closing each piece along the edge, so Russia and Fiji do not become a
// line across the whole map.
function splitAntimeridian(ring) {
  const pieces = [];
  let piece = [];
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    if (piece.length) {
      const [plon, plat] = piece[piece.length - 1];
      if (Math.abs(lon - plon) > 180) {
        const edge = plon > 0 ? 180 : -180;
        const t = (edge - plon) / ((lon + (plon > 0 ? 360 : -360)) - plon);
        const cut = plat + (lat - plat) * t;
        piece.push([edge, cut]);
        pieces.push(piece);
        piece = [[-edge, cut]];
      }
    }
    piece.push([lon, lat]);
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

function pathFor(polygons) {
  return polygons.map((rings) => rings.map((ring) =>
    splitAntimeridian(ring).map((piece) => `M${piece.map(project).join("L")}Z`).join("")).join("")).join("");
}

function shade(t) {
  // light #e8eefb → deep #1e40af
  const a = [232, 238, 251], b = [30, 64, 175];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c.join(",")})`;
}

function renderMap(cur, atlas, isoA2) {
  const svg = $("map");
  svg.innerHTML = "";
  const byId = {};
  for (const [code, id] of Object.entries(isoA2)) byId[id] = code;
  const max = Math.max(1, ...Object.values(cur.countries));
  const frag = document.createDocumentFragment();
  for (const c of decodeTopo(atlas)) {
    if (c.id === "010") continue; // Antarctica
    const code = byId[c.id];
    const count = code ? cur.countries[code] || 0 : 0;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", pathFor(c.polygons));
    p.setAttribute("fill", count ? shade(Math.sqrt(count / max)) : "#f1f3f6");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${code ? countryName(code) : c.name || c.id}: ${fmt(count)} node${count === 1 ? "" : "s"}`;
    p.appendChild(title);
    frag.appendChild(p);
  }
  svg.appendChild(frag);
  $("legend-max").textContent = `${fmt(max)}+ nodes`;
}

// ---- bar lists --------------------------------------------------------------

function bar(label, share, value, title) {
  const li = document.createElement("li");
  if (title) li.title = title;
  li.innerHTML = `<span></span><span class="track"><span class="fill"></span></span><span class="value"></span>`;
  li.children[0].textContent = label;
  li.children[1].firstChild.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  li.children[2].textContent = value;
  return li;
}

function renderCountries(cur) {
  const observed = cur.public_nodes + cur.non_public_nodes;
  const list = $("countries");
  list.innerHTML = "";
  const rows = Object.entries(cur.countries).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const top = rows.length ? rows[0][1] : 1;
  for (const [code, n] of rows) {
    list.appendChild(bar(countryName(code), n / top, pct(n / observed), `${fmt(n)} nodes`));
  }
}

// renderASNs shows where nodes are and, when the crawler published it, where
// the connections are: a provider hosting a fifth of the nodes but two fifths
// of the reported connections carries more of the mesh than its node count says.
function renderASNs(cur) {
  const observed = cur.public_nodes + cur.non_public_nodes;
  const list = $("asns");
  list.innerHTML = "";
  const rows = cur.asns.slice(0, 5);
  const hasConn = cur.asns.some((r) => typeof r.connection_share === "number");
  const listed = cur.asns.reduce((s, r) => s + r.nodes, 0);
  const listedConn = cur.asns.reduce((s, r) => s + (r.connection_share || 0), 0);
  const top = rows.length ? rows[0].nodes : 1;
  const value = (nodes, conn) => hasConn ? `${fmt(nodes)} · ${pct(conn)}` : fmt(nodes);
  for (const r of rows) {
    const title = hasConn
      ? `AS${r.asn}: ${fmt(r.nodes)} nodes, ${pct(r.connection_share || 0)} of reported connections`
      : `AS${r.asn}`;
    list.appendChild(bar(r.org || `AS${r.asn}`, r.nodes / top, value(r.nodes, r.connection_share || 0), title));
  }
  const other = observed - listed;
  if (other > 0) {
    list.appendChild(bar("Other", other / top, value(other, Math.max(0, 1 - listedConn)),
      "nodes outside the listed ASNs, and their share of reported connections"));
  }
  const top3 = cur.asns.slice(0, 3);
  const nodes3 = top3.reduce((s, r) => s + r.share, 0);
  const conn3 = top3.reduce((s, r) => s + (r.connection_share || 0), 0);
  $("asn-callout").textContent = !cur.asns.length ? ""
    : hasConn ? `⚠ ${pct(nodes3)} of nodes and ${pct(conn3)} of connections on top 3 providers`
      : `⚠ ${pct(nodes3)} on top 3 providers`;
}

// ---- adoption chart --------------------------------------------------------

// windowFor picks the window and bucket from how much history exists.
function windowFor(spanMs) {
  if (spanMs < 12 * HOUR) return null;
  if (spanMs < 7 * DAY) return { window: spanMs, bucket: HOUR };
  if (spanMs < 90 * DAY) return { window: 30 * DAY, bucket: 6 * HOUR };
  return { window: 365 * DAY, bucket: DAY };
}

// renderAdoption draws one block per version panel the crawler published:
// the client (CometBFT) version always, the application version when the
// data carries it. Each block is the dominant version's share over time.
function renderAdoption(cur, history) {
  const box = $("adoption");
  box.innerHTML = "";
  renderAdoptionBlock(box, "Client (CometBFT)", cur.versions, history, "version_shares");
  if (cur.app_versions || history.some((l) => l.app_version_shares)) {
    renderAdoptionBlock(box, "Application", cur.app_versions, history, "app_version_shares");
  }
}

function renderAdoptionBlock(box, title, adoption, history, key) {
  const block = document.createElement("section");
  block.className = "adoption-block";
  block.innerHTML = `<h3></h3>`;
  block.firstChild.textContent = title;
  box.appendChild(block);
  const note = (text) => {
    const p = document.createElement("p");
    p.className = "gathering";
    p.textContent = text;
    block.appendChild(p);
  };
  const shares = adoption && adoption.shares;
  if (!shares) { note("Withheld: population below the floor."); return; }
  const dominant = Object.entries(shares).filter(([v]) => v !== "other").sort((a, b) => b[1] - a[1])[0];
  if (!dominant) { note("No release version reported by enough nodes."); return; }
  const [version] = dominant;
  const series = history
    .filter((l) => l[key] && version in l[key])
    .map((l) => ({ t: new Date(l.at).getTime(), v: l[key][version] }));
  if (series.length < 2) { note("Gathering data — first points appear after a few cycles."); return; }
  const span = series[series.length - 1].t - series[0].t;
  const win = windowFor(span);
  if (!win) { note(`Gathering data — ${Math.round(span / HOUR)} h of history, the chart starts at 12 h.`); return; }
  const end = series[series.length - 1].t;
  const start = end - win.window;
  const buckets = new Map();
  for (const p of series) {
    if (p.t < start) continue;
    const k = Math.floor(p.t / win.bucket) * win.bucket;
    const b = buckets.get(k) || { sum: 0, n: 0 };
    b.sum += p.v; b.n += 1;
    buckets.set(k, b);
  }
  const pts = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => ({ t, v: b.sum / b.n }));
  block.appendChild(chart(pts, version, win));
}

function chart(pts, version, win) {
  const W = 880, H = 220, L = 44, R = 12, T = 14, B = 30;
  const x0 = pts[0].t, x1 = pts[pts.length - 1].t;
  const sx = (t) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const sy = (v) => T + (1 - v) * (H - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join("");
  const area = `${line}L${sx(x1).toFixed(1)},${sy(0)}L${sx(x0).toFixed(1)},${sy(0)}Z`;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) =>
    `<line class="axis" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${pct(v)}</text>`).join("");
  const labelFmt = win.bucket >= DAY
    ? (t) => new Date(t).toLocaleDateString("en-US", { month: "short" })
    : win.bucket >= 6 * HOUR
      ? (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric" });
  const n = Math.min(6, pts.length);
  const xt = [];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.round((i * (pts.length - 1)) / Math.max(1, n - 1))];
    xt.push(`<text x="${sx(p.t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${labelFmt(p.t)}</text>`);
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `share of nodes on ${version} over time`);
  const latest = pts[pts.length - 1].v;
  svg.innerHTML = `${ticks}<path class="area" d="${area}"/><path class="line" d="${line}"/>${xt.join("")}` +
    `<text x="${W - R}" y="${T}" text-anchor="end">${version} · ${pct(latest, 1)}</text>`;
  return svg;
}

// ---- endpoints -------------------------------------------------------------

// A node is "Archive" relative to its chain: its earliest block is the
// lowest any public node of the chain reports. Chain-ids rarely start at
// block 1 (cosmoshub-4 begins where the Hub upgraded), so an absolute rule
// would call every archive pruned. The tooltip carries the actual height.
function renderEndpoints(cur, state) {
  const body = $("endpoints");
  body.innerHTML = "";
  const live = new Set(cur.directory.map((r) => r.endpoint));
  const heights = cur.directory.map((r) => r.earliest_block_height).filter((h) => h > 0);
  const floor = heights.length ? Math.min(...heights) : 0;
  const rows = cur.directory.map((r) => ({
    endpoint: r.endpoint,
    country: r.country ? countryName(r.country) : "—",
    mode: r.earliest_block_height <= 0 ? "—" : r.earliest_block_height === floor ? "Archive" : "Pruned",
    modeTitle: r.earliest_block_height > 0
      ? `earliest block ${fmt(r.earliest_block_height)}; the chain's lowest seen is ${fmt(floor)}`
      : "the node reports no earliest block (state-synced)",
    status: "Live",
  }));
  if (state && state.endpoints) {
    for (const ep of Object.keys(state.endpoints)) {
      if (!live.has(ep)) rows.push({ endpoint: ep, country: "—", mode: "—", modeTitle: "", status: "Down" });
    }
  }
  rows.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td></td><td class="${r.status === "Live" ? "live" : "down"}"></td>`;
    [r.endpoint, r.country, r.mode, r.status].forEach((v, i) => { tr.children[i].textContent = v; });
    if (r.modeTitle) {
      tr.children[2].title = r.modeTitle;
      tr.children[2].className = "tip";
    }
    body.appendChild(tr);
  }
}

function renderCrawled(cur) {
  const ago = Date.now() - new Date(cur.crawled_at).getTime();
  const min = Math.max(0, Math.round(ago / 60000));
  $("crawled").textContent = min < 90 ? `Crawled ${min} min ago` : `Crawled ${Math.round(min / 60)} h ago`;
}

// ---- main ------------------------------------------------------------------

async function load(chain, atlas, isoA2) {
  let cur;
  try { cur = await getJSON(`${chain}/current.json`); } catch { showEmpty(); return; }
  if (cur.schema_version !== SCHEMA) {
    showEmpty(`This page reads schema version ${SCHEMA}; the data is version ${cur.schema_version}.`);
    return;
  }
  const [history, state] = await Promise.all([
    getLines(`${chain}/history.jsonl`),
    getJSON(`${chain}/directory-state.json`).catch(() => null),
  ]);
  $("empty").hidden = true;
  $("app").hidden = false;
  renderTiles(cur, history);
  renderMap(cur, atlas, isoA2);
  renderCountries(cur);
  renderASNs(cur);
  renderAdoption(cur, history);
  renderEndpoints(cur, state);
  renderCrawled(cur);
}

async function main() {
  const [chains, atlas, isoA2] = await Promise.all([
    getJSON("chains.json").catch(() => []),
    getJSON("world.topo.json"),
    getJSON("iso-a2.json"),
  ]);
  const select = $("chain");
  if (!chains.length) { select.hidden = true; showEmpty(); return; }
  for (const c of chains) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    select.appendChild(o);
  }
  const fromHash = location.hash.slice(1);
  select.value = chains.includes(fromHash) ? fromHash : chains[0];
  select.addEventListener("change", () => { location.hash = select.value; load(select.value, atlas, isoA2); });
  await load(select.value, atlas, isoA2);
}

main().catch((e) => showEmpty(`Could not load the page: ${e.message}`));