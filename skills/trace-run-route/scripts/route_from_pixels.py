"""Convert traced image pixels into the running-card editor's route format."""

import argparse
import json
import math
from pathlib import Path


def positive_number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{field} must be a finite positive number")
    return value


def dimension(value, field):
    if type(value) is not int or value <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return value


def validate_points(points, width, height):
    if not isinstance(points, list) or len(points) < 2:
        raise ValueError("each segment needs at least two points")
    for point in points:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError("points must be [x, y] pairs")
        for value, limit in zip(point, [width, height]):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= limit:
                raise ValueError("point is outside the original image or is not numeric")
    return points


def lengths(points):
    return [math.dist(a, b) for a, b in zip(points, points[1:])]


def interpolate(start, end, fraction):
    return [a + (b - a) * fraction for a, b in zip(start, end)]


def offset_loop(points, edge_lengths, offset):
    normals = [
        (-(b[1] - a[1]) / length, (b[0] - a[0]) / length)
        for a, b, length in zip(points, points[1:], edge_lengths)
    ]
    offset_points = []
    for index, point in enumerate(points[:-1]):
        before, after = normals[index - 1], normals[index]
        divisor = max(0.5, 1 + sum(a * b for a, b in zip(before, after)))
        offset_points.append([value + offset * (a + b) / divisor for value, a, b in zip(point, before, after)])
    return offset_points + offset_points[:1]


def trim_path(points, meters, target):
    result = [points[0]]
    kept = []
    remaining = target
    for start, end, edge in zip(points, points[1:], meters):
        if remaining <= 1e-8:
            break
        if remaining < edge:
            result.append(interpolate(start, end, remaining / edge))
            kept.append(remaining)
            break
        result.append(end)
        kept.append(edge)
        remaining -= edge
    return result, kept


def make_laps(points, loop, distance, width, height):
    if not isinstance(loop, dict):
        raise ValueError("loop must be an object")
    lap_meters = positive_number(loop.get("distanceMeters"), "loop distanceMeters")
    spacing = positive_number(loop.get("spacingPixels"), "loop spacingPixels")
    edges = lengths(points)
    if len(points) < 4 or points[0] != points[-1] or any(length <= 0 for length in edges):
        raise ValueError("loop requires one closed centerline with distinct consecutive points")
    full, partial = divmod(distance, lap_meters)
    if math.isclose(partial, lap_meters, rel_tol=1e-10):
        full, partial = full + 1, 0
    if full and math.isclose(partial, 0, abs_tol=1e-8):
        partial = 0
    count = int(full) + bool(partial)
    if count * len(points) > 100000:
        raise ValueError("repeated route exceeds 100,000 points")
    meter_scale = lap_meters / sum(edges)
    edge_meters = [edge * meter_scale for edge in edges]
    paths = []
    all_meters = []
    for index in range(count):
        path = offset_loop(points, edges, spacing * (index - (count - 1) / 2))
        meters = edge_meters
        if partial and index == count - 1:
            path, meters = trim_path(path, edge_meters, partial)
        paths.append(validate_points(path, width, height))
        all_meters.append(meters)
    return paths, all_meters, {"distanceMeters": lap_meters, "full": int(full), "partialMeters": partial}


