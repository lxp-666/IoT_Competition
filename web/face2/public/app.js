const telemetryHistory = {};
let latestState = null;
let latestRoute = null;

const $ = (selector) => document.querySelector(selector);
const els = {
  metrics: $("#overviewMetrics"),
  viewTitle: $("#viewTitle"),
  viewSubtitle: $("#viewSubtitle"),
  viewKicker: $("#viewKicker"),
  currentTime: $("#currentTime"),
  currentDate: $("#currentDate"),
  viewLinks: document.querySelectorAll("[data-view-link]"),
  views: document.querySelectorAll("[data-view]"),
  chart: $("#telemetryChart"),
  chartFloor: $("#chartFloor"),
  chartDevice: $("#chartDevice"),
  simulateRoom: $("#simulateRoom"),
  commandDevice: $("#commandDevice"),
  deviceTable: $("#deviceTable"),
  alertList: $("#alertList"),
  alertCount: $("#alertCount"),
  notificationList: $("#notificationList"),
  floorMap: $("#floorMap"),
  escapeMap: $("#escapeMap"),
  overviewFloor: $("#overviewFloor"),
  escapeFloor: $("#escapeFloor"),
  escapeRoom: $("#escapeRoom"),
  routeSummary: $("#routeSummary"),
  routeSteps: $("#routeSteps"),
  studentKicker: $("#studentKicker"),
  studentTitle: $("#studentTitle"),
  studentAdvice: $("#studentAdvice"),
  modelPreview: $("#modelPreview"),
};

const viewMeta = {
  overview: ["总览", "高校寝室用火安全多模态监测平台", "1 台真实 ESP32 样机验证采集链路，15 个房间点位展示系统部署后的联动能力。"],
  devices: ["设备", "真实设备接入与命令下发", "当前现场只有一台真实终端，其他房间为可部署点位。"],
  alerts: ["告警", "告警记录与推送队列", "区分真实设备上报和演示场景触发。"],
  escape: ["逃生路径", "学生端逃生指引", "按房间生成避险路线，告警时同步学生端和宿管端。"],
  integration: ["接入配置", "OneNET 接入配置", "物模型、MQTT/TLS、Webhook 与 ESP32 上报字段。"],
};

function allRooms() {
  return [...(latestState?.rooms || [])].sort((a, b) => Number(a.room_id) - Number(b.room_id));
}

function telemetryForRoom(room) {
  return latestState?.telemetry?.[room.device_id] || room.latest_telemetry || null;
}

function sourceLabel(source) {
  if (source === "demo") return "演示场景触发";
  if (source === "real" || source === "device" || source === "onenet") return "真实设备上报";
  return source || "未知来源";
}

