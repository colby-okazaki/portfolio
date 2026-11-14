"""Builds every voxel model for the board world and exports them as one GLB.

Run from the repo root:
    /Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_models.py -- [preview.png]

Each model is a grid of coloured voxels. Only the faces you can see are kept, and the colour is
stored per face corner (vertex colour), so the whole world draws with a single material.
"""
import math
import os
import random
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "models", "world.glb")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = argv[0] if argv else None

# ---------------------------------------------------------------- palette
INK = "#1d2330"
BLUE, BLUE_D = "#2f6fe0", "#2458b8"
WHITE = "#f6f7fb"
GLASS, GLASS_D = "#a8e0ff", "#6fb8ea"
YELLOW, ORANGE, RED, PURPLE = "#ffd23f", "#ff9f1c", "#e5484d", "#7b4fd6"
GREENS = ["#3fbf6a", "#35ad5e", "#4bcb78"]
PINES = ["#1f8a5b", "#1a7a50", "#27996a"]
TRUNK = "#8a5a3c"


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


class Vox:
    def __init__(self):
        self.v = {}

    def set(self, x, y, z, col):
        self.v[(x, y, z)] = col

    def box(self, x0, y0, z0, x1, y1, z1, col):
        """Fill an inclusive box. `col` may be a list to pick from at random."""
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    self.v[(x, y, z)] = col

    def cut(self, x0, y0, z0, x1, y1, z1):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    self.v.pop((x, y, z), None)


# Each face: the neighbour to test, and its four corners (counter-clockwise seen from outside)
FACES = [
    ((1, 0, 0), [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)]),
    ((-1, 0, 0), [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)]),
    ((0, 1, 0), [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)]),
    ((0, -1, 0), [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)]),
    ((0, 0, 1), [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]),
    ((0, 0, -1), [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)]),
]

_material = None


def material():
    global _material
    if _material is None:
        m = bpy.data.materials.new("Voxel")
        m.use_nodes = True
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Color"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.9
        _material = m
    return _material


def build(name, vox, size, origin, jitter=0.0, seed=1, parent=None, loc=(0, 0, 0)):
    """Turn a voxel grid into a mesh object. `origin` is in voxel units (a voxel spans x..x+1)."""
    rnd = random.Random(seed)
    verts, faces, cols = [], [], []
    for (x, y, z), col in sorted(vox.v.items()):
        if isinstance(col, list):
            col = rnd.choice(col)
        k = 1 + rnd.uniform(-jitter, jitter)
        c = [lin(min(1, ch * k)) for ch in rgb(col)] + [1.0]
        for (dx, dy, dz), corners in FACES:
            if (x + dx, y + dy, z + dz) in vox.v:
                continue
            n = len(verts)
            for cx, cy, cz in corners:
                verts.append(((x + cx - origin[0]) * size, (y + cy - origin[1]) * size, (z + cz - origin[2]) * size))
                cols.extend(c)
            faces.append((n, n + 1, n + 2, n + 3))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    attr = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    attr.data.foreach_set("color", cols)
    mesh.materials.append(material())
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    return obj


