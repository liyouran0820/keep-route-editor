# 运动路线截图编辑器

将地图、航拍、手绘图或普通照片用作底图，叠加运动路线，导出 PNG。编辑器沿用 `fy-hb/keep` 的截图模板，并增加自定义取景、GPX 导入、分段配速着色和图片描线流程。底图与轨迹文件在本地浏览器处理。

## 本地启动

用 Python 3 启动静态文件服务。

```sh
git clone https://github.com/liyouran0820/keep-route-editor.git
cd keep-route-editor
python3 -m http.server 8765 --bind 127.0.0.1
```

在浏览器打开 [本地编辑器](http://127.0.0.1:8765/)。页面打开后即可预览内置展示场景。

## 制作路线截图

1. 在「自定义背景」选择图片。可使用「底图缩放」和「移动底图」取景。
2. 在「可编辑轨迹」手绘路线，或点「导入轨迹」读取 GPX 或路线 JSON。导入后可用「适配路线」把整条线路放进地图区域。
3. 填写运动信息。配速支持 `05:30` 和原版的 `5.30` 格式。填写用时后，编辑器会用距离计算平均配速。
4. 选择「随机配色」或「配速配色」。有分段配速时，青蓝色表示较快路段，橙红色表示较慢路段。绿色和红色图钉分别贴在路线起点和终点。
5. 点「保存图片」。默认导出尺寸为 **1080 × 2157**。

GPX 导入保留 GPS 点的顺序，可根据坐标计算距离，并在记录带时间戳时计算用时和分段配速。像素路线 JSON 与制作它时使用的底图对齐。GPX 和普通图片可以独立叠加，需要沿地图道路精确对齐时，先用对应地标做配准。

## 从图片描绘路线

[路线 Skill](skills/trace-run-route/SKILL.md) 说明如何为地图、航拍、手绘和普通照片准备底图、描点以及完成截图。地图上有可辨认的路线时沿图描线。照片或插画可作为示意底图，路线形状由用户提供或按示意用途绘制。

- [底图、坐标与取景](skills/trace-run-route/references/background-and-export.md) 说明裁切、旋转和缩放后的对齐要求。
- [路线输入格式与示例](skills/trace-run-route/references/route-json.md) 包含照片上的示意路线、地图比例尺估距和操场跑圈三个例子。跑圈可按单圈长度生成完整圈和剩余距离，并保留分段配速。

使用项目自带的脚本，把原图像素坐标转换成可导入的路线 JSON。

```sh
python3 skills/trace-run-route/scripts/route_from_pixels.py traced-pixels.json output.route.json
```

把用于描线的同一张底图上传到编辑器，再导入生成的 JSON。

## 来源与许可

截图模板、字体、图标及内置地图沿用寒冰维护的开源项目。寒冰的版本基于「四脚兽起飞」发布的南邮跑步截图工具。项目保留上游的版权与 MIT 许可声明。[上游 fy-hb/keep](https://github.com/fy-hb/keep) · [早期项目](https://gitee.com/jimaske/njupt-keep) · [MIT 许可证](LICENSE)
