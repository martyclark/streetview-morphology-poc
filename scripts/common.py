"""Constants and formulas shared by the scripts. Scripts run as `python scripts/<name>.py`, so this imports as `common`."""
import math

# Placeholder height assumptions, not measurements: storey height by building use, and a roof allowance added on top.
# ROOF is 0 because the Chiang Mai shophouses checked so far have flat roofs; pitched roofs would need a positive value.
# export_web.py publishes these next to the data (assumptions.json) and the viewer's About tab displays them.
FLOOR_H = {"residential": 3.0, "institutional": 3.2, "commercial": 3.2, "mixed": 3.2, "industrial": 4.5, "ancillary": 3.0, "vacant": 0.0}
ROOF = 0.0


# Global 100 m Local Climate Zone map (Demuzere et al. 2022, v3 filtered). Codes 1-10 are built types, 11-17 are natural types A-G.
LCZ_URL = "/vsicurl/https://zenodo.org/api/records/8419340/files/lcz_filter_v3.tif/content"


def fov_deg(width_m, dist_m):
    """Street View field of view that frames a building of this width from this distance (30-90 degrees)."""
    return int(min(90, max(30, math.degrees(2 * math.atan(width_m * 1.5 / 2 / dist_m)))))
