#include <Adafruit_NeoPixel.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "mbedtls/base64.h"
#include "mbedtls/md.h"
#include "sui101a_protocol.h"

#define RGB_PIN 48
#define RGB_COUNT 1

const char* WIFI_SSID = "iPhone守己";
const char* WIFI_PASSWORD = "1234567898";

const char* MQTT_HOST = "rWu7aDklv0.mqttstls.acc.cmcconenet.cn";
const int MQTT_PORT = 8883;
const char* PRODUCT_ID = "rWu7aDklv0";
const char* DEVICE_NAME = "esp32s3_test";
const char* DEVICE_TOKEN = "azA1bWlnNXQ1UzhuejhJNzFwQTVuTm94RjlBSnZmeU4=";
const char* TOKEN_EXPIRE_AT = "1893456000";

const char* BUILDING_ID = "1";
const char* FLOOR_ID = "3";
const char* ROOM_ID = "302";

constexpr int SUI_RX_PIN = 9;
constexpr int SUI_TX_PIN = 10;
constexpr int FLAME_AO_PIN = 1;
constexpr int FLAME_DO_PIN = 2;
constexpr int SMOKE_AO_PIN = 4;
constexpr int SMOKE_DO_PIN = 5;
constexpr int DHT11_DATA_PIN = 6;
constexpr uint32_t SUI_BAUD_RATE = 9600;
constexpr uint32_t PUBLISH_INTERVAL_MS = 5000;
constexpr uint32_t RESPONSE_TIMEOUT_MS = 1000;
constexpr uint32_t DHT11_TIMEOUT_US = 1000;
constexpr size_t RESPONSE_BUFFER_SIZE = 64;
constexpr uint8_t ANALOG_SAMPLE_COUNT = 30;
constexpr int ADC_MAX_VALUE = 4095;
constexpr bool ENABLE_SUI_SENSOR = true;
constexpr bool UPLOAD_SUI_DETAIL_FIELDS = false;
constexpr bool PRINT_SUI_RAW_FRAME = false;

const uint8_t SUI_REQUEST_ALL[] = {
    0x55, 0x55, 0x01, 0x02, 0x00, 0x00, 0xAD};

Adafruit_NeoPixel rgb(RGB_COUNT, RGB_PIN, NEO_GRB + NEO_KHZ800);
WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);

unsigned long lastPublish = 0;
unsigned long publishCount = 0;
float lastValidTemperature = 0.0f;
unsigned long lastTemperatureMs = 0;
bool hasLastTemperature = false;

struct FlameMeasurements {
  int analogRaw;
  int intensityPercent;
  int digitalValue;
};

struct SmokeMeasurements {
  int analogRaw;
  int densityPercent;
  int digitalValue;
};

struct Dht11Measurements {
  float humidityPercent;
  float temperatureCelsius;
  bool valid;
  const char* error;
};

struct SensorSnapshot {
  FlameMeasurements flame;
  SmokeMeasurements smoke;
  Dht11Measurements dht11;
  Sui101aMeasurements sui;
  bool suiValid;
  float tempRiseRate;
  int fireLevel;
};

void setRgb(uint8_t red, uint8_t green, uint8_t blue) {
  rgb.setPixelColor(0, rgb.Color(red, green, blue));
  rgb.show();
}

String propertyTopic() {
  return String("$sys/") + PRODUCT_ID + "/" + DEVICE_NAME + "/thing/property/post";
}

String propertyReplyTopic() {
  return String("$sys/") + PRODUCT_ID + "/" + DEVICE_NAME + "/thing/property/post/reply";
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(300);

  Serial.print("Connecting WiFi: ");
  Serial.println(WIFI_SSID);
  setRgb(0, 0, 80);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

String urlEncode(const String& value) {
  const char* hex = "0123456789ABCDEF";
  String encoded = "";

  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                (c >= '0' && c <= '9') || c == '-' || c == '_' ||
                c == '.' || c == '~';
    if (safe) {
      encoded += c;
    } else {
      encoded += '%';
      encoded += hex[(c >> 4) & 0x0F];
      encoded += hex[c & 0x0F];
    }
  }

  return encoded;
}

