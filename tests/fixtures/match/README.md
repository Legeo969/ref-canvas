# reference-match 交叉校验夹具

`reference-match-cases.json` 不是手写的期望值，而是用上游实现算出来的标准答案：

- 上游项目：https://github.com/xrz1411/reference-match （MIT，© 2026 xrz）
- 生成方式：把上游 `core/` 放进 `PYTHONPATH`，用它的 `fit_global_residual_lut`、
  `apply_look_controls`、`apply_residual_rgb`、`analyse_reference` 对固定种子生成的
  图像跑一遍，把输入样本与输出残差一起写成 JSON。
- 数据约定：图像样本按**交错 RGB 三元组**（`R,G,B,R,G,B,…`）展开；残差按
  **交错 RGB 三元组**展开，即 `src/shared/match/residual-lut.ts` 的存储顺序
  （上游内部是 `[channel][blue][green][red]`，生成时做过转置）。

用例覆盖：

| 用例 | 用途 |
| --- | --- |
| `random-16x16-vs-14x14-dim9` | 两张无关随机图，检查整体拟合路径 |
| `warm-ramp-dim17` | 带色度分布的暖色参考，检查分区色度映射与三线性采样 |
| `identity-12x12-dim5` | 同一张图必须得到恒等 LUT |
| `cool-ramp-controls-dim11` | 观感控制（强度 / 分区权重 / 三条保护）逐点对比 |
| `analysis-20x20` | 参考图摘要：亮度分位、饱和度、色相均值、色板 |

## 重新生成

```powershell
git clone --depth 1 https://github.com/xrz1411/reference-match.git G:/tmp/reference-match
python -m venv G:/tmp/reference-match/.venv
G:/tmp/reference-match/.venv/Scripts/python.exe -m pip install numpy torch
# 用仓库内 scripts 里保留的生成脚本重建夹具
```

生成脚本依赖上游源码路径，因此在仓库里只保留说明而不提交脚本本体。若上游算法
有实质更新，重新生成后 `tests/unit/shared/match/port-parity.test.ts` 会以失败的方式
告诉你差异出现在哪里。

## 容差

残差逐点容差 `2e-3`，实际最大误差约 `8.5e-5`（出现在 LUT 边角）。色板单独放宽：
上游 k-means 在 float32 下运行，聚类中心与顺序都会小幅漂移，因此只比较
覆盖率加权的平均色与色板长度。

**注意**：出现「源图某色度轴几乎没有分布」的输入时，本实现会主动塌缩该轴
（见 ADR-0005），与上游不再逐点相同，所以夹具刻意避开了这类用例；对应的行为由
`tests/unit/shared/match/global-match.test.ts` 的退化轴用例单独锁定。
