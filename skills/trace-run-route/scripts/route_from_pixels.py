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
    length = sum(math.dist(a, b) for segment in segments for a, b in zip(segment, segment[1:]))
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
        "segments": [[[round(x / width, 8), round(y / height, 8)] for x, y in segment] for segment in segments],
    }
    laps = dimension(source.get("laps", 1), "laps")
    reference = source.get("reference")
    supplied = source.get("distanceMeters")
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