bool base64DecodeKey(const char* input, unsigned char* output, size_t outputSize, size_t* outputLength) {
  return mbedtls_base64_decode(output, outputSize, outputLength,
                               (const unsigned char*)input, strlen(input)) == 0;
}

String base64EncodeBytes(const unsigned char* input, size_t inputLength) {
  unsigned char output[128];
  size_t outputLength = 0;
  int result = mbedtls_base64_encode(output, sizeof(output), &outputLength, input, inputLength);
  if (result != 0) return "";
  output[outputLength] = '\0';
  return String((char*)output);
}

String generateOneNetToken() {
  const char* version = "2018-10-31";
  const char* method = "sha1";
  String resource = String("products/") + PRODUCT_ID + "/devices/" + DEVICE_NAME;
  String signContent = String(TOKEN_EXPIRE_AT) + "\n" + method + "\n" + resource + "\n" + version;

  unsigned char decodedKey[96];
  size_t decodedKeyLength = 0;
  if (!base64DecodeKey(DEVICE_TOKEN, decodedKey, sizeof(decodedKey), &decodedKeyLength)) {
    Serial.println("Device key base64 decode failed");
    return "";
  }

  unsigned char hmacResult[20];
  const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA1);
  mbedtls_md_hmac(mdInfo, decodedKey, decodedKeyLength,
                  (const unsigned char*)signContent.c_str(), signContent.length(), hmacResult);

  String sign = base64EncodeBytes(hmacResult, sizeof(hmacResult));
  if (sign.length() == 0) {
    Serial.println("Token signature base64 encode failed");
    return "";
  }

  return String("version=") + version +
         "&res=" + urlEncode(resource) +
         "&et=" + TOKEN_EXPIRE_AT +
         "&method=" + method +
         "&sign=" + urlEncode(sign);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.println();
  Serial.println("========== OneNET reply ==========");
  Serial.print("Topic: ");
  Serial.println(topic);
  Serial.print("Payload: ");
  for (unsigned int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
  Serial.println("==================================");
}

void connectMqtt() {
  while (!mqtt.connected()) {
    Serial.print("Connecting OneNET MQTT...");
    setRgb(80, 50, 0);

    String clientId = String(DEVICE_NAME);
    String password = generateOneNetToken();
    if (password.length() == 0) {
      setRgb(80, 0, 0);
      delay(3000);
      continue;
    }

    bool ok = mqtt.connect(clientId.c_str(), PRODUCT_ID, password.c_str());
    if (ok) {
      Serial.println("connected");
      setRgb(0, 80, 0);
      String replyTopic = propertyReplyTopic();
      bool subOk = mqtt.subscribe(replyTopic.c_str());
      Serial.print("Subscribe reply topic: ");
      Serial.println(replyTopic);
      Serial.println(subOk ? "Subscribe ok" : "Subscribe failed");
    } else {
      Serial.print("failed, rc=");
      Serial.println(mqtt.state());
      setRgb(80, 0, 0);
      delay(3000);
    }
  }
}

void printHexByte(uint8_t value) {
  if (value < 0x10) {
    Serial.print('0');
  }
  Serial.print(value, HEX);
  Serial.print(' ');
}

void printSuiRawByte(uint8_t value) {
  if (PRINT_SUI_RAW_FRAME) {
    printHexByte(value);
  }
}

bool readSuiFrame(uint8_t* frame, size_t capacity, size_t& frameLength) {
  size_t index = 0;
  size_t expectedLength = 0;
  size_t receivedBytes = 0;
  const unsigned long startMs = millis();

  frameLength = 0;
  if (PRINT_SUI_RAW_FRAME) {
    Serial.print("RX raw: ");
  }

  while (millis() - startMs < RESPONSE_TIMEOUT_MS) {
    if (!Serial1.available()) {
      delay(1);
      continue;
    }

    const uint8_t value = static_cast<uint8_t>(Serial1.read());
    ++receivedBytes;
    printSuiRawByte(value);

    if (index == 0) {
      if (value == 0x55) {
        frame[index++] = value;
      }
      continue;
    }

    if (index == 1 && value != 0x55) {
      index = (value == 0x55) ? 1 : 0;
      continue;
    }

    frame[index++] = value;

    if (index == 6) {
      const size_t dataLength =
          (static_cast<size_t>(frame[4]) << 8) | frame[5];
      expectedLength = 6 + dataLength + 1;
      if (expectedLength > capacity || expectedLength < 7) {
        if (PRINT_SUI_RAW_FRAME) {
          Serial.println();
        }
        return false;
      }
    }

    if (expectedLength != 0 && index == expectedLength) {
      frameLength = index;
      if (PRINT_SUI_RAW_FRAME) {
        Serial.println();
      }
      return true;
    }

    if (index >= capacity) {
      if (PRINT_SUI_RAW_FRAME) {
        Serial.println();
      }
      return false;
    }
  }

  frameLength = index;
  if (PRINT_SUI_RAW_FRAME) {
    if (receivedBytes == 0) {
      Serial.print("(none)");
    }
    Serial.println();
  }
  return false;
}