def empty(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------- the car
def make_car():
    v = Vox()
    v.box(1, 2, 0, 22, 9, 0, INK)                      # underbody
    v.box(0, 0, 1, 23, 11, 3, BLUE)                    # lower body
    v.box(8, 0, 1, 15, 11, 1, BLUE_D)                  # side skirts
    v.box(0, 5, 3, 23, 6, 3, WHITE)                    # racing stripe
    v.box(0, 0, 1, 0, 11, 1, INK)                      # rear bumper
    v.box(23, 0, 1, 23, 11, 1, INK)                    # front bumper
    v.cut(23, 0, 3, 23, 11, 3)                         # nose slopes down
    for x in (0, 23):
        for y in (0, 11):
            v.cut(x, y, 1, x, y, 3)                    # rounded corners
    for y0, y1 in ((1, 2), (9, 10)):
        v.box(23, y0, 2, 23, y1, 2, "#ffe27a")         # headlights
        v.box(0, y0, 2, 0, y1, 3, "#ff4d4d")           # tail lights
    v.box(23, 4, 2, 23, 7, 2, INK)                     # grille
    for x0, x1 in ((3, 7), (16, 20)):                  # wheel arches
        v.cut(x0, 0, 0, x1, 1, 2)
        v.cut(x0, 10, 0, x1, 11, 2)
    # cabin: glass with body-coloured pillars, stepping in towards the roof
    v.box(6, 1, 4, 17, 10, 4, GLASS_D)
    v.box(7, 1, 5, 16, 10, 5, GLASS)
    v.box(8, 1, 6, 15, 10, 6, BLUE)
    v.box(8, 5, 6, 15, 6, 6, WHITE)
    for z, (x0, x1) in ((4, (6, 17)), (5, (7, 16))):
        for y in (1, 10):
            v.set(x0, y, z, BLUE)
            v.set(x1, y, z, BLUE)
            v.set(12, y, z, BLUE)
    # spoiler
    v.set(1, 2, 4, INK)
    v.set(1, 9, 4, INK)
    v.box(0, 0, 5, 2, 11, 5, BLUE_D)

    car = empty("car")
    build("car_body", v, 0.1, (12, 6, -2), parent=car)

    for side, outer in (("l", 1), ("r", 0)):
        w = Vox()
        w.box(-2, 0, -2, 2, 1, 2, INK)
        for x in (-2, 2):
            for z in (-2, 2):
                w.cut(x, 0, z, x, 1, z)
        w.set(0, outer, 0, "#e3e7ee")
        for x, z in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            w.set(x, outer, z, "#8f97a6")
        y = 0.5 if side == "l" else -0.5
        for end, x in (("f", 0.65), ("r", -0.65)):
            build(f"wheel_{end}{side}", w, 0.1, (0.5, 1.0, 0.5), parent=car, loc=(x, y, 0.25))
    return car


# ---------------------------------------------------------------- scenery
def make_tree_round():
    v = Vox()
    v.box(0, 0, 0, 1, 1, 4, TRUNK)
    for x in range(-4, 6):
        for y in range(-4, 6):
            for z in range(3, 11):
                d = math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2 + ((z - 6.5) * 1.1) ** 2)
                if d <= 3.7:
                    v.set(x, y, z, GREENS)
    return build("tree_round", v, 0.22, (1, 1, 0), jitter=0.06, seed=3)


def make_tree_pine():
    v = Vox()
    v.box(0, 0, 0, 1, 1, 1, TRUNK)
    for z0, half in ((2, 4), (4, 3), (6, 2), (8, 1)):
        a, b = 1 - half, half
        v.box(a, a, z0, b, b, z0 + 1, PINES)
        if half > 1:
            for x in (a, b):
                for y in (a, b):
                    v.cut(x, y, z0, x, y, z0 + 1)
    v.box(0, 0, 10, 1, 1, 10, PINES)
    return build("tree_pine", v, 0.22, (1, 1, 0), jitter=0.06, seed=5)


def make_house_a():
    v = Vox()
    v.box(0, 0, 0, 7, 6, 4, "#fff1d6")
    v.box(0, 0, 0, 7, 6, 0, "#b9b2a6")
    v.box(3, 0, 0, 4, 0, 2, TRUNK)                     # door
    for x in (1, 6):
        v.box(x, 0, 2, x, 0, 3, GLASS)
        v.box(x, 6, 2, x, 6, 3, GLASS)
    for x in (0, 7):
        v.box(x, 3, 2, x, 3, 3, GLASS)
    for k in range(4):                                 # gabled roof
        v.box(-1, k - 1 if k == 0 else k, 5 + k, 8, 7 - k if k == 0 else 6 - k, 5 + k, RED if k % 2 == 0 else "#c93a40")
    v.box(0, 1, 5, 7, 5, 5, "#fff1d6")                 # gable ends
    v.box(-1, 0, 5, 8, 6, 5, RED)
    v.box(0, 1, 5, 0, 5, 5, "#fff1d6")
    v.box(7, 1, 5, 7, 5, 5, "#fff1d6")
    v.box(6, 4, 6, 6, 5, 8, "#a8553f")                 # chimney
    return build("house_a", v, 0.25, (4, 3.5, 0), jitter=0.03, seed=7)


