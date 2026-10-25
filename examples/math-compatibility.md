# 公式兼容性检查

本文件可直接放入 Obsidian 笔记库，也可以在 Notion 中通过“导入 → Text & Markdown”尝试导入。Notion 的粘贴和导入不保证将所有公式转换为原生公式块；未识别时，在 Notion 中打开行内公式（Ctrl/Cmd+Shift+E）或 `/math`，粘贴不含美元符号的 LaTeX 源码。

## 行内公式

向量 $x_i \in \mathbb{R}^n$ 的二次项是 $x_i^2$，分式为 $\frac{\alpha}{\sqrt{1+\beta}}$。

## 独立公式

$$
\mathcal{L}(\theta) = \frac{1}{N}\sum_{i=1}^{N}\left(y_i-f_\theta(x_i)\right)^2
$$

## 多行公式和矩阵

$$
\begin{aligned}
A &= \begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix} \\
f(x) &= \frac{1}{2}x^2
\end{aligned}
$$

## 表格

| 名称 | 表达式 |
| --- | --- |
| 分式 | $\frac{a_i}{b^2}$ |
| 绝对值与范数 | $\left\|x\right\| + \Vert v\Vert$ |
| 代码 | `a\|b` |

## 代码中的公式符号保持原样

```python
latex = r"\frac{a_i}{b^2}"
literal_dollars = "$x_i$"
```

## 引用中的公式

> 下式应留在引用块中：
>
> $$
> \int_0^1 x\,dx = \frac{1}{2}
> $$