function statusLabel(room, item) {
  if (room.alert_active) return "告警中";
  if (room.deployment_mode === "real") return item ? "真实在线" : "真实待上报";
  if (item) return "演示触发";
  return "演示点位";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function loadState() {
  latestState = await api("/api/state");
  recordHistory(Object.values(latestState.telemetry || {}));
  render();
}

function recordHistory(items) {
  for (const item of items) {
    if (!item?.device_id || !item?.ts) continue;
    if (!telemetryHistory[item.device_id]) telemetryHistory[item.device_id] = [];
    const ts = new Date(item.ts);
    const key = `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}-${ts.getHours()}-${ts.getMinutes()}`;
    const points = telemetryHistory[item.device_id];
    if (points.at(-1)?.key === key && points.at(-1)?.rawTs === item.ts) continue;
    points.push({
      key,
      rawTs: item.ts,
      hour: ts.getHours() + ts.getMinutes() / 60,
      smoke_ppm: Number(item.smoke_ppm || 0),
      temperature: Number(item.temperature || 0),
      current_rms: Number(item.current_rms || 0),
    });
    telemetryHistory[item.device_id] = points.slice(-240);
  }
}

function render() {
  updateClock();
  renderSelectors();
  renderMetrics();
  renderChart();
  renderMap();
  renderDevices();
  renderAlerts();
  renderNotifications();
  renderStudentRoute();
  if (els.modelPreview) els.modelPreview.textContent = JSON.stringify(latestState.model, null, 2);
}

function updateClock() {
  const now = new Date();
  if (els.currentTime) els.currentTime.textContent = now.toLocaleTimeString("zh-CN", { hour12: false });
  if (els.currentDate) els.currentDate.textContent = now.toLocaleDateString("zh-CN", { dateStyle: "full" });
}

function renderSelectors() {
  const rooms = allRooms();
  const selectedDemo = els.simulateRoom?.value;
  if (els.simulateRoom) {
    els.simulateRoom.innerHTML = rooms.map((room) => `<option value="${room.room_id}">${room.room_id} 寝室 · ${room.deployment_mode === "real" ? "真实设备" : "演示点位"}</option>`).join("");
    els.simulateRoom.value = rooms.some((room) => room.room_id === selectedDemo) ? selectedDemo : "302";
  }

  const selectedChart = els.chartDevice?.value;
  const floor = els.chartFloor?.value || "3";
  if (els.chartDevice) {
    const floorRooms = rooms.filter((room) => room.floor_id === floor);
    els.chartDevice.innerHTML = floorRooms.map((room) => `<option value="${room.device_id}">${room.room_id} / ${room.deployment_mode === "real" ? "真实" : "演示"}</option>`).join("");
    els.chartDevice.value = floorRooms.some((room) => room.device_id === selectedChart) ? selectedChart : floorRooms[0]?.device_id || "";
  }

  if (els.commandDevice) {
    const realDevices = latestState?.devices || [];
    els.commandDevice.innerHTML = realDevices.map((device) => `<option value="${device.device_id}">${device.room_id} / ${device.device_id}</option>`).join("");
  }
  syncEscapeRoomOptions(els.escapeFloor?.value || "3", els.escapeRoom?.value);
}

function renderMetrics() {
  const realDevices = latestState?.devices?.filter((device) => device.deployment_mode === "real") || [];
  const primaryTelemetry = realDevices.map((device) => latestState.telemetry?.[device.device_id]).find(Boolean);
  const roomLabel = primaryTelemetry?.room_id ? `${primaryTelemetry.room_id} 寝室` : "真实设备";
  const measuredAt = primaryTelemetry?.ts ? new Date(primaryTelemetry.ts).toLocaleTimeString("zh-CN", { hour12: false }) : "等待上报";
  const sensorCards = [
    ["烟雾浓度", "smoke_ppm", 0, "ppm", "MQ-2 烟雾传感器"],
    ["环境温度", "temperature", 1, "°C", "DHT11 温度"],
    ["环境湿度", "humidity", 1, "%", "DHT11 湿度"],
    ["火焰强度", "flame_intensity", 0, "%", "火焰传感器"],
  ];
  const cards = [
    ...sensorCards.map(([label, key, digits, unit, sensorName]) => {
      const rawValue = primaryTelemetry?.[key];
      const value = rawValue === undefined || rawValue === null ? "--" : `${Number(rawValue).toFixed(digits)} ${unit}`;
      return [label, value, `${sensorName} · ${roomLabel} · ${measuredAt}`];
    }),
  ];
  els.metrics.innerHTML = cards.map(([label, value, hint]) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${hint}</small></div>`).join("");
}

function renderChart() {
  if (!els.chart) return;
  const selected = els.chartDevice?.value;
  const data = telemetryHistory[selected] || [];
  const ctx = els.chart.getContext("2d");
  ctx.clearRect(0, 0, els.chart.width, els.chart.height);
  const plot = drawGrid(ctx, els.chart);
  drawLine(ctx, plot, data, "smoke_ppm", "#c23b3b", 700);
  drawLine(ctx, plot, data, "temperature", "#107c72", 80);
  drawLine(ctx, plot, data, "current_rms", "#3867b7", 10);
  drawChartStatus(ctx, plot, data);
}

function drawGrid(ctx, canvas) {
  const plot = { left: 62, top: 38, right: canvas.width - 80, bottom: canvas.height - 46 };
  ctx.strokeStyle = "#dbe4ea";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = plot.top + ((plot.bottom - plot.top) * i) / 5;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#65717a";
  ctx.font = "12px Arial";
  ctx.fillText("烟雾 / 温度 / 电流", plot.left, 24);
  return plot;
}

function drawLine(ctx, plot, data, key, color, max) {
  if (!data.length) return;
  const width = plot.right - plot.left;
  const height = plot.bottom - plot.top;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  data.forEach((point, index) => {
    const x = plot.left + (data.length === 1 ? width : (width * index) / (data.length - 1));
    const y = plot.top + height - (Math.min(max, Number(point[key] || 0)) / max) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  for (const [index, point] of data.entries()) {
    const x = plot.left + (data.length === 1 ? width : (width * index) / (data.length - 1));
    const y = plot.top + height - (Math.min(max, Number(point[key] || 0)) / max) * height;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawChartStatus(ctx, plot, data) {
  if (data.length >= 2) return;
  ctx.fillStyle = "#65717a";
  ctx.font = "13px Arial";
  ctx.textAlign = "center";
  ctx.fillText(data.length ? "等待下一次上报形成曲线" : "等待 OneNET/设备数据", plot.left + (plot.right - plot.left) / 2, plot.top + 28);
  ctx.textAlign = "left";
}

function buildDisplayMap(floorId) {
  const floor = String(floorId || "3");
  const nodes = {};
  const edges = [];
  const ys = [14, 32, 50, 68, 86];
  const rooms = ys.map((_, index) => `${floor}${String(index + 1).padStart(2, "0")}`);
  rooms.forEach((room, index) => {
    const y = ys[index];
    nodes[`R${room}`] = { label: `${room}`, x: 14, y, type: "room", room_id: room };
    nodes[`H${room}`] = { label: "门口", x: 34, y, type: "hall" };
    nodes[`C${room}`] = { label: "", x: 54, y, type: "hall", quiet: true };
    edges.push([`R${room}`, `H${room}`], [`H${room}`, `C${room}`]);
    if (index > 0) edges.push([`C${rooms[index - 1]}`, `C${room}`]);
  });
  nodes[`F${floor}S1`] = { label: "楼梯A", x: 74, y: 14, type: "stair" };
  nodes[`F${floor}S2`] = { label: "楼梯B", x: 74, y: 86, type: "stair" };
  nodes[`F${floor}E1`] = { label: floor === "1" ? "出口A" : "向下", x: 90, y: 14, type: "exit" };
  nodes[`F${floor}E2`] = { label: floor === "1" ? "出口B" : "向下", x: 90, y: 86, type: "exit" };
  edges.push([`C${rooms[0]}`, `F${floor}S1`], [`F${floor}S1`, `F${floor}E1`], [`C${rooms[4]}`, `F${floor}S2`], [`F${floor}S2`, `F${floor}E2`]);
  return { nodes, edges };
}

function renderMap() {
  renderMapInto(els.floorMap, els.overviewFloor?.value || "3", false);
  renderMapInto(els.escapeMap, els.escapeFloor?.value || "3", true);
}

function renderMapInto(container, floorId, showRoute) {
  if (!container) return;
  const localGraph = buildDisplayMap(floorId);
  const routePath = showRoute ? latestRoute?.path || [] : [];
  const activeRooms = new Set((latestState?.alerts || []).filter((alert) => alert.status === "active").map((alert) => alert.room_id));
  const roomsById = new Map(allRooms().map((room) => [room.room_id, room]));
  const routeEdges = new Set();
  for (let i = 0; i < routePath.length - 1; i += 1) routeEdges.add([routePath[i], routePath[i + 1]].sort().join("-"));
  container.innerHTML = "";

  for (const [a, b] of localGraph.edges) {
    const nodeA = localGraph.nodes[a];
    const nodeB = localGraph.nodes[b];
    const dx = nodeB.x - nodeA.x;
    const dy = nodeB.y - nodeA.y;
    const edge = document.createElement("div");
    edge.className = `map-edge ${routeEdges.has([a, b].sort().join("-")) ? "route" : ""}`;
    edge.style.left = `${nodeA.x}%`;
    edge.style.top = `${nodeA.y}%`;
    edge.style.width = `${Math.sqrt(dx * dx + dy * dy)}%`;
    edge.style.transform = `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)`;
    container.appendChild(edge);
  }

  for (const [id, node] of Object.entries(localGraph.nodes)) {
    const room = node.room_id ? roomsById.get(node.room_id) : null;
    const item = room ? telemetryForRoom(room) : null;
    const classes = ["map-node", node.type, node.quiet ? "quiet" : "", routePath.includes(id) ? "route" : ""];
    if (room?.deployment_mode === "real") classes.push("real");
    if (room?.deployment_mode === "demo") classes.push("demo");
    if (room && activeRooms.has(room.room_id)) classes.push("risk");
    const div = document.createElement("div");
    div.className = classes.filter(Boolean).join(" ");
    div.style.left = `${node.x}%`;
    div.style.top = `${node.y}%`;
    div.title = room ? `${room.room_id}：${statusLabel(room, item)}` : node.label;
    div.innerHTML = room ? `<strong>${node.label}</strong><small>${statusLabel(room, item)}</small>` : node.label;
    container.appendChild(div);
  }
}

function fmt(item, key, digits, unit) {
  return item ? `${Number(item[key] || 0).toFixed(digits)} ${unit}` : "--";
}

function renderDevices() {
  const rows = allRooms().map((room) => {
    const item = telemetryForRoom(room);
    return `<div class="table-row ${room.deployment_mode}">
      <strong>${room.device_id}</strong>
      <span>${room.room_id}</span>
      <span>${room.deployment_mode === "real" ? "真实设备" : "演示点位"}</span>
      <span>${fmt(item, "smoke_ppm", 0, "ppm")}</span>
      <span>${fmt(item, "temperature", 1, "C")}</span>
      <span>${fmt(item, "current_rms", 1, "A")}</span>
      <span class="status ${room.alert_active ? "critical" : room.deployment_mode === "real" ? "online" : "demo"}">${statusLabel(room, item)}</span>
    </div>`;
  }).join("");
  els.deviceTable.innerHTML = `<div class="table-row header"><span>设备/点位ID</span><span>房间</span><span>类型</span><span>烟雾</span><span>温度</span><span>电流</span><span>状态</span></div>${rows}`;
}

function renderAlerts() {
  const alerts = latestState.alerts || [];
  const active = alerts.filter((alert) => alert.status === "active");
  els.alertCount.textContent = `${active.length} active`;
  els.alertList.innerHTML = alerts.slice(0, 12).map((alert) => `<article class="list-item">
    <div class="list-item-head"><strong>${alert.title} · ${alert.room_id} 寝室</strong><span class="status ${alert.severity}">${alert.status}</span></div>
    <p>${sourceLabel(alert.source)}：烟雾 ${Number(alert.telemetry.smoke_ppm || 0).toFixed(0)} ppm，温度 ${Number(alert.telemetry.temperature || 0).toFixed(1)} C，电流 ${Number(alert.telemetry.current_rms || 0).toFixed(1)} A。</p>
    ${alert.route ? `<p>逃生路线：${alert.route.summary}</p>` : ""}
    <button data-resolve="${alert.id}">处理完成</button>
  </article>`).join("") || `<p class="muted">暂无告警。</p>`;
  document.querySelectorAll("[data-resolve]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/alerts/${button.dataset.resolve}`, { method: "PATCH", body: JSON.stringify({ status: "resolved" }) });
    await loadState();
  }));
}

