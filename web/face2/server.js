const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const BUILDING_ID = "1";
const REAL_ROOM_ID = "302";
const REAL_DEVICE_ID = "esp32s3_test";
const PRODUCT_NAME = "寓安芯 寝室安全终端";

function makeRooms() {
  return Array.from({ length: 15 }, (_, index) => {
    const floor = Math.floor(index / 5) + 1;
    const room = `${floor}${String((index % 5) + 1).padStart(2, "0")}`;
    const isReal = room === REAL_ROOM_ID;
    return {
      room_id: room,
      floor_id: String(floor),
      building_id: BUILDING_ID,
      device_id: isReal ? REAL_DEVICE_ID : `DEMO-B${BUILDING_ID}-F${floor}-R${room}`,
      deployment_mode: isReal ? "real" : "demo",
      status: isReal ? "online" : "demo-ready",
    };
  });
}

const rooms = makeRooms();

const state = {
  thresholds: {
    smoke_ppm: 320,
    temperature: 55,
    temp_rise_rate: 8,
    current_rms: 5.5,
  },
  devices: [
    {
      device_id: REAL_DEVICE_ID,
      product_name: PRODUCT_NAME,
      room_id: REAL_ROOM_ID,
      building_id: BUILDING_ID,
      floor_id: REAL_ROOM_ID.slice(0, 1),
      deployment_mode: "real",
      status: "online",
      last_seen: new Date().toISOString(),
    },
  ],
  telemetry: {},
  alerts: [],
  notifications: [],
  commands: [],
};

const roomBindings = Object.fromEntries(
  rooms.map((room) => [
    room.room_id,
    {
      students: [
        { name: `${room.room_id}A同学`, phone: `student-${room.room_id}-a` },
        { name: `${room.room_id}B同学`, phone: `student-${room.room_id}-b` },
      ],
      managers: [{ name: `${room.floor_id}层宿管`, phone: `manager-floor-${room.floor_id}` }],
    },
  ]),
);

function buildFloorGraph(floorId) {
  const floor = String(floorId || "3");
  const nodes = {};
  const edges = [];
  const ys = [14, 32, 50, 68, 86];
  const floorRooms = Array.from({ length: 5 }, (_, index) => `${floor}${String(index + 1).padStart(2, "0")}`);

  floorRooms.forEach((room, index) => {
    const y = ys[index];
    nodes[`R${room}`] = { label: `${room}寝室`, x: 14, y, type: "room", room_id: room };
    nodes[`H${room}`] = { label: `${room}门口`, x: 34, y, type: "hall" };
    nodes[`C${room}`] = { label: "走廊", x: 54, y, type: "hall", quiet: true };
    edges.push([`R${room}`, `H${room}`, 1], [`H${room}`, `C${room}`, 1]);
    if (index > 0) edges.push([`C${floorRooms[index - 1]}`, `C${room}`, 1]);
  });

  nodes[`F${floor}S1`] = { label: "西侧楼梯", x: 74, y: 14, type: "stair" };
  nodes[`F${floor}S2`] = { label: "东侧楼梯", x: 74, y: 86, type: "stair" };
  nodes[`F${floor}E1`] = { label: floor === "1" ? "安全出口A" : "向下疏散", x: 90, y: 14, type: floor === "1" ? "exit" : "exit" };
  nodes[`F${floor}E2`] = { label: floor === "1" ? "安全出口B" : "向下疏散", x: 90, y: 86, type: floor === "1" ? "exit" : "exit" };
  edges.push([`C${floorRooms[0]}`, `F${floor}S1`, 2], [`F${floor}S1`, `F${floor}E1`, 1]);
  edges.push([`C${floorRooms[4]}`, `F${floor}S2`, 2], [`F${floor}S2`, `F${floor}E2`, 1]);
  return { nodes, edges };
}

function buildGraph() {
  const graph = { nodes: {}, edges: [] };
  for (const floor of ["1", "2", "3"]) {
    const floorGraph = buildFloorGraph(floor);
    Object.assign(graph.nodes, floorGraph.nodes);
    graph.edges.push(...floorGraph.edges);
  }
  return graph;
}

const graph = buildGraph();