def apply_paces(paths, meters_by_path, pace, distance):
    if not isinstance(pace, dict) or pace.get("source") not in ("recorded", "simulated"):
        raise ValueError("pace source must be recorded or simulated")
    intervals = pace.get("intervals")
    if not isinstance(intervals, list) or not intervals:
        raise ValueError("pace requires at least one [meters, secondsPerKm] interval")
    if any(not isinstance(interval, list) or len(interval) != 2 for interval in intervals):
        raise ValueError("each pace interval must be [meters, secondsPerKm]")
    intervals = [
        (positive_number(interval[0], "interval meters"), positive_number(interval[1], "interval secondsPerKm"))
        for interval in intervals
    ]
    if not math.isclose(sum(meters for meters, _ in intervals), distance, rel_tol=1e-10, abs_tol=1e-7):
        raise ValueError("pace intervals must match the total distance")
    duration = sum(meters * seconds / 1000 for meters, seconds in intervals)
    interval_index = 0
    remaining, seconds = intervals[0]
    result = []
    paces = []
    for path, edge_meters in zip(paths, meters_by_path):
        points = [path[0]]
        edge_paces = []
        for start, end, meters in zip(path, path[1:], edge_meters):
            traveled = 0
            while meters - traveled > remaining + 1e-8 and interval_index + 1 < len(intervals):
                traveled += remaining
                points.append(interpolate(start, end, traveled / meters))
                edge_paces.append(seconds)
                interval_index += 1
                remaining, seconds = intervals[interval_index]
            points.append(end)
            edge_paces.append(seconds)
            remaining -= meters - traveled
            if remaining <= 1e-8 and interval_index + 1 < len(intervals):
                interval_index += 1
                remaining, seconds = intervals[interval_index]
        result.append(points)
        paces.append(edge_paces)
    return result, paces, round(duration)


def convert(source):
    if not isinstance(source, dict):
        raise ValueError("input must be a JSON object")
    width = dimension(source.get("imageWidth"), "imageWidth")
    height = dimension(source.get("imageHeight"), "imageHeight")
    segments = source.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError("at least one segment is required")
    segments = [validate_points(segment, width, height) for segment in segments]
    if sum(map(len, segments)) > 100000:
        raise ValueError("route cannot exceed 100,000 points")
    pixel_lengths = [lengths(segment) for segment in segments]
    length = sum(map(sum, pixel_lengths))
    if length <= 0:
        raise ValueError("route has no measurable length")
    name = source.get("name", "图片描线")
    if not isinstance(name, str):
        raise ValueError("name must be a string")
    route = {
        "version": 1,
        "name": name.strip() or "图片描线",
        "imageWidth": width,
        "imageHeight": height,
    }
    laps = dimension(source.get("laps", 1), "laps")
    reference = source.get("reference")
    supplied = source.get("distanceMeters")
    loop = source.get("loop")
    pace = source.get("pace")
    if supplied is not None:
        route["distanceMeters"] = positive_number(supplied, "distanceMeters")
        route["distanceMethod"] = "user-supplied"
    elif reference is not None:
        if not isinstance(reference, dict):
            raise ValueError("reference must be an object")
        method = reference.get("method")
        if method not in ("scale-bar", "known-segment"):
            raise ValueError("reference method must be scale-bar or known-segment")
        points = validate_points(reference.get("points"), width, height)
        if method == "scale-bar" and len(points) != 2:
            raise ValueError("a scale bar requires exactly two endpoints")
        reference_length = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
        positive_number(reference_length, "reference pixel length")
        meters = positive_number(reference.get("meters"), "reference meters")
        route["distanceMeters"] = positive_number(length / reference_length * meters * laps, "estimated distance")
        route["distanceMethod"] = method
    if loop is not None:
        if supplied is None or len(segments) != 1 or laps != 1 or reference is not None:
            raise ValueError("loop requires one centerline and a total distance, without reference or laps")
        segments, edge_meters, route["lapInfo"] = make_laps(segments[0], loop, route["distanceMeters"], width, height)
    elif pace is not None and "distanceMeters" in route:
        scale = route["distanceMeters"] / length
        edge_meters = [[edge * scale for edge in edges] for edges in pixel_lengths]
    if pace is not None:
        if "distanceMeters" not in route:
            raise ValueError("pace intervals require a total distance")
        segments, route["paces"], route["durationSeconds"] = apply_paces(segments, edge_meters, pace, route["distanceMeters"])
        route["paceSource"] = pace["source"]
    if sum(map(len, segments)) > 100000:
        raise ValueError("route cannot exceed 100,000 points")
    route["segments"] = [[[round(x / width, 8), round(y / height, 8)] for x, y in segment] for segment in segments]
    return route


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        source = json.loads(args.input.read_text(encoding="utf-8"))
        result = convert(source)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
