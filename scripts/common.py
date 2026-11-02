"""Constants and formulas shared by the scripts. Scripts run as `python scripts/<name>.py`, so this imports as `common`."""
import math

# Assumed storey heights by building use, plus a pitched-roof allowance. Not measured.
# webapp/src/components/About.tsx repeats the floor heights for display.
FLOOR_H = {"residential": 3.0, "institutional": 3.2, "commercial": 3.5, "mixed": 3.5, "industrial": 4.5, "ancillary": 3.0, "vacant": 0.0}
ROOF = 1.5


def fov_deg(width_m, dist_m):
    """Street View field of view that frames a building of this width from this distance (30-90 degrees)."""
    return int(min(90, max(30, math.degrees(2 * math.atan(width_m * 1.5 / 2 / dist_m)))))