int percentFromRaw(int rawValue) {
  rawValue = constrain(rawValue, 0, ADC_MAX_VALUE);
  return static_cast<int>((static_cast<float>(rawValue) / ADC_MAX_VALUE) * 100.0f + 0.5f);
}

int inversePercentFromRaw(int rawValue) {
  rawValue = constrain(rawValue, 0, ADC_MAX_VALUE);
  return 100 - percentFromRaw(rawValue);
}

int readAnalogRawAverage(int pin) {
  uint32_t total = 0;
  for (uint8_t i = 0; i < ANALOG_SAMPLE_COUNT; ++i) {
    total += static_cast<uint32_t>(analogRead(pin));
    delay(2);
  }
  return static_cast<int>(total / ANALOG_SAMPLE_COUNT);
}

FlameMeasurements readFlameMeasurements() {
  FlameMeasurements values{};
  values.analogRaw = readAnalogRawAverage(FLAME_AO_PIN);
  values.intensityPercent = inversePercentFromRaw(values.analogRaw);
  values.digitalValue = digitalRead(FLAME_DO_PIN);
  return values;
}

SmokeMeasurements readSmokeMeasurements() {
  SmokeMeasurements values{};
  values.analogRaw = readAnalogRawAverage(SMOKE_AO_PIN);
  values.densityPercent = percentFromRaw(values.analogRaw);
  values.digitalValue = digitalRead(SMOKE_DO_PIN);
  return values;
}

bool waitWhileDht11Level(int level, uint32_t timeoutUs) {
  const unsigned long startUs = micros();
  while (digitalRead(DHT11_DATA_PIN) == level) {
    if (micros() - startUs > timeoutUs) {
      return false;
    }
  }
  return true;
}

Dht11Measurements readDht11Measurements() {
  uint8_t data[5] = {0, 0, 0, 0, 0};

  pinMode(DHT11_DATA_PIN, OUTPUT);
  digitalWrite(DHT11_DATA_PIN, LOW);
  delay(19);
  digitalWrite(DHT11_DATA_PIN, HIGH);
  pinMode(DHT11_DATA_PIN, INPUT_PULLUP);
  delayMicroseconds(30);

  if (digitalRead(DHT11_DATA_PIN) != LOW) {
    return {0.0f, 0.0f, false, "no response"};
  }

  if (!waitWhileDht11Level(LOW, DHT11_TIMEOUT_US)) {
    return {0.0f, 0.0f, false, "response low timeout"};
  }
  if (!waitWhileDht11Level(HIGH, DHT11_TIMEOUT_US)) {
    return {0.0f, 0.0f, false, "response high timeout"};
  }

  for (uint8_t byteIndex = 0; byteIndex < 5; ++byteIndex) {
    for (uint8_t bitIndex = 0; bitIndex < 8; ++bitIndex) {
      if (!waitWhileDht11Level(LOW, DHT11_TIMEOUT_US)) {
        return {0.0f, 0.0f, false, "bit low timeout"};
      }

      delayMicroseconds(35);
      data[byteIndex] <<= 1;
      if (digitalRead(DHT11_DATA_PIN) == HIGH) {
        data[byteIndex] |= 1;
      }

      if (!waitWhileDht11Level(HIGH, DHT11_TIMEOUT_US)) {
        return {0.0f, 0.0f, false, "bit high timeout"};
      }
    }
  }

  pinMode(DHT11_DATA_PIN, INPUT_PULLUP);

  const uint8_t checksum =
      static_cast<uint8_t>(data[0] + data[1] + data[2] + data[3]);
  if (checksum != data[4]) {
    return {0.0f, 0.0f, false, "checksum failed"};
  }

  const float humidity = data[0] + data[1] / 10.0f;
  const float temperature = data[2] + data[3] / 10.0f;
  return {humidity, temperature, true, nullptr};
}