function initTelemetry() {
  const now = new Date().toISOString();
  state.telemetry[REAL_DEVICE_ID] = {
    device_id: REAL_DEVICE_ID,
    room_id: REAL_ROOM_ID,
    building_id: BUILDING_ID,
    floor_id: REAL_ROOM_ID.slice(0, 1),
    deployment_mode: "real",
    source: "real",
    smoke_ppm: 32,
    temperature: 26.2,
    humidity: 55.0,
    temp_rise_rate: 0.2,
    flame_intensity: 0,
    current_rms: 0.9,
    appliance_type: "normal",
    fire_level: 0,
    ts: now,
  };
}

function roomById(roomId) {
  return rooms.find((room) => room.room_id === String(roomId));
}

function roomByDevice(deviceId) {
  return rooms.find((room) => room.device_id === String(deviceId)) || (String(deviceId) === REAL_DEVICE_ID ? roomById(REAL_ROOM_ID) : null);
}

function classifyFire(payload) {
  if (
    payload.fire_level === 2 ||
    payload.flame_intensity >= 65 ||
    payload.temperature >= state.thresholds.temperature ||
    payload.temp_rise_rate >= state.thresholds.temp_rise_rate
  ) {
    return 2;
  }
  if (payload.fire_level === 1 || payload.smoke_ppm >= state.thresholds.smoke_ppm) return 1;
  return 0;
}

function classifyAppliance(payload) {
  if (payload.appliance_type && payload.appliance_type !== "normal") return payload.appliance_type;
  if (payload.current_rms >= 7.5) return "电热锅";
  if (payload.current_rms >= 6.2) return "热得快";
  if (payload.current_rms >= state.thresholds.current_rms) return "电热毯";
  return "normal";
}

function normalizeTelemetry(raw = {}, source = "real") {
  const room = roomById(raw.room_id) || roomByDevice(raw.device_id) || roomById(REAL_ROOM_ID);
  const isReal = source === "real" || room.deployment_mode === "real";
  const deviceId = isReal ? REAL_DEVICE_ID : room.device_id;
  const current = state.telemetry[deviceId] || {};
  const payload = {
    ...current,
    ...raw,
    device_id: deviceId,
    room_id: room.room_id,
    building_id: room.building_id,
    floor_id: room.floor_id,
    deployment_mode: room.deployment_mode,
    source,
    smoke_ppm: Number(raw.smoke_ppm ?? current.smoke_ppm ?? 0),
    temperature: Number(raw.temperature ?? current.temperature ?? 0),
    humidity: Number(raw.humidity ?? current.humidity ?? 0),
    temp_rise_rate: Number(raw.temp_rise_rate ?? current.temp_rise_rate ?? 0),
    flame_intensity: Number(raw.flame_intensity ?? current.flame_intensity ?? 0),
    current_rms: Number(raw.current_rms ?? current.current_rms ?? 0),
    ts: new Date().toISOString(),
  };

  payload.fire_level = classifyFire(payload);
  payload.appliance_type = classifyAppliance(payload);
  state.telemetry[deviceId] = payload;

  if (isReal) {
    const device = state.devices[0];
    device.status = "online";
    device.last_seen = payload.ts;
  }
  return payload;
}

function createAlert(type, telemetry, source = "real") {
  const alert = {
    id: crypto.randomUUID(),
    type,
    source,
    severity: type === "fire_alarm" ? "critical" : type === "fire_warning" ? "warning" : "notice",
    room_id: telemetry.room_id,
    device_id: telemetry.device_id,
    title: type === "fire_alarm" ? "明火告警" : type === "fire_warning" ? "烟雾预警" : "违规电器告警",
    status: "active",
    telemetry,
    route: type === "illegal_appliance_alarm" ? null : computeEscapeRoute(telemetry.room_id),
    created_at: new Date().toISOString(),
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 80);
  pushNotifications(alert);
  return alert;
}

function pushNotifications(alert) {
  const binding = roomBindings[alert.room_id] || { students: [], managers: [] };
  const recipients = alert.type === "illegal_appliance_alarm" ? [...binding.managers, ...binding.students] : [...binding.students, ...binding.managers];
  const sourceText = alert.source === "demo" ? "演示场景" : "真实设备";
  const message =
    alert.type === "illegal_appliance_alarm"
      ? `${alert.room_id}寝室疑似使用${alert.telemetry.appliance_type}，来源：${sourceText}，请宿管核查。`
      : `${alert.room_id}寝室${alert.title}，来源：${sourceText}，建议按安全路线疏散：${alert.route?.summary || "等待路径生成"}`;

  for (const recipient of recipients) {
    state.notifications.unshift({
      id: crypto.randomUUID(),
      alert_id: alert.id,
      channel: "prototype-push",
      recipient: recipient.name,
      target: recipient.phone,
      message,
      created_at: new Date().toISOString(),
    });
  }
  state.notifications = state.notifications.slice(0, 120);
}

