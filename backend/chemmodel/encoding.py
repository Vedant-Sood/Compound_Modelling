"""Compact JSON encoding of numerical arrays (little-endian float32, base64)."""

from __future__ import annotations

import base64

import numpy as np


def encode_array(a) -> dict:
    arr = np.ascontiguousarray(np.asarray(a, dtype="<f4"))
    return {
        "dtype": "float32",
        "shape": list(arr.shape),
        "order": "C",
        "data": base64.b64encode(arr.tobytes()).decode("ascii"),
    }


def decode_array(d: dict) -> np.ndarray:
    raw = base64.b64decode(d["data"])
    return np.frombuffer(raw, dtype="<f4").reshape(d["shape"])


def encode_volume(values_xyz) -> dict:
    """Encode a volume indexed [ix, iy, iz] with x varying fastest in memory,
    which is the layout WebGL 3D textures expect."""
    out = encode_array(np.asarray(values_xyz).transpose(2, 1, 0))
    out["layout"] = "x-fastest"
    out["shape"] = list(np.asarray(values_xyz).shape)
    return out
