# 设计系统

> 数值全部来自对参考截图（apple.com.cn 商店各页）的**像素实测**，不是目测。
> 实测手段：Pillow 采样主色与饱和度聚类 / 行带分析测字高与行距 / 圆角首像素内缩反推半径。

对照页：开发服务器启动后访问 `/design`，可逐项核验下方所有 token。

---

## 0. 规范铁律

1. **零阴影** —— 全站不使用 `box-shadow`（唯一例外是键盘聚焦环）。
2. **零渐变** —— 不使用 `linear-gradient` / `radial-gradient`。
3. **只有一个高饱和色** —— `--color-accent: #0071e3`。其余全部是中性灰阶。
4. **层次靠三样东西建立**：圆角、1px 发丝线、底色差（`#f5f5f7` ↔ `#ffffff`）。
5. **层级靠极端字号差**，不靠颜色和装饰堆叠。主标题 : 正文 ≈ 7 : 1。

---

## 1. 配色

| 角色 | Token | 色值 | 实测依据 |
|---|---|---|---|
| 页面背景 | `--color-page` | `#f5f5f7` | 商店页占比 89.7% |
| 内容面 | `--color-surface` | `#ffffff` | 卡片区占比 50.6% |
| 深色区块 | `--color-dark` | `#000000` | 全站唯一使用纯黑处 |
| 胶囊底 | `--color-capsule` | `#e8e8ed` | 标签胶囊 |
| 主文字 | `--color-ink` | `#1d1d1f` | 标题正文主色（**非纯黑**） |
| 次级文字 | `--color-ink-muted` | `#6e6e73` | 说明文字 |
| 功能主色 | `--color-accent` | `#0071e3` | 详情页按钮，实测 6972 个蓝色像素 |
| 主色 hover | `--color-accent-hover` | `#0077ed` | |
| 链接 | `--color-link` | `#0066cc` | 商店页文字链 |
| 强调标签 | `--color-mark` | `#b64400` | 仅用于 12px 的「新款」类标签 |
| 发丝线 | `--color-hairline` | `#d2d2d7` | 1px 分割线 |
| 发丝线（浅） | `--color-hairline-soft` | `rgba(0,0,0,.08)` | 导航栏下边框 |

**对比度**：`#1d1d1f` on `#f5f5f7` ≈ 13:1；`#ffffff` on `#0071e3` ≈ 4.6:1 —— 均达 WCAG AA。

---

## 2. 字体

字体栈（**不下载 Web Font**，本机境外 CDN 不可达）：

```
system-ui, -apple-system, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif
```

| 层级 | Token | 规格 | 实测依据 |
|---|---|---|---|
| hero | `--text-hero` | 112px / 600 / lh 1.05 / ls −0.02em | 「商店」字面高 100px |
| display | `--text-display` | 48px / 600 / lh 1.2 | 商品标题 3 行、行距 58px |
| title | `--text-title` | 28px / 600 / lh 1.25 | |
| subtitle | `--text-subtitle` | 21px / 600 / lh 1.3 | |
| body | `--text-body` | 17px / 400 / lh 1.47 | |
| small | `--text-small` | 14px / 400 / lh 1.5 | |
| micro | `--text-micro` | 12px / 400 / lh 1.33 | 导航字面高 13px |

---

## 3. 间距与留白

| Token / 类 | 值 | 实测依据 |
|---|---|---|
| `--spacing-section` | 100px | 区块间距实测 80–120px |
| `--spacing-block` | 40px | 区块内主要间距 |
| `--spacing-card` | 22px | 卡片间隙实测 29px / 卡宽 470px ≈ 6% |
| `.container-page` | 左右 5.3%，最大宽 1680px | 实测 131px / 2473px |

---

## 4. 圆角（首像素内缩反推）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-card` | 22px | 卡片（顶行内缩 23px） |
| `--radius-card-sm` | 12px | 选项卡 |
| `--radius-btn` | 10px | 主按钮（内缩 9px） |
| `--radius-thumb` | 8px | 缩略图 |

---

## 5. 组件

| 组件 | 规格 |
|---|---|
| `.card` | 白底 + 22px 圆角 + **无边框无阴影** |
| `.btn-primary` | 高 53px（移动端 48px）、圆角 10px、纯色填充、白字、无阴影 |
| `.btn-secondary` | 透明底 + 1px 主色描边 + 主色文字 |
| `.navbar` | 背景与页面同色、毛玻璃、底部 1px 发丝线、**不用阴影** |
| `.capsule` | 胶囊底 + 全圆角 + 12px |
| `.marker` | 12px / 600 / `--color-mark` |
| `.hairline-box` | 1px `#d2d2d7` 描边 + 12px 圆角 |
| `.tabbar` | 移动端底部固定、毛玻璃、顶部发丝线、49px + 安全区 |

---

## 6. 布局结构

1. 顶部通栏导航：居中、12px、低对比、粘性
2. **巨型标题区**：左超大标题 ‖ 右辅助文案 + 文字链接，双栏大留白
3. **横向溢出轮播**：卡片等宽、缺口一致、右侧被裁切以暗示可滑动
4. **详情页 = 左信息 / 右大图**（约 40% : 60%）
5. 移动端单列堆叠，操作条固定底部

**明暗节奏**：首页「四大货币体系」轮播使用 `--color-dark`，与 `#f5f5f7` 正文区交替。

---

## 7. 移动端 token 降级

`src/styles/index.css` 末尾的媒体查询直接覆盖 CSS 变量，Tailwind 工具类引用的是这些变量，因此全局生效，无需逐处写响应式前缀：

```css
@media (max-width: 767px) {
  :root {
    --text-hero: 44px;
    --text-display: 30px;
    --text-title: 22px;
    --text-subtitle: 19px;
    --spacing-section: 48px;
    --spacing-block: 28px;
    --radius-card: 18px;
  }
}
```

---

## 8. 到钱币库页面的映射

| 参考结构 | 钱币库对应 |
|---|---|
| 通栏导航 | 钱币库 / 时间轴 / 体系演化 / 术语词典 |
| 巨型标题「商店」 | 「数字钱币库」+ 统计数字 |
| 新品卡轮播 | 四大货币体系卡片 |
| 配件卡片网格 | 钱币卡片网格 |
| 商品详情页 | 钱币详情页（左参数 / 右大图） |
| 购买页选项卡 | 详情页「同体系钱币」 |
| 底部黑条 | 移动端底部 Tab 栏 |
| 橙色「新款」 | 橙色「存世极少」「秦统一」等标记 |
| 蓝色主按钮 | 「加入对比」「查看大图」 |
