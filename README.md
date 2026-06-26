# IoT Competition

寓安芯高校寝室用火安全监测系统。

## 目录

- `esp32/IoT_Competition_OneNET_3Sensors/`：ESP32 传感器采集与 OneNET MQTT 上报代码。
- `web/face2/`：OneNET Web/API 演示平台，支持 1 台真实设备 + 15 个房间演示点位。

## 本地运行网页

```bash
cd web/face2
npm test
npm start
```

浏览器打开 `http://127.0.0.1:3000/`。

## 演示说明

当前样机为单节点：真实 ESP32 默认绑定 `302` 寝室，上报烟雾、火焰、温湿度、电流和房间信息。网页按三层、每层五间寝室建立完整模型，其余房间为演示点位，用于展示系统横向部署后的告警、推送和逃生路径联动能力。