def make_house_b():
    v = Vox()
    v.box(0, 0, 0, 5, 5, 6, "#e8f1ff")
    v.box(0, 0, 0, 5, 5, 0, "#b9b2a6")
    v.box(2, 0, 0, 3, 0, 2, "#5b3b8c")
    for z in (2, 4):
        for a in (1, 4):
            if not (z == 2 and False):
                v.box(a, 0, z + 1 if z == 2 else z, a, 0, z + 1, GLASS)
                v.box(5, a, z + 1 if z == 2 else z, 5, a, z + 1, GLASS)
                v.box(0, a, z + 1 if z == 2 else z, 0, a, z + 1, GLASS)
    for k in range(4):                                 # pyramid roof
        v.box(k - 1, k - 1, 7 + k, 6 - k, 6 - k, 7 + k, BLUE if k % 2 == 0 else BLUE_D)
    return build("house_b", v, 0.25, (3, 3, 0), jitter=0.03, seed=9)


def make_log_cabin():
    v = Vox()
    logs = ["#9a6a42", "#7f5433"]
    for z in range(4):
        v.box(0, 0, z, 7, 5, z, logs[z % 2])
    for z in (0, 2):                                   # log ends poke out at the corners
        for y in (0, 5):
            v.set(-1, y, z, "#6b4529")
            v.set(8, y, z, "#6b4529")
    v.box(3, 0, 0, 4, 0, 2, "#5a3a22")
    for x in (1, 6):
        v.box(x, 0, 1, x, 0, 2, GLASS)
    for k in range(3):
        v.box(-1, k - 1 if k == 0 else k, 4 + k, 8, 6 - k if k == 0 else 5 - k, 4 + k, "#2f6b4a" if k % 2 == 0 else "#285c40")
    v.box(8, 2, 0, 8, 3, 7, ["#8c93a3", "#7d8494", "#9aa1b0"])   # stone chimney
    return build("log_cabin", v, 0.25, (4, 3, 0), jitter=0.03, seed=31)


def make_barn():
    v = Vox()
    red, red_d, roof = "#c93a40", "#a52e33", "#5d6470"
    v.box(0, 0, 0, 7, 6, 4, red)
    for z, (y0, y1) in ((5, (-1, 7)), (6, (0, 6)), (7, (0, 6)), (8, (1, 5)), (9, (2, 4))):   # gambrel roof
        v.box(0, y0, z, 7, y1, z, roof)
        for x in (0, 7):
            if y1 - y0 > 2:
                v.box(x, y0 + 1, z, x, y1 - 1, z, red)
    v.box(2, 0, 0, 5, 0, 3, WHITE)                     # big door
    v.box(3, 0, 0, 4, 0, 2, red_d)
    for x in (0, 7):
        v.box(x, 2, 0, x, 4, 3, WHITE)
        v.box(x, 3, 0, x, 3, 2, red_d)
        v.set(x, 3, 6, WHITE)                          # hayloft window
    return build("barn", v, 0.25, (4, 3.5, 0), jitter=0.03, seed=33)


def make_beach_house():
    v = Vox()
    wood, aqua = "#d9b98a", "#7fd8d0"
    for x in (0, 7):
        for y in (0, 6):
            v.box(x, y, 0, x, y, 2, TRUNK)             # stilts
    v.box(0, 0, 3, 7, 6, 3, wood)                      # deck
    v.box(1, 1, 4, 6, 5, 7, aqua)
    v.box(3, 1, 4, 4, 1, 6, WHITE)
    for x in (2, 5):
        v.box(x, 1, 5, x, 1, 6, GLASS)
    v.box(6, 3, 5, 6, 3, 6, GLASS)
    v.box(1, 3, 5, 1, 3, 6, GLASS)
    v.box(0, 0, 8, 7, 6, 8, WHITE)
    v.box(1, 1, 9, 6, 5, 9, "#ff8a70")
    for i in range(3):                                 # steps down from the deck
        v.box(3, -1 - i, 2 - i, 4, -1 - i, 2 - i, wood)
    return build("beach_house", v, 0.25, (4, 3.5, 0), jitter=0.03, seed=35)


