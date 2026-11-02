import sys
from pathlib import Path

import numpy as np
from shapely.geometry import box, shape

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from common import FLOOR_H, ROOF, fov_deg  # noqa: E402
from export_web import height_from, is_sliver, lcz_features, view_geometry  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402


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


def test_lcz_features_merge_equal_cells_and_skip_no_data():
    cells = np.array([[6, 6, 0], [6, 2, 2], [17, 17, 99]], dtype="uint8")
    feats = lcz_features(cells, from_origin(0, 3, 1, 1))
    assert sorted(f["properties"]["lcz"] for f in feats) == [2, 6, 17]  # 0 (no data) and 99 (out of range) are dropped
    area = {f["properties"]["lcz"]: shape(f["geometry"]).area for f in feats}
    assert area == {6: 3.0, 2: 2.0, 17: 2.0}


def test_view_geometry_returns_fov_and_visible_top():
    fov, top = view_geometry(box(100.0, 18.0, 100.0001, 18.0001), 15, 18.0)
    assert 30 <= fov <= 90
    assert top > 2.5  # above the assumed camera height
