---
name: trace-run-route
description: Trace a route from an uploaded map screenshot or hand drawing and export editable JSON for the local fy-hb/keep editor. Use for distance estimates, offset laps around a track, and pace-colored segments. Import timed GPX directly in the editor to preserve recorded locations and pace.
---

# 描绘运动路线

交付可导入本地截图编辑器的 `*.route.json`。保留原图供用户在编辑器中叠加路线。若用户上传 GPX，编辑器可直接导入并计算距离与可用的用时。

1. 查看原图和可辨认的起终点。按运动顺序沿路线中心描线，转弯处加点。用原图像素坐标，原点为左上角，向右、向下递增。使用缩略图时按两轴比例还原坐标。看不到的部分留成分段。
2. 用用户提供的距离、可靠的场地资料或原图比例尺确定里程。校准时用描线像素总长除以参考像素长度再乘参考米数；弯曲的已知线段沿曲线测量。跑圈时核对所描的路径与单圈长度对应，场地有标准跑道也需区分跑道和外围步道。实际圈数或路径有歧义时，说明歧义并请用户确认；做示意图时可按说明过的场地设定演示。
3. 重复跑圈时描一条闭合中心线，末点与首点相同，用 `loop` 指定单圈距离和 `driftPixels`（以原图像素计的局部横移幅度）。脚本按总里程画完整圈和剩余一段，圆顺地通过转角。各圈在部分路段自然分开、交叠，再汇回中心线。里程和配速分段按中心线长度计算。有实测分圈轨迹时保留跑过的线。
4. 有分段配速时，按运动顺序保留数值和对应长度，填入 `pace.intervals`。生成普通慢跑示意时，先定起步、稳定跑和结束阶段的配速，再渐变过渡。根据训练类型设置节奏，间歇训练才会出现反复快慢交替。示意使用 `simulated`。各段长度合计应等于总距离，用时按各段距离与配速加权求和。
5. 使用 [route_from_pixels.py](scripts/route_from_pixels.py) 转换。下面的数值是输入格式示例。

```json
{
  "name": "操场跑圈",
  "imageWidth": 800,
  "imageHeight": 600,
  "segments": [[[120, 300], [180, 170], [600, 170], [660, 300], [600, 430], [180, 430], [120, 300]]],
  "distanceMeters": 950,
  "loop": {"distanceMeters": 400, "driftPixels": 9},
  "pace": {"source": "simulated", "intervals": [[150, 375], [150, 363], [200, 355], [200, 352], [150, 345], [100, 338]]}
}
```

```sh
python3 scripts/route_from_pixels.py traced-pixels.json output.route.json
```

`pace.source` 使用 `recorded` 或 `simulated`。每段为 `[米数, 秒/公里]`。上例得到 2 个完整圈和 150 米，青蓝为较快、橙红为较慢。

普通描线可只填 `distanceMeters`，或用 `reference` 计算。参考项为 `{"method":"scale-bar","points":[[30,562],[130,562]],"meters":200}`，沿弯曲已知线段时使用 `known-segment`。旧版 `laps` 仍可用于将参考测得的单圈长度乘以圈数。无可用标尺或总距离时留空。

浏览器中上传同一张原图、导入 JSON 并适配路线。检查线条和分段颜色在缩小的截图上是否清楚，首个和最后一个轨迹点是否对应起终点。跑完完整圈时起终点可指向同一位置，剩余一段时终点应落在实际停下的位置。交付可编辑 JSON 和截图，并注明单圈依据和配速来源。
