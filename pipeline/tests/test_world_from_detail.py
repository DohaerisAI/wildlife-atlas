import numpy as np
from PIL import Image

from atlas_pipeline import tile_math as tm
from atlas_pipeline.tile_product import save_png, tile_path
from atlas_pipeline.world_from_detail import rebuild_world, reduce_children


def _tile(cls, tree=50, shade=181):
    cls = np.asarray(cls, np.uint8)
    return np.stack([cls, np.where(cls == 0, 0, tree).astype(np.uint8), np.full(cls.shape, shade, np.uint8)], axis=-1)


def test_reduce_children_uses_detail_and_keeps_old_quarters_where_it_has_none():
    coast = np.zeros((256, 256), np.uint8)
    coast[:, 128:] = 4  # west half sea, east half crops
    old = _tile(np.full((256, 256), 1, np.uint8))  # the coarse tile called it all forest
    new = reduce_children([_tile(coast), None, None, None], old)
    assert (new[:128, :64, 0] == 0).all() and (new[:128, 64:128, 0] == 4).all()  # a 300 m coastline, not 10 km
    assert (new[:128, :64, 1] == 0).all()  # no tree cover on sea
    assert (new[:128, 128:, 0] == 1).all() and (new[128:, :, 0] == 1).all()  # no detail: old quarters kept
    assert reduce_children([None] * 4, old) is None


def test_rebuild_world_from_detail_level_5(tmp_path):
    world, detail, backup = tmp_path / "world", tmp_path / "detail", tmp_path / "backup"
    fine = (5, 44, 12)
    save_png(_tile(np.full((256, 256), 3, np.uint8)), tile_path(detail, "land", fine))
    for z in range(0, 5):
        save_png(_tile(np.full((256, 256), 1, np.uint8)), tile_path(world, "land", tm.ancestor(fine, z)))
    counts = rebuild_world(world, detail, backup, log=lambda *_: None)
    assert counts == {"4": 1, "3": 1, "2": 1, "1": 1, "0": 1}
    t4 = np.asarray(Image.open(tile_path(world, "land", tm.parent(fine))))[..., 0]
    i = tm.children(tm.parent(fine)).index(fine)
    y, x = divmod(i, 2)
    assert (t4[y * 128:(y + 1) * 128, x * 128:(x + 1) * 128] == 3).all()  # grassland from detail
    assert (np.asarray(Image.open(tile_path(backup, "land", tm.parent(fine))))[..., 0] == 1).all()  # original kept
    assert (world / "manifest.json").exists() and not list(world.rglob(".*.tmp"))
    assert rebuild_world(world, detail, backup, log=lambda *_: None)["4"] == 0  # idempotent
