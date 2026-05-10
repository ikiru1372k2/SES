"""ChartSpec validator — mirrors packages/domain/src/analytics/chartSpec.ts."""
from __future__ import annotations

from typing import Any

ALLOWED_TYPES = {"kpi", "bar", "line", "area", "pie", "scatter", "heatmap", "table"}


def validate_chart_spec(spec: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(spec, dict):
        raise ValueError("chart_spec must be an object")
    t = spec.get("type")
    if t not in ALLOWED_TYPES:
        raise ValueError(f"chart_spec.type must be one of {sorted(ALLOWED_TYPES)}")
    if t == "kpi":
        if "label" not in spec or "value" not in spec:
            raise ValueError("kpi requires label + value")
    elif t in ("bar", "line", "area"):
        if "data" not in spec or "x" not in spec or "y" not in spec:
            raise ValueError(f"{t} requires data + x + y")
    elif t == "pie":
        if "data" not in spec or "name" not in spec or "value" not in spec:
            raise ValueError("pie requires data + name + value")
    elif t == "scatter":
        if "data" not in spec or "x" not in spec or "y" not in spec:
            raise ValueError("scatter requires data + x + y")
    elif t == "heatmap":
        if "data" not in spec or "x" not in spec or "y" not in spec or "value" not in spec:
            raise ValueError("heatmap requires data + x + y + value")
    elif t == "table":
        if "columns" not in spec or "rows" not in spec:
            raise ValueError("table requires columns + rows")
    return spec
