"""Whitelisted stats helpers — replaces python_compute (which was removed for security).

The agent can call run_stat(name, args) for a known set of operations.
"""
from __future__ import annotations

from typing import Any

import math


def zscore(values: list[float]) -> list[float]:
    if not values:
        return []
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / max(1, n - 1)
    sd = math.sqrt(var) or 1.0
    return [(v - mean) / sd for v in values]


def iqr_outliers(values: list[float]) -> list[int]:
    """Return indices of values outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR]."""
    if len(values) < 4:
        return []
    sorted_vals = sorted(values)
    q1 = sorted_vals[len(sorted_vals) // 4]
    q3 = sorted_vals[(3 * len(sorted_vals)) // 4]
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    return [i for i, v in enumerate(values) if v < lo or v > hi]


def gini(values: list[float]) -> float:
    if not values:
        return 0.0
    arr = sorted(v for v in values if v >= 0)
    n = len(arr)
    total = sum(arr) or 1.0
    cumulative = 0.0
    for i, v in enumerate(arr, start=1):
        cumulative += i * v
    return (2 * cumulative) / (n * total) - (n + 1) / n


WHITELIST = {
    "zscore": zscore,
    "iqr_outliers": iqr_outliers,
    "gini": gini,
}


def run_stat(name: str, args: dict[str, Any]) -> Any:
    if name not in WHITELIST:
        raise ValueError(f"unknown stat '{name}'. Allowed: {sorted(WHITELIST)}")
    return WHITELIST[name](**args)
