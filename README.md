# 物化生工业科普小游戏

十个方向不同的科普小游戏，每个都借了市面上好玩游戏的壳。全部**单文件、零依赖**，双击即玩，也可以直接开在线版：

**https://01dingzu.github.io/science-games/**

## 目录结构

```
index.html          聚合页（卡片 + 通关进度，localStorage 记录）
hub.js              共享模块：返回聚合页按钮 + 统一结算面板 + 通关打点
1-fusion.html       游戏页，命名规则 <序号>-<slug>.html
...
tools/              开发用验证脚本，不参与网页运行
```

## 十个游戏

| 文件 | 游戏 | 知识点 | 对标 |
|---|---|---|---|
| 1-fusion | 元素炼金塔 | 核聚变、恒星核合成到铁 | 合成大西瓜 |
| 2-valence | 化学反应连连杀 | 化合价、电荷守恒配平 | 连连看 / 2048 |
| 3-bacteria | 细菌帝国 | 肠道菌群、免疫清除 | 瘟疫公司（反向） |
| 4-mito | 线粒体经理 | 有氧/无氧呼吸、乳酸 | 放置类 |
| 5-bridge | 桥梁工程师 | 受力、桁架、预算约束 | Poly Bridge |
| 6-factory | 万物工厂 | 水泥/钢/玻璃/晶圆/电池工序 | 戴森球计划（轻量） |
| 7-optics | 光的迷宫 | 反射定律、全反射、光纤 | 光学解谜 |
| 8-vaccine | 疫苗工厂 | 变异、产能、舆情 | 经营模拟 |
| 9-fission | 分子弹球 | 链式裂变、控制棒、熔毁 | 愤怒的小鸟 × 弹球 |
| 10-chip | 半导体小镇 | 提纯、制程、良率、禁运 | 经营策略 |

## 关卡设计原则

所有游戏都是多关卡制，遵循从 Baba Is You / Celeste / Monument Valley / Snakebird 归纳的**锯齿难度曲线**：

1. **一关只教一个新机制**，首关几乎不可能输
2. 难度靠**变化**不靠堆数值（加规则，而不是把敌人从 3 个加到 30 个）
3. **峰值后必接回落关**（喘息关 / 变体关），给爽感和消化时间
4. **终局关 = 综合考**，前面所有机制一起上

各游戏关卡表写在文件顶部的 `LEVELS` / `STAGES` / `ORDERS` / `CHAPTERS`，难度值写在同一文件的 `DIFF` 数组里，页面底部会渲染成难度条。

## 怎么加一个新游戏

1. 复制一个现有游戏页，改名 `<序号>-<slug>.html`
2. 在 `<head>` 引入 `<script src="hub.js"></script>`
3. 胜利处调 `hub.finish({ win:true, title, text, stat })`，失败 / 超时处调 `win:false`（`canContinue:true` 可给「继续玩」按钮）
4. 在 `index.html` 的 `.grid` 里加一张卡片：
   ```html
   <a class="card" href="11-xxx.html">
     <div class="ico">🎯</div><h2>游戏名</h2><p>一句话介绍</p>
     <span class="tag t-phy">物理 · 知识点</span><span class="done">✓ 已通关</span>
     <div class="ref">对标：某某游戏</div>
   </a>
   ```
   卡片的 `href` 就是通关记录的 id，进度条 `已通关 N/总数` 会自动跟着卡片数走，不用改 JS
5. 跑一遍 `node tools/smoke-cdp.mjs` 确认能玩

## 验证脚本

需要 Node 18+，在系统已有的 Edge / Chrome 上跑无头 CDP，零 npm 依赖：

```bash
node tools/smoke-cdp.mjs     # 10 个游戏能不能玩（发射 / 点击 / 推进一回合）
node tools/levels-check.mjs  # 关卡表健全性 + 光的迷宫逐关设计解可通 + 难度梯度单调
node tools/verify-hub.mjs    # 通关面板弹出 + 返回聚合页 + 徽章 + 清除记录
```

报告分别落在 `smoke-report-latest.txt`、`levels-check-report.txt`、`hub-verify-report.txt`。当前状态：10/10、13/13、11/11 全通过。

## 说明

游戏规则与文案为原创科普向表达，数值做了游戏化简化（如核聚变条件、工业工序时长），不作为专业依据。
