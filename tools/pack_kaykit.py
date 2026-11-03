"""Blender headless: bundle KayKit models into one GLB + render a contact sheet.

Used to build public/models/kaykit_props.glb; see CLAUDE.md "Third-party models".

Usage:
  Blender -b --python pack_kaykit.py -- <gltf_root> <out.glb> <sheet.png> <rel1,rel2,...>
Each model becomes a top-level empty named after its file, at the origin.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
root_dir, out_glb, sheet_png, rels = argv[0], argv[1], argv[2], argv[3].split(",")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

roots = []
report = {}
for rel in rels:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root_dir, rel + ".gltf"))
    new = [o for o in bpy.data.objects if o not in before]
    name = os.path.basename(rel)
    # Free the plain name for the holder empty (the mesh object shares it).
    for o in new:
        o.name = name + "_mesh"
    holder = bpy.data.objects.new(name, None)
    scene.collection.objects.link(holder)
    for o in new:
        if o.parent is None:
            o.parent = holder
    roots.append(holder)

    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    tris = 0
    for o in new:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    # Blender is Z-up; report in glTF/three terms (x, y-up, z).
    size = hi - lo
    report[name] = {
        "size_xyz": [round(size.x, 3), round(size.z, 3), round(size.y, 3)],
        "min_y": round(lo.z, 3),
        "tris": tris,
    }

# Every file brought its own copy of the shared atlas + material; collapse them.
images = {}
for img in list(bpy.data.images):
    key = os.path.basename(img.filepath) or img.name.split(".")[0]
    if key in images:
        img.user_remap(images[key])
        bpy.data.images.remove(img)
    else:
        images[key] = img
mats = {}
for mat in list(bpy.data.materials):
    key = mat.name.split(".")[0]
    if key in mats:
        mat.user_remap(mats[key])
        bpy.data.materials.remove(mat)
    else:
        mats[key] = mat

print("PACK_REPORT " + json.dumps(report))
print("PACK_IMAGES", len(bpy.data.images), "PACK_MATERIALS", len(bpy.data.materials))

bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True)

# Contact sheet: lay models out on a grid (each normalized to ~1 unit) and
# render with workbench using texture colors, labels drawn as text objects.
cols = 6
cell = 2.4
for i, holder in enumerate(roots):
    r = report[holder.name]
    biggest = max(r["size_xyz"]) or 1
    holder.scale = (1.6 / biggest,) * 3
    holder.location = ((i % cols) * cell, -(i // cols) * cell * 1.1, 0)
    bpy.ops.object.text_add(location=(holder.location.x - 1.0, holder.location.y - 1.15, 0))
    txt = bpy.context.object
    txt.data.body = holder.name
    txt.data.size = 0.2
    txt.rotation_euler = (math.radians(60), 0, 0)

rows = math.ceil(len(roots) / cols)
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(cols, rows * 1.1) * cell * 1.05
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cx = (cols - 1) * cell / 2
cy = -(rows - 1) * cell * 1.1 / 2
cam.location = (cx, cy - 12, 10)
cam.rotation_euler = (math.radians(50), 0, 0)
scene.camera = cam

scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_cavity = True
scene.render.resolution_x = 1600
scene.render.resolution_y = int(1600 * (rows * 1.1) / cols) + 200
scene.render.filepath = sheet_png
bpy.ops.render.render(write_still=True)