function computeEscapeRoute(roomId) {
  const start = `R${roomId}`;
  const localGraph = buildFloorGraph(String(roomId || REAL_ROOM_ID).slice(0, 1));
  if (!localGraph.nodes[start]) return { path: [], nodes: [], summary: "未找到寝室节点" };

  const blocked = new Set([start]);
  const adjacent = new Set();
  for (const [a, b] of localGraph.edges) {
    if (a === start) adjacent.add(b);
    if (b === start) adjacent.add(a);
  }
  const exits = Object.entries(localGraph.nodes).filter(([, node]) => node.type === "exit").map(([id]) => id);
  let best = null;
  for (const exit of exits) {
    const route = dijkstra(start, exit, blocked, adjacent, localGraph);
    if (route && (!best || route.distance < best.distance)) best = route;
  }
  if (!best) return { path: [], nodes: [], summary: "暂无可用逃生路线" };
  const nodes = best.path.map((id) => ({ id, ...localGraph.nodes[id] }));
  return { path: best.path, nodes, distance: best.distance, summary: nodes.map((node) => node.label).join(" -> ") };
}

function dijkstra(start, end, blocked, highRisk, localGraph) {
  const distances = {};
  const previous = {};
  const unvisited = new Set(Object.keys(localGraph.nodes));
  for (const nodeId of unvisited) distances[nodeId] = Infinity;
  distances[start] = 0;

  while (unvisited.size) {
    const current = [...unvisited].sort((a, b) => distances[a] - distances[b])[0];
    if (!current || distances[current] === Infinity) break;
    unvisited.delete(current);
    if (current === end) break;
    for (const [a, b, weight] of localGraph.edges) {
      const neighbor = a === current ? b : b === current ? a : null;
      if (!neighbor || !unvisited.has(neighbor)) continue;
      if (blocked.has(neighbor) && neighbor !== start) continue;
      const riskWeight = highRisk.has(neighbor) && neighbor !== start ? 9 : 0;
      const alternative = distances[current] + weight + riskWeight;
      if (alternative < distances[neighbor]) {
        distances[neighbor] = alternative;
        previous[neighbor] = current;
      }
    }
  }

  if (distances[end] === Infinity) return null;
  const path = [];
  let cursor = end;
  while (cursor) {
    path.unshift(cursor);
    cursor = previous[cursor];
  }
  return { path, distance: distances[end] };
}

