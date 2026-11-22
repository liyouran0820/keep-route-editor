---
name: trace-run-route
description: Trace a route visible in an uploaded map screenshot or hand-drawn image, estimate its distance from a scale reference when available, and export editable route JSON for the local fy-hb/keep screenshot editor. For GPX, use the editor’s native import.
---

# 描绘运动路线

交付可导入本地截图编辑器的 `*.route.json`。保留原图供用户在编辑器中叠加路线。若用户上传 GPX，编辑器可直接导入并计算距离与可用的用时。

1. 查看原图和可辨认的起终点或用户标记。按运动顺序用原图像素坐标描出路线，转弯处加点。坐标以原图左上为 `[0, 0]`，向右、向下递增。检查描线和原图边界是否重合。预览图缩放时，按实际比例还原坐标。
2. 无法判断相交路线的顺序或重叠圈数时，先描述歧义并请用户确认。看不到的部分留成分段，避免把两个断开的点连成直线。
3. 有比例尺时，读取标注的实际长度和两端像素坐标。已知距离对应图中的某一段弯曲路线时，按那一段的路径测量像素长度。距离估算采用描线像素总长除以参考像素长度再乘参考米数。尺标不清楚、手绘图比例不均匀或使用透视照片时，优先用用户给出的总距离，其次留空。
4. 使用 [route_from_pixels.py](scripts/route_from_pixels.py) 转换。给脚本输入如下示例的 JSON，将示例尺寸和坐标换成实际原图数据。

```json
{
  "name": "河滨跑步",
  "imageWidth": 800,
  "imageHeight": 600,
  "segments": [[[85, 340], [160, 280], [280, 290], [490, 366]]],
  "reference": {"method": "scale-bar", "points": [[30, 562], [130, 562]], "meters": 200},
  "laps": 1
}
```

```sh
python3 scripts/route_from_pixels.py traced-pixels.json output.route.json
```

`reference.method` 可填 `scale-bar` 或 `known-segment`。用户给出总距离时，用 `distanceMeters` 代替 `reference`。圈数仅用于把单圈描线的估算距离乘以实际圈数。已描绘全部圈数，或使用用户给出的总距离时，无需重复相乘。无可靠距离时两项都省略。

交付 JSON 并说明距离来自比例尺、已知路线段、用户提供，或待填写。在网页的「自定义背景」上传同一张原图，在「可编辑轨迹」导入 JSON，再点「适配路线」查看绘制结果。