bool requestSuiMeasurements(Sui101aMeasurements& values) {
  while (Serial1.available()) {
    Serial1.read();
  }

  Serial.print("SUI TX: ");
  for (size_t i = 0; i < sizeof(SUI_REQUEST_ALL); ++i) {
    printHexByte(SUI_REQUEST_ALL[i]);
  }
  Serial.println();

  Serial1.write(SUI_REQUEST_ALL, sizeof(SUI_REQUEST_ALL));
  Serial1.flush();

  uint8_t response[RESPONSE_BUFFER_SIZE];
  size_t responseLength = 0;
  if (!readSuiFrame(response, sizeof(response), responseLength)) {
    Serial.print("SUI-101A response timeout or invalid length, received bytes=");
    Serial.println(responseLength);
    return false;
  }

  if (!sui101aParseAllMeasurements(response, responseLength, values)) {
    Serial.println("SUI-101A frame check failed");
    return false;
  }

  return true;
}

float roundToOneDecimal(float value) {
  return roundf(value * 10.0f) / 10.0f;
}

float updateTemperatureRiseRate(const Dht11Measurements& dht11) {
  if (!dht11.valid) {
    return 0.0f;
  }

  const unsigned long now = millis();
  float riseRate = 0.0f;
  if (hasLastTemperature && now > lastTemperatureMs) {
    const float elapsedMinutes = (now - lastTemperatureMs) / 60000.0f;
    if (elapsedMinutes > 0.0f) {
      riseRate = (dht11.temperatureCelsius - lastValidTemperature) / elapsedMinutes;
    }
  }

  lastValidTemperature = dht11.temperatureCelsius;
  lastTemperatureMs = now;
  hasLastTemperature = true;

  if (riseRate < 0.0f) {
    riseRate = 0.0f;
  }
  return roundToOneDecimal(riseRate);
}

int calculateFireLevel(const SensorSnapshot& data) {
  int level = 0;

  if (data.flame.intensityPercent >= 30 || data.flame.digitalValue == LOW) {
    level = max(level, 2);
  }
  if (data.smoke.densityPercent >= 35 || data.smoke.digitalValue == LOW) {
    level = max(level, 1);
  }
  if (data.dht11.valid && data.dht11.temperatureCelsius >= 50.0f) {
    level = max(level, 2);
  }
  if (data.tempRiseRate >= 8.0f) {
    level = max(level, 2);
  }
  if ((data.flame.intensityPercent >= 60 || data.flame.digitalValue == LOW) &&
      (data.smoke.densityPercent >= 50 || data.smoke.digitalValue == LOW)) {
    level = 3;
  }

  return level;
}

SensorSnapshot readAllSensors() {
  SensorSnapshot data{};
  data.flame = readFlameMeasurements();
  data.smoke = readSmokeMeasurements();
  data.dht11 = readDht11Measurements();
  data.tempRiseRate = updateTemperatureRiseRate(data.dht11);
  data.suiValid = ENABLE_SUI_SENSOR ? requestSuiMeasurements(data.sui) : false;
  data.fireLevel = calculateFireLevel(data);
  return data;
}

void printSensorSnapshot(const SensorSnapshot& data) {
  Serial.println("\n===== Sensor snapshot =====");
  Serial.printf("Flame: raw=%d intensity=%d%% DO=%d\n",
                data.flame.analogRaw, data.flame.intensityPercent, data.flame.digitalValue);
  Serial.printf("Smoke: raw=%d density=%d%% DO=%d\n",
                data.smoke.analogRaw, data.smoke.densityPercent, data.smoke.digitalValue);
  if (data.dht11.valid) {
    Serial.printf("DHT11: temperature=%.1f C humidity=%.1f%% rise=%.2f C/min\n",
                  data.dht11.temperatureCelsius, data.dht11.humidityPercent, data.tempRiseRate);
  } else {
    Serial.printf("DHT11: read failed (%s)\n", data.dht11.error);
  }
  if (data.suiValid) {
    Serial.printf("SUI: voltage=%.3f V current=%.3f A power=%.3f W pf=%.4f freq=%.3f Hz energy=%.4f kWh\n",
                  data.sui.voltageVolts, data.sui.currentAmps, data.sui.activePowerWatts,
                  data.sui.powerFactor, data.sui.frequencyHz, data.sui.energyKwh);
  } else {
    Serial.println("SUI: read failed");
  }
  Serial.printf("Fire level=%d\n", data.fireLevel);
  Serial.println("===========================");
}