function roomStatuses() {
  const activeRooms = new Set(state.alerts.filter((alert) => alert.status === "active").map((alert) => alert.room_id));
  return rooms.map((room) => ({
    ...room,
    alert_active: activeRooms.has(room.room_id),
    latest_telemetry: state.telemetry[room.device_id] || null,
  }));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : ext === ".js" ? "application/javascript; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  try {
    if (req.method === "GET" && pathname === "/api/state") {
      sendJson(res, 200, { ...state, rooms: roomStatuses(), graph, model: require("./config/onenet-product-model.json") });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/route/")) {
      sendJson(res, 200, computeEscapeRoute(pathname.split("/").pop()));
      return;
    }

    if (req.method === "POST" && pathname === "/api/telemetry") {
      const telemetry = normalizeTelemetry(await readBody(req), "real");
      const alerts = alertsForTelemetry(telemetry, "real");
      sendJson(res, 201, { telemetry, alerts });
      return;
    }

    if (req.method === "GET" && pathname === "/api/onenet/webhook") {
      const msg = url.searchParams.get("msg");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(msg || "OneNET webhook is running");
      return;
    }

    if (req.method === "POST" && pathname === "/api/onenet/webhook") {
      const event = normalizeOneNetEvent(await readBody(req));
      const telemetry = normalizeTelemetry(event.telemetry, "real");
      const alert = createAlert(event.type, telemetry, "real");
      sendJson(res, 201, { received: true, telemetry, alert });
      return;
    }

    if (req.method === "POST" && pathname === "/api/simulate") {
      const body = await readBody(req);
      const telemetry = normalizeTelemetry(buildScenarioTelemetry(body.scenario, body.room_id || REAL_ROOM_ID), "demo");
      const type = body.scenario === "illegal_appliance" ? "illegal_appliance_alarm" : telemetry.fire_level === 2 ? "fire_alarm" : "fire_warning";
      const alert = createAlert(type, telemetry, "demo");
      sendJson(res, 201, { telemetry, alert });
      return;
    }

    if (req.method === "POST" && pathname === "/api/command") {
      const body = await readBody(req);
      const command = {
        id: crypto.randomUUID(),
        device_id: body.device_id || REAL_DEVICE_ID,
        command: body.command,
        params: body.params || {},
        status: "queued-for-onenet",
        topic_hint: `$sys/{product_id}/${body.device_id || REAL_DEVICE_ID}/thing/service/${body.command}`,
        created_at: new Date().toISOString(),
      };
      state.commands.unshift(command);
      state.commands = state.commands.slice(0, 60);
      if (body.command === "set_thresholds") state.thresholds = { ...state.thresholds, ...body.params };
      sendJson(res, 201, command);
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/alerts/")) {
      const body = await readBody(req);
      const alert = state.alerts.find((item) => item.id === pathname.split("/")[3]);
      if (!alert) {
        sendJson(res, 404, { error: "Alert not found" });
        return;
      }
      alert.status = body.status || alert.status;
      alert.handled_at = new Date().toISOString();
      sendJson(res, 200, alert);
      return;
    }

    sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function alertsForTelemetry(telemetry, source) {
  const alerts = [];
  if (telemetry.fire_level === 1) alerts.push(createAlert("fire_warning", telemetry, source));
  if (telemetry.fire_level === 2) alerts.push(createAlert("fire_alarm", telemetry, source));
  if (telemetry.appliance_type !== "normal") alerts.push(createAlert("illegal_appliance_alarm", telemetry, source));
  return alerts;
}

function normalizeOneNetEvent(body) {
  const eventType = body.event || body.type || body.identifier || "fire_warning";
  const payload = body.data || body.payload || body.properties || body;
  return {
    type: eventType,
    telemetry: {
      device_id: body.device_id || body.deviceName || payload.device_id || payload.deviceName || REAL_DEVICE_ID,
      room_id: payload.room_id || REAL_ROOM_ID,
      building_id: payload.building_id || BUILDING_ID,
      floor_id: payload.floor_id || String(payload.room_id || REAL_ROOM_ID).slice(0, 1),
      smoke_ppm: payload.smoke_ppm,
      temperature: payload.temperature,
      humidity: payload.humidity,
      temp_rise_rate: payload.temp_rise_rate,
      flame_intensity: payload.flame_intensity,
      current_rms: payload.current_rms,
      appliance_type: payload.appliance_type,
      fire_level: payload.fire_level,
    },
  };
}

function buildScenarioTelemetry(scenario, roomId) {
  const room = roomById(roomId) || roomById(REAL_ROOM_ID);
  const base = state.telemetry[room.device_id] || {};
  if (scenario === "fire_alarm") {
    return { ...base, room_id: room.room_id, smoke_ppm: 680, temperature: 68, humidity: 42, temp_rise_rate: 12, flame_intensity: 88, current_rms: 2.1, appliance_type: "normal", fire_level: 2 };
  }
  if (scenario === "illegal_appliance") {
    return { ...base, room_id: room.room_id, smoke_ppm: 45, temperature: 27, humidity: 58, temp_rise_rate: 0.8, flame_intensity: 0, current_rms: 7.8, appliance_type: "热得快", fire_level: 0 };
  }
  return { ...base, room_id: room.room_id, smoke_ppm: 410, temperature: 34, humidity: 50, temp_rise_rate: 3.2, flame_intensity: 12, current_rms: 1.7, appliance_type: "normal", fire_level: 1 };
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) handleApi(req, res);
  else serveStatic(req, res);
});

initTelemetry();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`寓安芯 prototype running at http://${displayHost}:${PORT}`);
  });
}

module.exports = {
  classifyFire,
  classifyAppliance,
  computeEscapeRoute,
  normalizeTelemetry,
  buildScenarioTelemetry,
  state,
  rooms,
  graph,
  server,
};