function renderNotifications() {
  els.notificationList.innerHTML = (latestState.notifications || []).slice(0, 14).map((notice) => `<article class="list-item">
    <div class="list-item-head"><strong>${notice.recipient}</strong><span class="badge">${notice.channel}</span></div>
    <p>${notice.message}</p><p>${new Date(notice.created_at).toLocaleString()}</p>
  </article>`).join("") || `<p class="muted">暂无推送消息。</p>`;
}

function syncEscapeRoomOptions(floorId, preferredRoom) {
  if (!els.escapeRoom) return;
  const floor = String(floorId || "3");
  const rooms = allRooms().filter((room) => room.floor_id === floor);
  const selected = rooms.some((room) => room.room_id === preferredRoom) ? preferredRoom : `${floor}02`;
  els.escapeRoom.innerHTML = rooms.map((room) => `<option value="${room.room_id}">${room.room_id} 寝室</option>`).join("");
  els.escapeRoom.value = selected;
}

function buildRoomPreviewRoute(room) {
  const floor = String(room || "302").slice(0, 1);
  const roomId = room || `${floor}02`;
  const path = [`R${roomId}`, `H${roomId}`, `C${roomId}`, `C${floor}01`, `F${floor}S1`, `F${floor}E1`];
  const nodes = path.map((id) => ({ id, label: id.replace(/^R/, "寝室 ").replace(/^H/, "门口 ").replace(/^C/, "走廊 ").replace(/^F\dS1$/, "楼梯A").replace(/^F\dE1$/, floor === "1" ? "出口A" : "向下疏散") }));
  return { path, nodes, distance: path.length - 1, summary: nodes.map((node) => node.label).join(" -> ") };
}

