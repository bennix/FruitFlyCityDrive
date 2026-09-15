# FruitFlyCityDrive

一座持续运行的上海中心城区三维交通实验：将果蝇全脑神经活动接入实验车，并让 100 个轻量果蝇启发“行人脑”和 1,000 个“车辆脑”在同一套路网、信号和碰撞规则中行动。

> 这是可观察的神经控制实验，不是自动驾驶能力声明。路线规划、交通规则和碰撞保护由外部控制器执行；脑模型接收结构化感知输入，车载摄像头画面供人类观察。

> **在线网页仅作效果演示，不连接真实全脑。** 要运行真实 Brian2 全脑模型，请 Clone 本仓库、获取上游全脑数据，并按下方步骤启动本地服务。

## 在线演示 / Online Demo

- 在线效果演示：[https://bennix.github.io/FruitFlyCityDrive/](https://bennix.github.io/FruitFlyCityDrive/)
- `/`：项目 Landing Page
- `/simulation.html`：三维模拟控制室

在线版本展示 Landing Page、三维城市、交通参与者和轻量启发模型。GitHub Pages 无法运行 Python/Brian2 服务，因此在线版本不连接真实全脑。

The hosted version demonstrates the landing page, 3D city, traffic agents, and lightweight inspired models. GitHub Pages cannot run the Python/Brian2 service, so the hosted demo is not connected to the real whole-brain model.

## 本地运行 / Run Locally

### 1. 克隆项目 / Clone the repository

```sh
git clone https://github.com/bennix/FruitFlyCityDrive.git
cd FruitFlyCityDrive
```

### 2. 安装网页依赖 / Install web dependencies

需要 Node.js 20 或更高版本。Node.js 20 or newer is required.

```sh
npm install
npm run build
```

### 3. 安装真实全脑模型 / Install the real whole-brain model

需要 Python 3.11 和 Git LFS。Python 3.11 and Git LFS are required.

```sh
git lfs install
git clone https://github.com/lixiang1076/fly-brain.git vendor/fly-brain
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`vendor/fly-brain` 包含体积较大的连接组数据，下载和首次 Brian2 编译可能需要一些时间。

`vendor/fly-brain` contains large connectome data. The download and first Brian2 compilation may take some time.

### 4. 启动完整模拟 / Start the full simulation

macOS / Linux：

```sh
.venv/bin/python city_server.py
```

Windows PowerShell：

```powershell
.venv\Scripts\python.exe city_server.py
```

浏览器打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)，再从 Landing Page 进入 3D 模拟器。保持终端运行，真实全脑请求由本地 Python 服务处理。

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) and enter the 3D simulator from the landing page. Keep the terminal running; the local Python service handles real whole-brain requests.

### 5. 前端开发模式 / Frontend development mode

保持 `city_server.py` 运行，并在另一个终端执行：

Keep `city_server.py` running and execute this in another terminal:

```sh
npm run dev
```

Vite 开发服务器会把 `/api` 请求代理到 `http://127.0.0.1:8080`。

The Vite development server proxies `/api` requests to `http://127.0.0.1:8080`.

## 模拟内容

- **上海路网**：基于 OpenStreetMap 的黄浦、静安中心城区数据，包含 1,700 个节点、2,218 条路段、4,461 个原始建筑轮廓，以及高架、匝道和单行方向。
- **起终点**：支持随机选择、下拉框选择、三维节点点选和二维地图点选。
- **交通系统**：595 个地面信号路口、2,380 面四向联合控制信号灯、斑马线、100 名行人和 1,000 辆其他车辆。
- **安全保护**：实验车、其他车辆和行人均检查建筑、灯杆、桥体及动态对象；车辆在停止线前等红灯，进入路口后继续清空。
- **持续行为**：行人在 5–6 个相邻街段内连续选择目的地，遵循行人灯并保留少量观察车流后过街的行为；拥挤过街具有从众加速。
- **自我脱困**：车辆遇到队列、匝道合流或局部阻塞时尝试合法改道，并通过路口预约和卡死恢复规则减少互锁。
- **时间控制**：默认仿真时长 1,000 秒，界面提供 5×、10×、15×、20× 速度。

地图来源和几何限制见 [city/OSM-SOURCE.md](city/OSM-SOURCE.md)。交通配时和交通流是合成数据，并非上海实测交通。

## 神经控制与实时显示

`city_server.py` 使用 Brian2 运行真实连接组模型。每个请求计算独立的 400 ms 窗口：P9 放电参与车速控制，DNa 左右活动影响转向，危险输入刺激 LC4 感觉神经元。接口返回实际输出频率、活跃神经元数、原始神经元 ID 和放电时间；控制室将这些事件绘制为横向滚动的放电时序图。

没有 Python 全脑服务时，网页仍可展示城市与轻量启发模型，但不会产生真实 Brian2 窗口。脑点图采用示意布局，连线并非真实突触；摄像头像素也尚未作为脑模型输入。

## 边开边学

刺激适配器使用在线表格 Q-learning，根据路线进展、等待、偏离、碰撞和到达反馈调整下一次刺激强度及转向偏置。策略分别按控制模式保存在浏览器 `localStorage`，可连续训练、冻结评估、清除或随实验 JSON 导出。

这里更新的是脑模型外部的刺激策略，并未修改真实果蝇连接组或突触权重。100 名行人和 1,000 辆其他车辆使用实时轻量果蝇启发网络，并在界面中明确标识为简化模型。

## 验证

```sh
npm test
npm run build
```

测试覆盖有向路网、道路分层、交通信号、停止线、碰撞保护、行人过街、拥堵恢复、仿真时长和学习状态序列化。可选浏览器集成检查会调用真实全脑接口：

```sh
.venv/bin/python city/check_browser.py
```

## 数据许可

地图数据 © OpenStreetMap contributors，依据 [ODbL](https://www.openstreetmap.org/copyright) 使用。上游全脑模型及其数据遵循各自仓库的许可。
