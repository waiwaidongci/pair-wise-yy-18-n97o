# CoreColumn 地质钻芯编录与柱状图编辑器

基于 SvelteKit、TypeScript、Vite、Skeleton 和 Svelte 5 runes 构建。柱状图、深度标尺和
多孔对比均使用 SVG，钻芯照片由浏览器 Canvas 生成，不需要外部图片或后端服务。

## 功能

- 按深度区间录入岩性、颜色、结构、蚀变、矿化和描述
- 拖动区间边界并校验连续、无重叠、无空段
- 共享深度坐标的标尺、缩放和平移
- Canvas 生成的钻芯照片缩略图与区间联动
- 多钻孔并排对比和手动地层连线
- 修改一个钻孔后对比图实时同步
- 撤销重做、结构化 JSON 导出和打印柱状图
- 野外平板离线编录包合并：按导入边界切开现存区间再叠加，岩性、描述、照片不丢失
- 同一深度段两侧都改过时不覆盖，两个版本列为待处理冲突人工取舍
- 合并后地层连线自动重算，接不上的标为失效（灰色虚线）
- 导入失败时原记录保持不动，可修正数据后重试

## 合并规则

- 导入包为平板导出的 `core-column/field-v1` JSON，含钻孔编号、导出时间和编录区间
- 现存区间先按导入边界切分（切片继承全部属性），再逐段叠加导入内容
- 本地在导出时刻之后改动过的段与导入内容不一致时，记为待处理冲突，不覆盖
- 导入方未带照片的段保留原照片；冲突与合并报告本地持久化，刷新不丢失
- 可运行 `pnpm dlx tsx scripts/verify-merge.mjs` 验证合并引擎行为

## 运行

```bash
export PATH="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH"
corepack pnpm install
corepack pnpm build
corepack pnpm dev
```

