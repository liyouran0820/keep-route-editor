(() => {
  "use strict";

  const WORLD = 1000;
  const MAX_POINTS = 100000;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function sceneSize(width = 1, height = 1) {
    const factor = WORLD / Math.max(width, height);
    return { width: width * factor, height: height * factor };
  }

  function worldPoint(point, size) {
    return [point[0] * size.width, point[1] * size.height];
  }

  function routeLength(strokes, size) {
    let length = 0;
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.length; i += 1) {
        const [x1, y1] = worldPoint(stroke[i - 1], size);
        const [x2, y2] = worldPoint(stroke[i], size);
        length += Math.hypot(x2 - x1, y2 - y1);
      }
    }
    return length;
  }

  function routeBounds(strokes, size) {
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const stroke of strokes) {
      for (const point of stroke) {
        const [x, y] = worldPoint(point, size);
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
      }
    }
    return bounds;
  }

  function toRadians(degrees) { return degrees * Math.PI / 180; }

  function gpsDistance(a, b) {
    const deltaLat = toRadians(b.lat - a.lat);
    const deltaLon = toRadians(b.lon - a.lon);
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) * Math.sin(deltaLon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
  }

  function parseGpx(text, filename) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.documentElement.localName !== "gpx" || xml.getElementsByTagName("parsererror").length) {
      throw new Error("GPX 格式无法读取。");
    }
    const byTag = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
    const tracks = byTag(xml, "trkseg");
    const containers = tracks.length ? tracks : byTag(xml, "rte");
    const pointTag = tracks.length ? "trkpt" : "rtept";
    let pointCount = 0;
    const segments = containers.map(container => {
      const points = byTag(container, pointTag).map(point => {
        const lat = point.getAttribute("lat");
        const lon = point.getAttribute("lon");
        const time = byTag(point, "time")[0]?.textContent;
        return { lat: lat?.trim() ? Number(lat) : NaN, lon: lon?.trim() ? Number(lon) : NaN, time: Date.parse(time) };
      });
      pointCount += points.length;
      if (points.some(point => !Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
        Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180)) {
        throw new Error("GPX 含有无效坐标，请检查文件。");
      }
      return points;
    }).filter(points => points.length >= 2);
    if (!segments.length) throw new Error("GPX 至少需要两个同段轨迹点。");
    if (pointCount > MAX_POINTS) throw new Error("GPX 轨迹点超过 100,000 个，请简化路线后重试。");

    const origin = segments[0][0];
    const cosLat = Math.cos(toRadians(origin.lat));
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    let distanceMeters = 0;
    let durationSeconds = 0;
    let startTime = null;
    let allSegmentsTimed = true;
    const projected = segments.map(points => {
      const first = points[0].time;
      const last = points.at(-1).time;
      if (Number.isFinite(first)) startTime = Math.min(startTime ?? first, first);
      if (Number.isFinite(first) && Number.isFinite(last) && last >= first) durationSeconds += (last - first) / 1000;
      else allSegmentsTimed = false;

      return points.map((point, i) => {
        if (i > 0) distanceMeters += gpsDistance(points[i - 1], point);
        const x = ((point.lon - origin.lon + 540) % 360 - 180) * cosLat;
        const y = origin.lat - point.lat;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxY = Math.max(bounds.maxY, y);
        return [x, y];
      });
    });
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    if (span === 0) throw new Error("GPX 轨迹点重合，无法绘制路线。");
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const strokes = projected.map(segment => segment.map(([x, y]) => [
      0.5 + (x - centerX) * 0.76 / span,
      0.5 + (y - centerY) * 0.76 / span,
    ]));
    return {
      kind: "gpx",
      name: byTag(containers[0].parentElement ?? xml, "name")[0]?.textContent?.trim() || filename.replace(/\.gpx$/i, ""),
      strokes, distanceMeters,
      durationSeconds: allSegmentsTimed && durationSeconds > 0 ? Math.round(durationSeconds) : null,
      startedAt: startTime,
    };
  }

  function parseTrace(text) {
    const route = JSON.parse(text);
    if (!route || route.version !== 1 || !Array.isArray(route.segments) || !route.segments.length) {
      throw new Error("路线 JSON 需要 version 1 和 segments 坐标列表。");
    }
    let total = 0;
    for (const segment of route.segments) {
      if (!Array.isArray(segment) || segment.length < 2 || segment.some(point =>
        !Array.isArray(point) || point.length !== 2 || !point.every(value =>
          Number.isFinite(value) && value >= 0 && value <= 1))) {
        throw new Error("路线 JSON 的每段至少需要两个 [x, y] 坐标，坐标范围为 0 至 1。");
      }
      total += segment.length;
    }
    if (total > MAX_POINTS) throw new Error("JSON 轨迹点超过 100,000 个，请简化路线后重试。");
    const hasSize = route.imageWidth != null || route.imageHeight != null;
    if (hasSize && ![route.imageWidth, route.imageHeight].every(value => Number.isInteger(value) && value > 0)) {
      throw new Error("路线 JSON 的图片宽度和高度须同时提供，且为正整数。");
    }
    if (route.distanceMeters != null && !(Number.isFinite(route.distanceMeters) && route.distanceMeters > 0)) {
      throw new Error("路线距离须填写正数，未知距离可留空。");
    }
    return {
      kind: "trace",
      name: typeof route.name === "string" && route.name.trim() ? route.name.trim().slice(0, 80) : "图片描线",
      strokes: route.segments,
      distanceMeters: route.distanceMeters ?? null,
      distanceMethod: ["scale-bar", "known-segment", "user-supplied"].includes(route.distanceMethod)
        ? route.distanceMethod : null,
      size: hasSize ? sceneSize(route.imageWidth, route.imageHeight) : null,
    };
  }

  function localDate(date) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map(value => String(value).padStart(2, "0")).join("-");
  }

  function parseClock(text, maxFields) {
    const fields = text.trim().split(":");
    if (fields.length < 2 || fields.length > maxFields ||
        !/^\d{1,5}$/.test(fields[0]) || fields.slice(1).some(field => !/^[0-5]?\d$/.test(field))) return null;
    return fields.reduce((total, field) => total * 60 + Number(field), 0);
  }

  function formatClock(seconds, showHours = false) {
    if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";
    const total = Math.round(seconds);
    const min = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, "0");
    const hours = Math.floor(min / 60);
    if (showHours) return String(hours).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0") + ":" + sec;
    return String(min).padStart(2, "0") + ":" + sec;
  }

  globalThis.RunRoute = { clamp, sceneSize, worldPoint, routeLength, routeBounds, parseGpx, parseTrace, localDate, parseClock, formatClock };
})();
