const assert = require("node:assert/strict");
const { TelemetryHistory } = require("../telemetry-history");

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

console.log("telemetry history tests passed");
