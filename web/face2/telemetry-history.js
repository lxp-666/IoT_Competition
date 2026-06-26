class TelemetryHistory {
  constructor(limit = 1440) {
    this.limit = limit;
    this.points = new Map();
  }

  record(item) {
    if (!item?.device_id || !item?.ts) return;

    const timestamp = new Date(item.ts);
    if (Number.isNaN(timestamp.getTime())) return;

    const minuteKey = timestamp.toISOString().slice(0, 16);
    const devicePoints = this.points.get(item.device_id) || [];
    const existing = devicePoints.find((point) => point.minuteKey === minuteKey);

    if (existing) {
      if (existing.rawTs === item.ts) return;
      existing.count += 1;
      existing.smokeSum += Number(item.smoke_ppm);
      existing.temperatureSum += Number(item.temperature);
      existing.currentSum += Number(item.current_rms);
      existing.rawTs = item.ts;
      this.updateAverages(existing);
    } else {
      devicePoints.push({
        minuteKey,
        rawTs: item.ts,
        count: 1,
        smokeSum: Number(item.smoke_ppm),
        temperatureSum: Number(item.temperature),
        currentSum: Number(item.current_rms),
        smoke_ppm: Number(item.smoke_ppm),
        temperature: Number(item.temperature),
        current_rms: Number(item.current_rms),
      });
    }

    this.points.set(item.device_id, devicePoints.slice(-this.limit));
  }

  updateAverages(point) {
    point.smoke_ppm = point.smokeSum / point.count;
    point.temperature = point.temperatureSum / point.count;
    point.current_rms = point.currentSum / point.count;
  }

  forDevice(deviceId) {
    return (this.points.get(deviceId) || []).map((point) => ({ ...point }));
  }

  snapshot() {
    return Object.fromEntries([...this.points].map(([deviceId]) => [deviceId, this.forDevice(deviceId)]));
  }
}

module.exports = { TelemetryHistory };
