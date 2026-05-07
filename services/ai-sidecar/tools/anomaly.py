"""IsolationForest ML overlay for anomaly detection.

Pure-stdlib implementation (no scikit-learn dep). For numeric-only outlier
detection on small SES datasets this is fine and avoids dragging sklearn
+ scipy + numpy ABI mismatches into the sidecar.
"""
from __future__ import annotations

import math
import random
from typing import Any


def _zscore_outliers(values: list[float], threshold: float = 3.0) -> list[int]:
    if len(values) < 4:
        return []
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / max(1, n - 1)
    sd = math.sqrt(var) or 1.0
    return [i for i, v in enumerate(values) if abs((v - mean) / sd) > threshold]


def _isolation_score(values: list[float], target: float, samples: int = 64) -> float:
    """Crude isolation-forest-style score: average path length over random splits."""
    if len(values) < 4:
        return 0.0
    rng = random.Random(42)
    paths: list[int] = []
    for _ in range(samples):
        bag = rng.sample(values, min(len(values), 32))
        depth = 0
        lo = min(bag)
        hi = max(bag)
        while lo < hi and depth < 16:
            split = rng.uniform(lo, hi)
            if target < split:
                bag = [b for b in bag if b < split]
                hi = split
            else:
                bag = [b for b in bag if b >= split]
                lo = split
            depth += 1
            if len(bag) <= 1:
                break
        paths.append(depth)
    avg_path = sum(paths) / max(1, len(paths))
    n = len(values)
    c = 2 * (math.log(n - 1) + 0.5772) - (2 * (n - 1) / n) if n > 1 else 1.0
    return float(2 ** (-avg_path / c))


def detect_numeric_outliers(
    rows: list[dict[str, Any]],
    columns: list[str] | None = None,
    score_threshold: float = 0.65,
    contamination: float = 0.1,
) -> list[dict[str, Any]]:
    """Returns a list of {row_index, column, value, score, kind} dicts.
    kind = 'isolation' for IsolationForest-style; 'zscore' for z>3.
    """
    if not rows:
        return []
    if columns is None:
        # auto-pick numeric columns from the first 50 rows
        sample = rows[:50]
        columns = []
        for k in sample[0].keys():
            vals = [r.get(k) for r in sample]
            numeric = [v for v in vals if isinstance(v, (int, float)) and v is not None]
            if len(numeric) >= max(5, len(sample) // 2):
                columns.append(k)
    out: list[dict[str, Any]] = []
    for col in columns:
        values: list[float] = []
        idxs: list[int] = []
        for i, r in enumerate(rows):
            v = r.get(col)
            if isinstance(v, (int, float)) and v is not None:
                values.append(float(v))
                idxs.append(i)
        if len(values) < 8:
            continue
        # z-score outliers (rule-violation style)
        for local_i in _zscore_outliers(values):
            out.append(
                {
                    "row_index": idxs[local_i],
                    "column": col,
                    "value": values[local_i],
                    "score": float("inf"),
                    "kind": "zscore",
                }
            )
        # IsolationForest-style — only label top contamination%
        scored = [(i, _isolation_score(values, v)) for i, v in enumerate(values)]
        scored.sort(key=lambda kv: -kv[1])
        n_take = max(1, int(len(scored) * contamination))
        for local_i, s in scored[:n_take]:
            if s < score_threshold:
                continue
            out.append(
                {
                    "row_index": idxs[local_i],
                    "column": col,
                    "value": values[local_i],
                    "score": round(s, 3),
                    "kind": "isolation",
                }
            )
    return out
