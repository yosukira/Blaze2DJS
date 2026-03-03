# 🔥 Blaze2D

**[English](#english) | [简体中文](#简体中文)**

---

<h2 id="english">🇬🇧 English</h2>

**WebGL Drop-in Accelerator for HTML5 Canvas 2D.**

Blaze2D is a high-performance, lightweight WebGL 2D rendering engine. It is a drop-in replacement for CanvasRenderingContext2D.

Designed specifically for "Vampire Survivors" style games (Bullet Heaven / Horde Survival), where drawing 10,000+ sprites and damage numbers simultaneously will instantly crash a standard Canvas 2D context.

![Size](https://img.shields.io/badge/size-lightweight-brightgreen)
![Dependencies](https://img.shields.io/badge/dependencies-0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

### 🎮 Live Demo
* 🕹️ **[Survival Game Demo](https://bsstata.icu:5000)** - A fully playable web game utilizing `Blaze2D`. It renders thousands of monsters, particles, and GPU-calculated damage numbers at a buttery smooth 60FPS. *(Note: Hosted on a custom server).*
* <img width="215" height="925" alt="image" src="https://github.com/user-attachments/assets/5cd0b699-37b6-4a42-867e-e1c04560abf0" />


### ✨ Features
- 🔄 **Canvas 2D API Hijacking:** Supports `save()`, `restore()`, `translate()`, `globalAlpha`, `drawImage`, and even complex paths (via offscreen texture caching). Almost zero code changes needed to upgrade your existing game.
- 📦 **Dynamic Runtime Atlasing:** Automatically packs hundreds of small `<img>` or `Canvas` elements into a 4096x4096 master texture on the fly. Compresses thousands of Draw Calls into exactly **1 Draw Call**.
- 🧮 **GPU Physics for Damage Numbers:** Calculating physics (gravity, velocity, scaling, fading) for 4,000 damage numbers on the CPU is slow. Blaze2D moves the entire parabolic trajectory calculation into the **Vertex Shader**. You spawn it once, the GPU handles the rest.
- 🎨 **Built-in Advanced FX Shaders:** Includes production-ready Fragment Shaders for game effects like "Gravity Blackholes" (distortion & noise) and "Ice Fields" (refraction & snowflakes).

### 🚀 Quick Start
```javascript
import { Blaze2D } from './blaze2d.js';

const canvas = document.getElementById('gameCanvas');
// Replace your old ctx: const ctx = canvas.getContext('2d');
const ctx = new Blaze2D(canvas);

function gameLoop(time) {
    // 1. Update engine time & camera (for GPU Shaders)
    ctx.setTime(time / 1000);
    ctx.setCamera(player.x, player.y);

    ctx.clear();

    // 2. Draw exactly like standard Canvas 2D!
    ctx.save();
    ctx.translate(100, 100);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(monsterImage, 0, 0, 50, 50);
    ctx.restore();

    // 3. GPU Accelerated Damage Numbers (No CPU overhead for animation)
    // text, x, y, vx, vy, startTime, duration, size, color, alpha
    ctx.drawGPUDamageNumber("-999", 100, 100, 50, -200, time/1000, 1.0, 24, "#ff0000", 1);
    ctx.flushDamageNumbers();

    // 4. Flush the main batch
    ctx.flush();
    
    requestAnimationFrame(gameLoop);
}
```
### This project was built with the assistance of AI.
---

<h2 id="简体中文">🇨🇳 简体中文</h2>

**专为海量精灵同屏打造的 Canvas 2D 终极 WebGL 加速引擎。**

Blaze2D 是一个极高性能的 WebGL 2D 渲染器。它完美模拟了原生的 `CanvasRenderingContext2D` API，但底层采用纯粹的 WebGL 批次渲染技术。

如果你正在开发《吸血鬼幸存者》类的割草游戏（同屏出现成千上万的怪物、粒子和暴击伤害数字），原生的 Canvas 2D 会让帧率瞬间跌至个位数。而 Blaze2D 就是为了解决这个性能瓶颈而生的。

### 🎮 Demo
* 🕹️ **[割草游戏Demo](https://bsstata.icu:5000)** - 这是一个完整的可玩网页游戏，底层渲染全部由 `Blaze2D` 接管。在海量怪物与全屏特效下依然保持 60 帧满帧运行。（注：部署在独立服务器，首次加载请稍候）。
* <img width="215" height="925" alt="image" src="https://github.com/user-attachments/assets/5d0bf2eb-941e-481b-9584-ee91390d78cb" />


### ✨ 特性
- 🔄 **无缝接管 Canvas 2D:** 实现了 `save()`, `restore()`, `translate()`, `globalAlpha`, `drawImage` 等标准 API。对于 WebGL 难以处理的复杂路径（如贝塞尔曲线描边文字），采用离屏缓存降级策略。你几乎不需要修改业务代码就能让游戏帧率翻倍。
- 📦 **运行时动态合图 (Dynamic Atlasing):** 引擎会在运行时自动将散落的零碎图片和内存 Canvas 塞进一张 4096x4096 的超级纹理中。这使得成千上万次碎片的 Draw Call 被强行压缩为 **1 次绘制调用**。
- 🧮 **GPU 物理计算 (极致伤害数字):** 如果用 JS 主线程去计算 4000 个伤害数字的重力、抛物线、缩放和透明度，游戏会立刻卡死。Blaze2D 创新性地将这套物理逻辑写进了**顶点着色器 (Vertex Shader)** 中。CPU 只需要发号施令，所有的动画全由显卡并行计算完毕！
- 🎨 **内置高级特效着色器:** 引擎内部已经为你写好了游戏常用的高级 Fragment Shader，如“重力场（空间扭曲与哈希噪声）”和“极寒冰场（冰裂纹与折射）”，无需挂载沉重的粒子系统。

### 🚀 快速开始
```javascript
import { Blaze2D } from './blaze2d.js';

const canvas = document.getElementById('gameCanvas');
// 替换你原有的 ctx 获取方式：const ctx = canvas.getContext('2d');
const ctx = new Blaze2D(canvas);

function gameLoop(time) {
    // 1. 同步时间与摄像机（用于 GPU 着色器计算）
    ctx.setTime(time / 1000);
    ctx.setCamera(player.x, player.y);

    ctx.clear();

    // 2. 像使用普通 Canvas 2D 一样画图！
    ctx.save();
    ctx.translate(100, 100);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(monsterImage, 0, 0, 50, 50);
    ctx.restore();

    // 3. 触发 GPU 加速的伤害数字（零 CPU 动画开销）
    // 参数: 文本, X, Y, 初速度X, 初速度Y, 出生时间, 持续时长, 字号, 颜色, 透明度
    ctx.drawGPUDamageNumber("-999", 100, 100, 50, -200, time/1000, 1.0, 24, "#ff0000", 1);
    ctx.flushDamageNumbers();

    // 4. 提交当前帧批次
    ctx.flush();
    
    requestAnimationFrame(gameLoop);
}
```
### 本项目在 AI 的辅助下构建。