function renderStudentRoute() {
  if (!latestRoute) latestRoute = buildRoomPreviewRoute(els.escapeRoom?.value || "302");
  const room = els.escapeRoom?.value || "302";
  els.routeSummary.textContent = latestRoute.summary;
  els.studentKicker.textContent = `推送预览：${room} 寝室学生端`;
  els.studentTitle.textContent = `${room} 寝室逃生路线`;
  els.studentAdvice.textContent = "演示时可选择任意房间触发告警；真实设备告警会走同一套路线生成和推送流程。";
  els.routeSteps.innerHTML = latestRoute.nodes.map((node) => `<li>${node.label}</li>`).join("");
}

function showView(viewName, options = {}) {
  const next = viewMeta[viewName] ? viewName : "overview";
  els.views.forEach((view) => view.classList.toggle("active", view.dataset.view === next));
  els.viewLinks.forEach((link) => link.classList.toggle("active", link.dataset.viewLink === next));
  const [kicker, title, subtitle] = viewMeta[next];
  els.viewKicker.textContent = kicker;
  els.viewTitle.textContent = title;
  els.viewSubtitle.textContent = subtitle;
  if (!options.skipHash && window.location.hash !== `#${next}`) window.history.replaceState(null, "", `#${next}`);
  renderMap();
}

