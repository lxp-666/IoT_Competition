const assert = require("node:assert/strict");
const { TelemetryHistory } = require("../telemetry-history");
const { server, state } = require("../server");

function sample(ts, smoke, temperature, current) {
  return {
    device_id: "device-102",
    ts,
    smoke_ppm: smoke,
    temperature,
    current_rms: current,
  };
}

const history = new TelemetryHistory();
history.record(sample("2026-06-19T12:00:05.000Z", 100, 20, 1));
history.record(sample("2026-06-19T12:00:35.000Z", 200, 30, 3));

let points = history.forDevice("device-102");
assert.equal(points.length, 1, "同一分钟的数据应合并为一个点");
assert.equal(points[0].smoke_ppm, 150);
assert.equal(points[0].temperature, 25);
assert.equal(points[0].current_rms, 2);

history.record(sample("2026-06-19T12:01:05.000Z", 300, 40, 5));
points = history.forDevice("device-102");
assert.equal(points.length, 2, "跨分钟后应保留两个点供折线连接");
assert.equal(points[1].smoke_ppm, 300);

history.record(sample("2026-06-19T12:01:05.000Z", 999, 99, 9));
points = history.forDevice("device-102");
assert.equal(points[1].smoke_ppm, 300, "相同时间戳不应重复计入平均值");

function listenOnRandomPort() {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

function closeServer() {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== 201) {
    assert.fail(await response.text());
  }
  return response.json();
}

async function testOneNetPropertyParamsWebhook() {
  const port = await listenOnRandomPort();
  try {
    await postJson(`http://127.0.0.1:${port}/api/onenet/webhook`, {
      event: "thing.property.post",
      deviceName: "esp32s3_test",
      params: {
        smoke_ppm: { value: 5 },
        temperature: { value: 29.7 },
        humidity: { value: 61 },
        temp_rise_rate: { value: 1.2 },
        flame_intensity: { value: 6 },
        current_rms: { value: 0.8 },
        fire_level: { value: 0 },
        room_id: { value: "302" },
        building_id: { value: "1" },
        floor_id: { value: "3" },
      },
    });

    const telemetry = state.telemetry.esp32s3_test;
    assert.equal(telemetry.smoke_ppm, 5);
    assert.equal(telemetry.temperature, 29.7);
    assert.equal(telemetry.humidity, 61);
    assert.equal(telemetry.temp_rise_rate, 1.2);
    assert.equal(telemetry.flame_intensity, 6);
    assert.equal(telemetry.current_rms, 0.8);
    assert.equal(telemetry.fire_level, 0);
    assert.equal(state.alerts.length, 0);
  } finally {
    await closeServer();
  }
}

testOneNetPropertyParamsWebhook()
  .then(() => console.log("telemetry history and OneNET webhook tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
