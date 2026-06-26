# 云服务器部署说明

`https://iot.10086.cn/` / OneNET 主要负责设备接入、物模型、数据转发和可视化，不是普通 Node.js 网站托管空间。推荐部署方式是：

```text
ESP32 设备 -> OneNET MQTT/物模型 -> OneNET 规则引擎 -> 你的云服务器 HTTPS 地址 -> 寓安芯 Web/API
```

也就是说，网页和后端部署在云服务器；OneNET 中配置产品、设备、物模型和规则引擎 Webhook。

## 方案一：普通云服务器部署

适合阿里云、腾讯云、华为云、中国移动云等 Linux 云服务器。

### 1. 安装 Node.js

建议 Node.js 18 或 20。

```bash
node -v
npm -v
```

### 2. 上传项目

把本项目上传到服务器，例如：

```text
/opt/yuananxin
```

### 3. 启动服务

```bash
cd /opt/yuananxin
npm start
```

服务默认监听：

```text
0.0.0.0:3000
```

浏览器访问：

```text
http://服务器公网IP:3000
```

### 4. 放行安全组

在云服务器控制台放行：

```text
TCP 3000
TCP 80
TCP 443
```

正式展示建议只对外开放 `80/443`，由 Nginx 反向代理到本机 `3000`。

## 方案二：systemd 常驻运行

复制服务文件：

```bash
sudo cp deploy/yuananxin.service /etc/systemd/system/yuananxin.service
sudo systemctl daemon-reload
sudo systemctl enable yuananxin
sudo systemctl start yuananxin
sudo systemctl status yuananxin
```

查看日志：

```bash
journalctl -u yuananxin -f
```

## 方案三：Docker 部署

构建镜像：

```bash
docker build -t yuananxin-iot .
```

运行容器：

```bash
docker run -d --name yuananxin-iot -p 3000:3000 --restart unless-stopped yuananxin-iot
```

访问：

```text
http://服务器公网IP:3000
```

## 配置 HTTPS

1. 准备域名，例如：

```text
yuananxin.example.com
```

2. 域名解析到服务器公网 IP。
3. 安装 Nginx。
4. 修改 `deploy/nginx-yuananxin.conf` 中的：

```text
server_name your-domain.example.com;
```

改成你的真实域名。

5. 启用配置：

```bash
sudo cp deploy/nginx-yuananxin.conf /etc/nginx/conf.d/yuananxin.conf
sudo nginx -t
sudo systemctl reload nginx
```

6. 使用 Certbot 申请 HTTPS 证书：

```bash
sudo certbot --nginx -d yuananxin.example.com
```

最终访问地址：

```text
https://yuananxin.example.com
```

## OneNET 配置

在 OneNET / `https://iot.10086.cn/` 中：

1. 创建产品：`寓安芯-寝室安全终端`。
2. 接入协议选择 `MQTT`。
3. 按 `config/onenet-product-model.json` 建立属性、事件和命令。
4. 为每个寝室创建设备，保存设备鉴权信息。
5. 在规则引擎中配置 HTTP Webhook：

```text
https://你的域名/api/onenet/webhook
```

6. 转发事件：

```text
fire_warning
fire_alarm
illegal_appliance_alarm
device_offline
```

## ESP32 配置

打开：

```text
firmware/esp32_onenet_example.ino
```

替换：

```text
WIFI_SSID
WIFI_PASSWORD
MQTT_HOST
PRODUCT_ID
DEVICE_NAME
DEVICE_TOKEN
```

然后烧录到 ESP32。

## 推荐演示路径

比赛或答辩时建议这样展示：

1. 打开云端网页大屏。
2. 在 OneNET 控制台展示设备在线和属性上报。
3. 点击网页中的“烟雾预警 / 明火告警 / 违规电器”模拟按钮。
4. 展示告警记录、消息推送队列和逃生路径。
5. 展示 OneNET 规则引擎 Webhook 地址，说明真实设备触发后会走同一条链路。