def make_manor():
    v = Vox()
    wall, pale, purple_d, stone = "#d9c9f2", "#efe6ff", "#633dba", "#b9b2a6"
    v.box(0, 0, 0, 6, 5, 7, wall)
    v.box(0, 0, 0, 6, 5, 0, stone)
    for k in range(4):
        v.box(k - 1, k - 1, 8 + k, 7 - k, 6 - k, 8 + k, PURPLE if k % 2 == 0 else purple_d)
    v.box(5, -1, 0, 7, 1, 10, pale)                    # corner tower
    v.box(4, -2, 11, 8, 2, 11, PURPLE)
    v.box(5, -1, 12, 7, 1, 12, purple_d)
    v.box(6, 0, 13, 6, 0, 14, PURPLE)
    for z in (3, 7):
        v.set(6, -1, z, GLASS)
        v.set(7, 0, z, GLASS)
    v.box(2, 0, 0, 3, 0, 2, "#5b3b8c")
    for x in (1, 3):
        v.box(x, 0, 4, x, 0, 5, GLASS)
    for y in (2, 4):
        for z0 in (2, 5):
            v.box(0, y, z0, 0, y, z0 + 1, GLASS)
    v.box(0, -2, 0, 4, -1, 0, stone)                   # porch
    for x in (0, 4):
        v.box(x, -2, 1, x, -2, 2, WHITE)
    v.box(0, -2, 3, 4, -1, 3, PURPLE)
    return build("manor", v, 0.25, (3.5, 2.5, 0), jitter=0.03, seed=37)


# ---------------------------------------------------------------- town landmarks
# Toy-set buildings: pale moulded walls with one bright roof colour each.
PLASTIC, PLASTIC_D, STONE = "#f7f4ec", "#e2dccd", "#b9b2a6"


def make_chapel():
    v = Vox()
    teal, teal_d = "#2fa8a0", "#278f88"
    v.box(0, 0, 0, 8, 4, 4, PLASTIC)
    v.box(0, 0, 0, 8, 4, 0, STONE)
    v.box(0, -1, 5, 8, 5, 5, teal)
    v.box(0, 0, 6, 8, 4, 6, teal_d)
    v.box(0, 1, 7, 8, 3, 7, teal)
    v.box(0, 2, 8, 8, 2, 8, teal_d)
    for x in (0, 8):
        v.box(x, 0, 5, x, 4, 5, PLASTIC)
        v.box(x, 1, 6, x, 3, 6, PLASTIC)
    v.box(3, -2, 0, 5, 0, 10, PLASTIC)                 # bell tower
    v.box(3, -2, 8, 5, -2, 9, INK)
    v.set(4, -2, 8, YELLOW)                            # the bell
    v.box(3, -2, 11, 5, 0, 11, teal)
    v.box(4, -1, 12, 4, -1, 14, teal_d)
    v.box(4, -2, 0, 4, -2, 2, TRUNK)
    for x in (1, 7):
        v.box(x, 0, 2, x, 0, 3, YELLOW)
        v.set(x, 0, 3, "#ff6fa5")
    return build("chapel", v, 0.25, (4.5, 1.5, 0), jitter=0.02, seed=41)


