# 寓安芯 OneNET 物联网平台原型

这是一个可本地运行的比赛原型，实现 `ESP32 + OneNET MQTT + 自建业务服务 + 可视化大屏 + 学生端推送 + 逃生路径生成` 的核心闭环。

## 功能

- 设备接入与管理：模拟 ESP32 设备通过 OneNET MQTT 上报属性，支持命令下发队列。
- 数据可视化：展示烟雾浓度、温度、电流曲线和寝室楼层态势。
- 告警闭环：支持烟雾预警、明火告警、违规电器告警和消息推送队列。
- 逃生路径：根据火源寝室和楼层图计算最短安全路径，并在网页端高亮。
- OneNET 对接：提供物模型模板、规则引擎 Webhook 和 ESP32 示例固件。

## 快速运行

```powershell
npm.cmd start
```

打开：

```text
http://localhost:3000
```

运行测试：

```powershell
npm.cmd test
```

## 云服务器部署

OneNET / `https://iot.10086.cn/` 用于设备接入、物模型和规则引擎转发；本项目的网页和后端建议部署到云服务器。

详细部署步骤见：

```text
DEPLOYMENT.md
```

## OneNET 平台配置

1. 在 OneNET Studio 创建产品：`寓安芯-寝室安全终端`。
2. 接入协议选择 `MQTT`，为每个寝室创建设备。
3. 按 `config/onenet-product-model.json` 创建属性、事件和命令。
4. 在规则引擎中将 `fire_warning`、`fire_alarm`、`illegal_appliance_alarm`、`device_offline` 转发到：

```text
http://你的服务器地址/api/onenet/webhook
```

5. ESP32 固件参考 `firmware/esp32_onenet_example.ino`，替换 Wi-Fi、产品 ID、设备名、设备鉴权和 MQTT 地址。

## API

### 上报遥测

```http
POST /api/telemetry
Content-Type: application/json
```

```json
{
  "device_id": "YAX-B1-F3-R302-A",
  "room_id": "302",
  "smoke_ppm": 410,
  "temperature": 34,
  "temp_rise_rate": 3.2,
  "flame_intensity": 12,
  "current_rms": 1.7,
  "appliance_type": "normal",
  "fire_level": 1
}
```

### OneNET 规则引擎 Webhook

```http
POST /api/onenet/webhook
Content-Type: application/json
```

```json
{
  "event": "fire_alarm",
  "device_id": "YAX-B1-F3-R302-A",
  "data": {
    "room_id": "302",
    "smoke_ppm": 680,
    "temperature": 68,
    "temp_rise_rate": 12,
    "flame_intensity": 88,
    "current_rms": 2.1,
    "fire_level": 2
  }
}
```

### 命令下发

```http
POST /api/command
Content-Type: application/json
```

```json
{
  "device_id": "YAX-B1-F3-R302-A",
  "command": "set_thresholds",
  "params": {
    "smoke_ppm": 320,
    "temperature": 55,
    "temp_rise_rate": 8,
    "current_rms": 5.5
  }
}
```

## 目录

```text
server.js                         后端 API、Webhook、告警、路径规划
public/index.html                 管理大屏和学生端演示
public/styles.css                 UI 样式
public/app.js                     前端交互和可视化
config/onenet-product-model.json  OneNET 物模型模板
firmware/esp32_onenet_example.ino ESP32 示例固件
tests/run-tests.js                核心逻辑测试
```
