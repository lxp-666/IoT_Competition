#ifndef SUI101A_PROTOCOL_H
#define SUI101A_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

struct Sui101aMeasurements {
  float voltageVolts;
  float currentAmps;
  float activePowerWatts;
  float powerFactor;
  float frequencyHz;
  float energyKwh;
};

inline uint8_t sui101aChecksum(const uint8_t* data, size_t length) {
  uint8_t sum = 0;
  for (size_t i = 0; i < length; ++i) {
    sum = static_cast<uint8_t>(sum + data[i]);
  }
  return sum;
}

inline uint32_t sui101aReadU32Be(const uint8_t* data) {
  return (static_cast<uint32_t>(data[0]) << 24) |
         (static_cast<uint32_t>(data[1]) << 16) |
         (static_cast<uint32_t>(data[2]) << 8) |
         static_cast<uint32_t>(data[3]);
}

inline bool sui101aParseAllMeasurements(const uint8_t* frame,
                                        size_t length,
                                        Sui101aMeasurements& values) {
  static const size_t kFrameLength = 31;
  static const size_t kDataOffset = 6;

  if (frame == nullptr || length != kFrameLength) {
    return false;
  }
  if (frame[0] != 0x55 || frame[1] != 0x55 || frame[2] != 0x01 ||
      frame[3] != 0x02 || frame[4] != 0x00 || frame[5] != 0x18) {
    return false;
  }
  if (sui101aChecksum(frame, length - 1) != frame[length - 1]) {
    return false;
  }

  values.voltageVolts = sui101aReadU32Be(frame + kDataOffset) / 1000.0f;
  values.currentAmps = sui101aReadU32Be(frame + kDataOffset + 4) / 1000.0f;
  values.activePowerWatts = sui101aReadU32Be(frame + kDataOffset + 8) / 1000.0f;
  values.powerFactor =
      static_cast<int32_t>(sui101aReadU32Be(frame + kDataOffset + 12)) / 10000.0f;
  values.frequencyHz = sui101aReadU32Be(frame + kDataOffset + 16) / 1000.0f;
  values.energyKwh = sui101aReadU32Be(frame + kDataOffset + 20) / 10000.0f;
  return true;
}

#endif