def make_college():
    v = Vox()
    brick, navy = "#c96a4a", "#3a4a6b"
    v.box(0, 0, 0, 10, 5, 5, brick)
    v.box(0, 0, 0, 10, 5, 0, STONE)
    v.box(0, 0, 6, 10, 5, 6, PLASTIC)
    for x in (1, 3, 7, 9):
        for z in (2, 4):
            v.set(x, 0, z, GLASS)
    for y in (1, 4):
        for z in (2, 4):
            v.set(0, y, z, GLASS)
            v.set(10, y, z, GLASS)
    v.box(4, -1, 0, 6, 1, 11, brick)                   # clock tower over the entrance
    v.box(5, -1, 0, 5, -1, 2, INK)
    v.box(4, -1, 6, 6, -1, 6, PLASTIC)
    v.set(5, -1, 9, WHITE)                             # clock
    v.box(3, -2, 12, 7, 2, 12, navy)
    v.box(4, -1, 13, 6, 1, 13, navy)
    v.box(5, 0, 14, 5, 0, 16, INK)
    v.box(5, 1, 15, 5, 2, 16, YELLOW)                  # flag
    return build("college", v, 0.25, (5.5, 2.5, 0), jitter=0.03, seed=43)


def make_bank():
    v = Vox()
    green = "#2fa85a"
    v.box(0, -1, 0, 8, 5, 0, STONE)
    v.box(1, 1, 1, 7, 5, 5, PLASTIC_D)
    for x in (1, 3, 5, 7):
        v.box(x, 0, 1, x, 0, 5, PLASTIC)               # columns
    v.box(0, 0, 6, 8, 5, 6, PLASTIC)
    v.box(1, 0, 7, 7, 5, 7, green)
    v.box(3, 0, 8, 5, 5, 8, green)
    v.set(4, 0, 7, YELLOW)                             # coin on the pediment
    v.box(4, 1, 1, 4, 1, 3, INK)
    return build("bank", v, 0.25, (4.5, 2.5, 0), jitter=0.02, seed=45)


def make_hospital():
    v = Vox()
    cross = "#19a974"
    v.box(0, 0, 0, 9, 5, 7, PLASTIC)
    v.box(0, 0, 0, 9, 5, 0, STONE)
    for z in (2, 4, 6):
        v.box(1, 0, z, 8, 0, z, GLASS_D)
        v.box(9, 1, z, 9, 4, z, GLASS_D)
        v.box(0, 1, z, 0, 4, z, GLASS_D)
        for x in (3, 6):
            v.set(x, 0, z, PLASTIC)
    v.box(4, 0, 0, 5, 0, 2, GLASS)
    v.box(3, -1, 3, 6, -1, 3, RED)                     # entrance canopy
    v.box(0, 0, 8, 9, 5, 8, PLASTIC_D)
    v.box(1, 0, 9, 3, 0, 11, WHITE)                    # rooftop sign
    for x, z in ((2, 9), (2, 10), (2, 11), (1, 10), (3, 10)):
        v.set(x, 0, z, cross)
    v.box(6, 2, 9, 8, 4, 9, "#8c93a3")
    return build("hospital", v, 0.25, (5, 3, 0), jitter=0.02, seed=47)


def make_office_tower():
    v = Vox()
    frame = "#2a3550"
    for z in range(16):
        v.box(0, 0, z, 5, 5, z, frame if z < 2 or z % 3 == 1 else (GLASS if z % 3 == 2 else GLASS_D))
    for x in (0, 5):
        for y in (0, 5):
            v.box(x, y, 0, x, y, 15, frame)
    v.box(2, 0, 0, 3, 0, 1, GLASS)
    v.box(1, 1, 16, 4, 4, 16, frame)
    v.box(2, 2, 17, 2, 2, 19, "#8c93a3")
    v.set(2, 2, 20, RED)
    return build("office_tower", v, 0.25, (3, 3, 0), jitter=0.02, seed=49)


