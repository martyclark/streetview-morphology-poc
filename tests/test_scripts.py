import sys
from pathlib import Path

import numpy as np
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from common import FLOOR_H, ROOF, fov_deg  # noqa: E402
from export_web import height_from, is_sliver, view_geometry  # noqa: E402


def test_fov_frames_building_and_is_clamped():
    assert fov_deg(10, 15) == 53
    assert fov_deg(1, 100) == 30
    assert fov_deg(100, 5) == 90


def test_height_from_storeys_and_use():
    assert height_from(3, "residential") == round(3 * FLOOR_H["residential"] + ROOF, 1)
    assert height_from(3, "mixed") == round(3 * FLOOR_H["mixed"] + ROOF, 1)
    assert height_from(0, "residential") == 0.0
    assert height_from(np.nan, "residential") is None
    assert height_from(2, "unknown") is None


def test_is_sliver():
    assert is_sliver(box(0, 0, 2, 20))
    assert not is_sliver(box(0, 0, 10, 10))


def test_view_geometry_returns_fov_and_visible_top():
    fov, top = view_geometry(box(100.0, 18.0, 100.0001, 18.0001), 15, 18.0)
    assert 30 <= fov <= 90
    assert top > 2.5  # above the assumed camera height
