# 🎤 VoiCal - 语音日历工具

> 一个以语音交互为核心的智能日历管理工具，帮助用户通过自然语言语音实现日程的高效管理。

## ✨ 功能特性

- 🗣️ **语音添加事件** — 通过自然语言语音快速创建日历事件
- 🗑️ **语音删除事件** — 语音指令删除已有事件
- 🔍 **语音查询事件** — 语音查询特定日期的日程安排
- 🔔 **智能提醒** — 事件到期前自动提醒
- 📅 **可视化日历** — 支持月/周/日多视图切换
- 🧠 **中文自然语言理解** — 准确解析中文日期时间表达

## 🛠️ 技术栈

- **前端框架**: HTML5 + CSS3 + Vanilla JavaScript
- **语音识别**: Web Speech API (SpeechRecognition)
- **语音合成**: Web Speech API (SpeechSynthesis)
- **自然语言处理**: 自研中文日期时间解析引擎
- **数据存储**: IndexedDB 本地存储
- **UI 组件**: 自研日历组件

## 🚀 快速开始

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/voice-calendar.git

# 进入项目目录
cd voice-calendar

# 使用任意 HTTP 服务器运行（推荐使用 VS Code Live Server 或）
npx serve .
```

> ⚠️ 语音功能需要在 HTTPS 或 localhost 环境下使用，需要浏览器授权麦克风权限。

## 📁 项目结构

```
voice-calendar/
├── index.html          # 主页面
├── css/
│   └── style.css       # 样式文件
├── js/
│   ├── app.js          # 应用主入口
│   ├── calendar.js     # 日历核心逻辑
│   ├── speech.js       # 语音识别与合成模块
│   ├── nlp.js          # 中文自然语言日期解析
│   ├── storage.js      # IndexedDB 数据存储
│   └── reminder.js     # 事件提醒模块
├── assets/             # 静态资源
└── README.md
```

## 🎯 核心设计思路

### 语音交互流程

1. 用户点击麦克风按钮或说出唤醒词
2. 系统通过 Web Speech API 实时识别语音输入
3. NLP 引擎解析用户意图（添加/删除/查询）及日期时间信息
4. 执行对应操作并通过语音+视觉双通道反馈结果

### 自然语言理解

支持多种中文日期时间表达方式：
- "明天下午三点开会"
- "下周一上午十点面试"
- "后天晚上八点看电影"
- "这个周五提醒我交报告"

## 📋 开发计划

- [x] 项目初始化与架构设计
- [ ] 日历 UI 组件开发
- [ ] 语音识别模块集成
- [ ] 中文 NLP 日期时间解析引擎
- [ ] 事件 CRUD 功能
- [ ] 语音反馈与提醒系统
- [ ] UI 美化与动画效果
- [ ] 测试与优化

## 📄 依赖说明

本项目采用纯原生 Web 技术实现，**无第三方框架依赖**：
- Web Speech API（浏览器原生）
- IndexedDB（浏览器原生）
- CSS3 Animations（浏览器原生）

## 📝 License

MIT License