def make_windmill():
    v = Vox()
    v.box(-3, -3, 0, 2, 2, 2, "#f4efe6")
    v.box(-2, -2, 3, 1, 1, 9, "#f4efe6")
    v.box(-2, -2, 6, 1, 1, 6, "#d9d2c5")
    v.box(-3, -3, 0, 2, 2, 0, "#b9b2a6")
    v.box(-1, -3, 0, 0, -3, 2, TRUNK)
    v.box(-1, -2, 4, 0, -2, 5, GLASS)
    v.box(-3, -3, 10, 2, 2, 10, RED)
    v.box(-2, -2, 11, 1, 1, 11, "#c93a40")
    v.box(-1, -3, 8, 0, -3, 9, INK)                    # axle
    mill = build("windmill", v, 0.25, (0, 0, 0), jitter=0.02, seed=11)

    b = Vox()
    b.set(0, 0, 0, INK)
    for r in range(1, 8):
        for rot in range(4):
            arm = [(r, 0)] + ([(r, 1), (r, 2)] if r >= 2 else [])
            for i, (x, z) in enumerate(arm):
                for _ in range(rot):
                    x, z = -z, x
                b.set(x, 0, z, TRUNK if i == 0 else "#fff6e0")
    build("windmill_blades", b, 0.25, (0.5, 0.5, 0.5), parent=mill, loc=(0, -1.0, 2.25))
    return mill


PIPS = {
    1: [(3, 3)],
    2: [(1, 1), (5, 5)],
    3: [(1, 1), (3, 3), (5, 5)],
    4: [(1, 1), (1, 5), (5, 1), (5, 5)],
    5: [(1, 1), (1, 5), (5, 1), (5, 5), (3, 3)],
    6: [(1, 1), (1, 5), (5, 1), (5, 5), (1, 3), (5, 3)],
}


def make_die(name, body, pip):
    v = Vox()
    v.box(0, 0, 0, 6, 6, 6, body)
    for a, b in PIPS[1]: v.set(a, b, 6, pip)
    for a, b in PIPS[6]: v.set(a, b, 0, pip)
    for a, b in PIPS[2]: v.set(6, a, b, pip)
    for a, b in PIPS[5]: v.set(0, a, b, pip)
    for a, b in PIPS[3]: v.set(a, 6, b, pip)
    for a, b in PIPS[4]: v.set(a, 0, b, pip)
    return build(name, v, 0.17, (3.5, 3.5, 3.5))


def make_cloud():
    v = Vox()
    v.box(0, 0, 0, 8, 3, 0, "#dfeaf5")
    v.box(0, 0, 1, 8, 3, 1, "#ffffff")
    v.box(1, 0, 2, 6, 3, 2, "#ffffff")
    v.box(2, 1, 3, 4, 2, 3, "#ffffff")
    for x in (0, 8):
        for y in (0, 3):
            v.cut(x, y, 0, x, y, 1)
    return build("cloud", v, 0.4, (4.5, 2, 2))


def make_coin():
    v = Vox()
    for x in range(-3, 4):
        for z in range(-3, 4):
            d = x * x + z * z
            if d <= 12.5:
                v.set(x, 0, z, "#ffe680" if d <= 2 else ("#ffcf33" if d <= 8 else "#e0a800"))
    return build("coin", v, 0.1, (0.5, 0.5, 0.5))


def make_mountain():
    rnd = random.Random(21)
    v = Vox()
    for x in range(-8, 9):
        for y in range(-8, 9):
            h = int(10 - 1.2 * math.hypot(x, y) + rnd.uniform(-0.9, 0.9))
            for z in range(max(h, 0)):
                v.set(x, y, z, "#ffffff" if z >= 7 else (["#8c93a3", "#7d8494"] if z >= 4 else GREENS))
    return build("mountain", v, 0.5, (0.5, 0.5, 0), jitter=0.05, seed=23)


def make_rock():
    v = Vox()
    v.box(0, 0, 0, 3, 2, 1, ["#8c93a3", "#7d8494", "#9aa1b0"])
    v.box(1, 0, 2, 2, 2, 2, ["#8c93a3", "#9aa1b0"])
    v.cut(0, 0, 1, 0, 0, 1)
    v.cut(3, 2, 1, 3, 2, 1)
    return build("rock", v, 0.2, (2, 1.5, 0), seed=25)


