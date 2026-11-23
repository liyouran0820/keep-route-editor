(() => {
    "use strict";

    const { clamp, formatClock, parseGpx, parseTrace, sceneSize } = RunRoute;
    const $ = id => document.getElementById(id);
    const preview = $("new-Img");
    const background = $("bg-img");
    const WIDTH = 360;
    const HEIGHT = 719;
    const MAP_HEIGHT = 335;
    const ZOOM_MIN = 0.04;
    const SCALE = 3;
    const DEFAULT_COLOR = "#26c99a";
    const COLORS = ["#26c99a", "#48ddad", "#b7ed75", "#f1d96e", "#ff9868", "#35c8d5"];
    const PACE_COLORS = [[29, 159, 211], [19, 176, 161], [28, 178, 112], [223, 167, 43], [220, 100, 69]];
    const PIN_SIZE = 38;
    const PIN_TIP = 145 / 180;

    const layer = document.createElement("canvas");
    layer.id = "editable-route-layer";
    layer.width = WIDTH * SCALE;
    layer.height = HEIGHT * SCALE;
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    preview.insertBefore(layer, $("gui-img"));
    const ctx = layer.getContext("2d");

    const interaction = document.createElement("div");
    interaction.id = "editable-route-pointer";
    interaction.hidden = true;
    interaction.setAttribute("data-html2canvas-ignore", "");
    preview.append(interaction);

    let route = null;
    let view = { zoom: 1, x: 0, y: 0 };
    let mode = null;
    let drag = null;
    let stroke = null;
    let seed = 1;
    let revision = 0;
    let fitOnLoad = false;
    let paceRange = null;

    const startPin = loadPin(start_sign_src);
    const finishPin = loadPin(end_sign_src);

    function loadPin(src) {
        const image = new Image();
        image.onload = draw;
        image.src = src;
        return image;
    }

    function notify(message = "", error = false) {
        $("route-status").textContent = message;
        $("route-status").dataset.error = error;
    }

    function setMode(next) {
        mode = next;
        drag = null;
        stroke = null;
        interaction.hidden = !mode;
        interaction.dataset.mode = mode ?? "";
        $("route-draw").textContent = mode === "draw" ? "完成手绘" : "手绘";
        $("route-pan").textContent = mode === "pan" ? "完成移动" : "移动底图";
        $("route-draw").setAttribute("aria-pressed", mode === "draw");
        $("route-pan").setAttribute("aria-pressed", mode === "pan");
        draw();
    }

    function baseFrames(active) {
        const { naturalWidth: w, naturalHeight: h } = background;
        const picture = w && h ? sceneSize(w, h) : sceneSize(1080, 2157);
        const base = Math.max(WIDTH / picture.width, HEIGHT / picture.height);
        const full = { x: 0, y: 0, width: picture.width * base, height: picture.height * base };
        full.x = (WIDTH - full.width) / 2;
        full.y = (HEIGHT - full.height) / 2;
        if (active?.kind === "gpx") return [full, { x: 0, y: (HEIGHT - WIDTH) / 2, width: WIDTH, height: WIDTH }];
        if (active?.kind === "trace" && active.size && use_default_bg) {
            const factor = Math.min(WIDTH / active.size.width, HEIGHT / active.size.height);
            const width = active.size.width * factor;
            const height = active.size.height * factor;
            return [full, { x: (WIDTH - width) / 2, y: (HEIGHT - height) / 2, width, height }];
        }
        return [full, full];
    }

    function transform([x, y]) {
        return [(x - WIDTH / 2) * view.zoom + WIDTH / 2 + view.x,
            (y - HEIGHT / 2) * view.zoom + HEIGHT / 2 + view.y];
    }

    function position([x, y], frame) {
        return [x * frame.width + frame.x, y * frame.height + frame.y];
    }

    function fit() {
        if (!route?.strokes.length) return;
        const [, frame] = baseFrames(route);
        let top = Infinity;
        let left = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const segment of route.strokes) {
            for (const point of segment) {
                const [x, y] = position(point, frame);
                top = Math.min(top, y);
                left = Math.min(left, x);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
            }
        }
        const zoom = clamp(Math.min(288 / Math.max(24, right - left), 238 / Math.max(24, bottom - top)), ZOOM_MIN, 4);
        view = {
            zoom,
            x: (WIDTH / 2 - (left + right) / 2) * zoom,
            y: 177 - HEIGHT / 2 + (HEIGHT / 2 - (top + bottom) / 2) * zoom,
        };
        sync();
    }

    function randomGenerator(start) {
        let value = start;
        return () => {
            value = (Math.imul(1664525, value) + 1013904223) >>> 0;
            return value / 4294967296;
        };
    }

    function getPaceRange(paces) {
        const values = paces?.flat().filter(value => value != null).sort((a, b) => a - b);
        if (!values?.length) return null;
        const last = values.length - 1;
        const midpoint = values[Math.floor(last / 2)];
        const minimumSpan = Math.max(24, midpoint * 0.09);
        return {
            midpoint,
            fastSpan: Math.max(minimumSpan, midpoint - values[Math.floor(last * 0.1)]),
            slowSpan: Math.max(minimumSpan, values[Math.ceil(last * 0.9)] - midpoint),
        };
    }

    function paceColor(pace) {
        if (pace === null) return DEFAULT_COLOR;
        const { midpoint, fastSpan, slowSpan } = paceRange;
        const ratio = clamp((pace - midpoint) / (pace < midpoint ? fastSpan : slowSpan), -1, 1);
        const position = Math.round((1 + ratio) * 16) / 8;
        const from = PACE_COLORS[Math.floor(position)];
        const to = PACE_COLORS[Math.ceil(position)];
        const blend = position % 1;
        const channels = from.map((channel, index) => Math.round(channel + (to[index] - channel) * blend));
        return "rgb(" + channels.join(",") + ")";
    }

    function drawPaths(paths, frame, active) {
        const enabled = $("inpt_colorchange_checkbox").checked;
        const paces = !enabled && paceRange && active?.paces;
        const multipleLaps = active?.lapInfo && paths.length > 1;
        const probability = clamp(Number($("inpt_bs_prob").value) || 0, 0, 1);
        const min = clamp(Number($("inpt_bs_range_min").value) || 15, 2, 150);
        const max = clamp(Number($("inpt_bs_range_max").value) || 40, min, 200);
        const random = randomGenerator(seed);
        let remaining = min + (max - min) * random();
        let color = enabled ? seed % COLORS.length : 0;

        function line(points, lineColor) {
            ctx.beginPath();
            ctx.moveTo(...transform(points[0]));
            for (const point of points.slice(1)) ctx.lineTo(...transform(point));
            ctx.strokeStyle = lineColor;
            ctx.stroke();
        }

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const plotted = paths.map(path => path.map(point => position(point, frame)));
        ctx.lineWidth = multipleLaps ? 5.8 : 6.5;
        for (const points of plotted) line(points, "#ffffffe0");
        ctx.lineWidth = multipleLaps ? 4 : 4.6;
        for (const [pathIndex, points] of plotted.entries()) {
            if (paces) {
                let start = 0;
                const colors = paces[pathIndex].map(paceColor);
                for (let i = 1; i <= colors.length; i += 1) {
                    if (colors[i] === colors[start]) continue;
                    line(points.slice(start, i + 1), colors[start]);
                    start = i;
                }
                continue;
            }
            if (!enabled) {
                line(points, DEFAULT_COLOR);
                continue;
            }
            let previous = points[0];
            let chunk = [previous];
            for (const point of points.slice(1)) {
                let distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
                while (distance >= remaining) {
                    const fraction = remaining / distance;
                    const cut = previous.map((value, axis) => value + (point[axis] - value) * fraction);
                    chunk.push(cut);
                    line(chunk, COLORS[color]);
                    if (random() < probability) color = (color + 1 + Math.floor(random() * (COLORS.length - 1))) % COLORS.length;
                    distance -= remaining;
                    remaining = min + (max - min) * random();
                    previous = cut;
                    chunk = [cut];
                }
                chunk.push(point);
                remaining -= distance;
                previous = point;
            }
            if (chunk.length > 1) line(chunk, COLORS[color]);
        }
    }

    function drawEndpoints(paths, frame) {
        if (!startPin.naturalWidth || !finishPin.naturalWidth) return;
        const start = transform(position(paths[0][0], frame));
        const finish = transform(position(paths.at(-1).at(-1), frame));
        const distance = Math.hypot(start[0] - finish[0], start[1] - finish[1]);
        const finishSize = PIN_SIZE * (0.56 + 0.44 * Math.min(distance / 22, 1));

        function pin(image, [x, y], size) {
            ctx.drawImage(image, x - size / 2, y - size * PIN_TIP, size, size);
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, WIDTH, MAP_HEIGHT);
        ctx.clip();
        pin(startPin, start, PIN_SIZE);
        pin(finishPin, finish, finishSize);
        ctx.restore();
    }

    function draw() {
        const draft = stroke?.length > 1;
        const paths = draft ? [...(route?.kind === "manual" ? route.strokes : []), stroke] : route?.strokes;
        const active = draft ? { kind: "manual" } : route;
        layer.hidden = !active && view.zoom === 1 && view.x === 0 && view.y === 0;
        if (layer.hidden) return;
        const [full, frame] = baseFrames(active);
        ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
        ctx.fillStyle = "#f0eee8";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        if (background.complete && background.naturalWidth && (active?.kind !== "gpx" || !use_default_bg)) {
            const [x, y] = transform([full.x, full.y]);
            ctx.drawImage(background, x, y, full.width * view.zoom, full.height * view.zoom);
        }
        if (paths?.length) {
            drawPaths(paths, frame, active);
            drawEndpoints(paths, frame);
        }
    }

    function sync() {
        $("route-shuffle").disabled = !route;
        $("route-pace").hidden = !route?.paces || !paceRange;
        $("route-fit").disabled = !route;
        $("route-clear").disabled = !route;
        $("route-zoom").value = view.zoom;
        $("route-zoom-value").textContent = Math.round(view.zoom * 100) + "%";
        draw();
    }

    function useCleanPreset() {
        if (!use_default_bg || !default_bgSRC[1] || background.src === new URL(default_bgSRC[1], document.baseURI).href) return;
        setbgImg(default_bgSRC[1]);
    }

    function applyRecord(imported) {
        $("inpt_miles").value = imported.distanceMeters === null ? "" : Number((imported.distanceMeters / 1000).toFixed(6));
        $("inpt_speeds").value = "";
        $("inpt_duration").value = formatClock(imported.durationSeconds ?? null, true);
        if (imported.startedAt != null) {
            const date = new Date(imported.startedAt);
            for (const [field, value] of [
                ["year", date.getFullYear()], ["month", date.getMonth() + 1], ["day", date.getDate()],
                ["hour", date.getHours()], ["min", date.getMinutes()],
            ]) $("inpt_" + field).value = value;
        }
        setData();
    }

    function describePace(imported) {
        return imported.paceSource === "simulated" ?
            "示意配速（青色快，橙红色慢）。" : "按分段配速着色（青色快，橙红色慢）。";
    }

    async function importFile(file) {
        const request = ++revision;
        try {
            if (file.size > 15 * 1024 * 1024) throw new Error("路线文件超过 15 MB。");
            const text = await file.text();
            const imported = /\.gpx$/i.test(file.name) || text.trimStart().startsWith("<")
                ? parseGpx(text, file.name) : parseTrace(text);
            if (request !== revision) return;
            route = imported;
            paceRange = getPaceRange(route.paces);
            if (paceRange) {
                $("inpt_colorchange_checkbox").checked = false;
                inpt_colorchange_checkbox_onchange();
            }
            applyRecord(imported);
            setMode(null);
            if (route.kind === "trace") useCleanPreset();
            fit();
            const distance = route.distanceMeters === null ? "距离待填写" :
                (route.distanceMethod && route.distanceMethod !== "user-supplied" ? "约 " : "") +
                (route.distanceMeters / 1000).toFixed(2) + " 公里";
            const lap = route.lapInfo;
            const laps = lap ? " · " + lap.full + " 圈" +
                (lap.partialMeters ? " + " + Number(lap.partialMeters.toFixed(2)) + " 米" : "") : "";
            notify(route.name + " · " + distance + laps + "。" + (paceRange ? describePace(route) : "") +
                (route.kind === "trace" ? "上传描线所用的原图以对齐路线。" : "GPX 已按路线形状绘制，普通图片可作为背景。"));
        } catch (error) {
            if (request === revision) notify(error instanceof SyntaxError ? "无法读取路线 JSON，请检查文件格式。" : error.message, true);
        }
    }

    function localPoint(event) {
        const rect = interaction.getBoundingClientRect();
        return [(event.clientX - rect.left) * WIDTH / rect.width, (event.clientY - rect.top) * MAP_HEIGHT / rect.height];
    }

    function imagePoint([x, y]) {
        const [full] = baseFrames(null);
        const [originX, originY] = transform([full.x, full.y]);
        return [clamp((x - originX) / (full.width * view.zoom), 0, 1),
            clamp((y - originY) / (full.height * view.zoom), 0, 1)];
    }

    interaction.addEventListener("pointerdown", event => {
        if (drag || event.button !== 0) return;
        const point = localPoint(event);
        interaction.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, point };
        if (mode === "draw") stroke = [imagePoint(point)];
    });
    interaction.addEventListener("pointermove", event => {
        if (drag?.id !== event.pointerId) return;
        const point = localPoint(event);
        const dx = point[0] - drag.point[0];
        const dy = point[1] - drag.point[1];
        if (mode === "draw") {
            if (Math.hypot(dx, dy) < 1.5 || stroke.length >= 10000) return;
            const next = imagePoint(point);
            const last = stroke.at(-1);
            if (next[0] !== last[0] || next[1] !== last[1]) stroke.push(next);
        } else {
            view.x += dx;
            view.y += dy;
        }
        drag.point = point;
        draw();
    });

    function finishPointer(event) {
        if (drag?.id !== event.pointerId) return;
        drag = null;
        if (event.type === "pointerup" && stroke?.length > 1) {
            const previous = route?.kind === "manual" ? route.strokes : [];
            route = { kind: "manual", strokes: [...previous, stroke] };
            useCleanPreset();
            notify("已保存手绘轨迹。可以继续描线，或修改运动数据。");
        }
        stroke = null;
        sync();
    }

    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) interaction.addEventListener(type, finishPointer);
    $("route-import").addEventListener("click", () => $("route-file").click());
    $("route-file").addEventListener("change", event => {
        const file = event.target.files[0];
        if (file) importFile(file);
        event.target.value = "";
    });
    $("route-draw").addEventListener("click", () => {
        if (mode === "draw") {
            setMode(null);
            return;
        }
        revision += 1;
        useCleanPreset();
        setMode("draw");
        notify("在预览的地图区域按住并拖动。手绘会替换先前导入的轨迹。");
    });
    $("route-pan").addEventListener("click", () => {
        const moving = mode !== "pan";
        setMode(moving ? "pan" : null);
        notify(moving ? "在预览的地图区域拖动，可一起移动底图和轨迹。" : "");
    });
    $("route-clear").addEventListener("click", () => {
        revision += 1;
        route = null;
        setMode(null);
        if (use_default_bg) setbgImg(default_bgSRC[0]);
        sync();
        notify("已清除可编辑轨迹。");
    });
    document.addEventListener("legacy-route-confirmed", () => {
        revision += 1;
        route = null;
        view = { zoom: 1, x: 0, y: 0 };
        setMode(null);
        sync();
        notify();
    });
    $("route-fit").addEventListener("click", fit);
    $("route-reset-view").addEventListener("click", () => {
        view = { zoom: 1, x: 0, y: 0 };
        sync();
    });
    $("route-zoom").addEventListener("input", event => {
        const zoom = Number(event.target.value);
        const ratio = zoom / view.zoom;
        view = { zoom, x: view.x * ratio, y: (view.y + HEIGHT / 2 - MAP_HEIGHT / 2) * ratio - HEIGHT / 2 + MAP_HEIGHT / 2 };
        sync();
    });
    $("route-shuffle").addEventListener("click", () => {
        const step = (1 + Math.floor(Math.random() * 100000)) * COLORS.length + 1;
        seed = (seed + step) % 2147483646;
        const toggle = $("inpt_colorchange_checkbox");
        toggle.checked = true;
        inpt_colorchange_checkbox_onchange();
        draw();
        notify("已重新生成轨迹配色。");
    });
    $("route-pace").addEventListener("click", () => {
        $("inpt_colorchange_checkbox").checked = false;
        inpt_colorchange_checkbox_onchange();
        draw();
        notify(describePace(route));
    });
    for (const id of ["inpt_colorchange_checkbox", "inpt_bs_prob", "inpt_bs_range_min", "inpt_bs_range_max"]) {
        $(id).addEventListener("change", draw);
    }
    background.addEventListener("load", () => {
        if (route && use_default_bg && background.src === new URL(default_bgSRC[0], document.baseURI).href &&
            default_bgSRC[0] !== default_bgSRC[1]) {
            useCleanPreset();
            return;
        }
        if (fitOnLoad || route?.kind === "trace") fit();
        fitOnLoad = false;
        draw();
    });
    $("inpt_bgimg").addEventListener("change", () => {
        if ($("inpt_bgimg").files.length && route) fitOnLoad = true;
    });
})();