void publishTelemetry() {
  publishCount++;
  SensorSnapshot sensors = readAllSensors();
  printSensorSnapshot(sensors);

  const float temperature = sensors.dht11.valid ? sensors.dht11.temperatureCelsius : lastValidTemperature;
  const float humidity = sensors.dht11.valid ? sensors.dht11.humidityPercent : 0.0f;
  const float currentRms = sensors.suiValid ? sensors.sui.currentAmps : 0.0f;

  StaticJsonDocument<1536> doc;
  doc["id"] = String(publishCount);
  doc["version"] = "1.0";

  JsonObject params = doc.createNestedObject("params");
  params["smoke_ppm"]["value"] = sensors.smoke.densityPercent;
  params["temperature"]["value"] = temperature;
  params["humidity"]["value"] = humidity;
  params["temp_rise_rate"]["value"] = sensors.tempRiseRate;
  params["flame_intensity"]["value"] = sensors.flame.intensityPercent;
  params["current_rms"]["value"] = currentRms;
  if (UPLOAD_SUI_DETAIL_FIELDS) {
    params["voltage"]["value"] = sensors.suiValid ? sensors.sui.voltageVolts : 0.0f;
    params["active_power"]["value"] = sensors.suiValid ? sensors.sui.activePowerWatts : 0.0f;
    params["power_factor"]["value"] = sensors.suiValid ? sensors.sui.powerFactor : 0.0f;
    params["frequency"]["value"] = sensors.suiValid ? sensors.sui.frequencyHz : 0.0f;
    params["energy_kwh"]["value"] = sensors.suiValid ? sensors.sui.energyKwh : 0.0f;
    params["sui_valid"]["value"] = sensors.suiValid ? 1 : 0;
  }
  params["fire_level"]["value"] = sensors.fireLevel;
  params["room_id"]["value"] = ROOM_ID;
  params["building_id"]["value"] = BUILDING_ID;
  params["floor_id"]["value"] = FLOOR_ID;

  char payload[1536];
  size_t length = serializeJson(doc, payload);

  String topic = propertyTopic();
  Serial.print("Publish topic: ");
  Serial.println(topic);
  Serial.print("Publish payload: ");
  Serial.println(payload);

  bool ok = mqtt.publish(
    topic.c_str(),
    (const uint8_t*)payload,
    (unsigned int)length,
    false
  );

  Serial.println(ok ? "Property publish sent" : "Property publish failed");
  setRgb(ok ? 0 : 80, ok ? 80 : 0, 0);
}

void setup() {
  Serial.begin(115200);
  delay(500);

  rgb.begin();
  rgb.setBrightness(50);
  rgb.clear();
  rgb.show();

  Serial1.begin(SUI_BAUD_RATE, SERIAL_8N1, SUI_RX_PIN, SUI_TX_PIN);
  Serial.println("SUI-101A enabled: module TX -> GPIO9, module RX -> GPIO10, GND -> GND");
  analogReadResolution(12);
  analogSetPinAttenuation(FLAME_AO_PIN, ADC_11db);
  analogSetPinAttenuation(SMOKE_AO_PIN, ADC_11db);
  pinMode(FLAME_DO_PIN, INPUT);
  pinMode(SMOKE_DO_PIN, INPUT);
  pinMode(DHT11_DATA_PIN, INPUT_PULLUP);

  connectWiFi();

  secureClient.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(20);
  mqtt.setBufferSize(1024);

  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    setRgb(80, 0, 0);
    connectWiFi();
  }

  if (!mqtt.connected()) {
    connectMqtt();
  }

  mqtt.loop();

  if (millis() - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = millis();
    publishTelemetry();
  }
}