def make_bush():
    rnd = random.Random(27)
    v = Vox()
    for x in range(-2, 3):
        for y in range(-2, 3):
            for z in range(0, 3):
                if x * x + y * y + (z * 1.4) ** 2 <= 6.5:
                    v.set(x, y, z, GREENS)
    for _ in range(5):
        x, y = rnd.randint(-1, 1), rnd.randint(-1, 1)
        top = max(z for (a, b, z) in v.v if a == x and b == y)
        v.set(x, y, top + 1, rnd.choice(["#ff6fa5", YELLOW, WHITE]))
    return build("bush", v, 0.2, (0.5, 0.5, 0), jitter=0.05, seed=29)


def make_arch():
    v = Vox()
    for y0 in (-10, 9):
        for z in range(12):
            v.box(0, y0, z, 1, y0 + 1, z, RED if (z // 2) % 2 == 0 else WHITE)
        v.box(0, y0, 12, 1, y0 + 1, 12, INK)
        v.box(0, y0, 18, 1, y0 + 1, 19, YELLOW)        # toppers
    v.box(0, -9, 12, 1, 9, 12, INK)                    # beam
    v.box(0, -9, 13, 1, 9, 17, INK)                    # sign board (the text is added on the page)
    v.box(0, -10, 13, 1, -10, 17, INK)
    v.box(0, 10, 13, 1, 10, 17, INK)
    return build("arch", v, 0.25, (1, 0.5, 0))


def make_balloon():
    v = Vox()
    stripes = [RED, YELLOW, WHITE, BLUE]
    for x in range(-5, 5):
        for y in range(-5, 5):
            for z in range(4, 15):
                cx, cy, cz = x + 0.5, y + 0.5, z + 0.5
                r = 4.6 if cz >= 9 else 4.6 - (9 - cz) * 0.55     # tapers towards the basket
                if cx * cx + cy * cy + (max(cz - 9.5, 0)) ** 2 <= r * r and (cz >= 9.5 or math.hypot(cx, cy) <= r):
                    sector = int((math.atan2(cy, cx) + math.pi) / (2 * math.pi) * 8) % 8
                    v.set(x, y, z, stripes[sector % 4])
    v.box(-1, -1, 0, 0, 0, 1, TRUNK)
    for x, y in ((-1, -1), (0, 0), (-1, 0), (0, -1)):
        v.box(x, y, 2, x, y, 3, INK)
    return build("balloon", v, 0.3, (0, 0, 0))


# ---------------------------------------------------------------- build, export, preview
bpy.ops.wm.read_factory_settings(use_empty=True)

roots = [
    make_car(), make_tree_round(), make_tree_pine(), make_house_a(), make_house_b(), make_log_cabin(), make_barn(),
    make_beach_house(), make_manor(), make_chapel(), make_college(), make_bank(), make_hospital(),
    make_office_tower(), make_windmill(),
    make_die("die_white", "#fbfbf5", INK), make_die("die_red", RED, WHITE), make_coin(), make_rock(),
    make_bush(), make_arch(), make_balloon(), make_cloud(), make_mountain(),
]
x = 0.0
for r in roots:                       # line the models up; the page resets these positions
    r.location.x = x
    x += 5.5 if r.name in ("arch", "mountain", "cloud") else 3.4

os.makedirs(os.path.dirname(OUT), exist_ok=True)
opts = dict(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True,
            export_animations=False, export_cameras=False, export_lights=False)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
if "export_vertex_color" in props:
    opts["export_vertex_color"] = "ACTIVE"
bpy.ops.export_scene.gltf(**opts)
print("exported", OUT, os.path.getsize(OUT), "bytes")

if PREVIEW:
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = x + 2
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cx = (x - 3.4) / 2
    cam.location = (cx + 30, -40, 36)
    cam.rotation_euler = (math.radians(56), 0, math.radians(36.87))
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 2400, 900
    scene.render.film_transparent = False
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("preview", PREVIEW)