function currentRoom() {
  return els.simulateRoom?.value || els.escapeRoom?.value || "302";
}

async function simulate(scenario) {
  await api("/api/simulate", { method: "POST", body: JSON.stringify({ scenario, room_id: currentRoom() }) });
  await loadState();
}

async function sendCommand(command, params) {
  await api("/api/command", { method: "POST", body: JSON.stringify({ device_id: els.commandDevice.value, command, params }) });
  await loadState();
}

async function updateRoute(roomId) {
  latestRoute = await api(`/api/route/${roomId}`);
  render();
}

$("#simulateSmoke")?.addEventListener("click", () => simulate("fire_warning"));
$("#simulateFire")?.addEventListener("click", () => simulate("fire_alarm"));
$("#simulateAppliance")?.addEventListener("click", () => simulate("illegal_appliance"));
$("#sendBuzzer")?.addEventListener("click", () => sendCommand("buzzer_control", { enabled: true, duration_ms: 5000 }));
$("#sendLed")?.addEventListener("click", () => sendCommand("led_control", { color: "red", mode: "blink" }));
$("#sendThreshold")?.addEventListener("click", () => sendCommand("set_thresholds", { smoke_ppm: 320, temperature: 55, temp_rise_rate: 8, current_rms: 5.5 }));
els.chartFloor?.addEventListener("change", () => { renderSelectors(); renderChart(); });
els.chartDevice?.addEventListener("change", renderChart);
els.overviewFloor?.addEventListener("change", renderMap);
els.escapeFloor?.addEventListener("change", () => { syncEscapeRoomOptions(els.escapeFloor.value); updateRoute(els.escapeRoom.value); });
els.escapeRoom?.addEventListener("change", () => updateRoute(els.escapeRoom.value));
els.viewLinks.forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showView(link.dataset.viewLink); }));
window.addEventListener("hashchange", () => showView(window.location.hash.slice(1), { skipHash: true }));

showView(window.location.hash.slice(1) || "overview", { skipHash: true });
loadState().then(() => updateRoute("302")).catch((error) => {
  console.error(error);
  if (els.metrics) els.metrics.innerHTML = `<div class="metric"><span>API</span><strong>离线</strong><small>${error.message}</small></div>`;
});
setInterval(loadState, 3000);
setInterval(updateClock, 1000);
