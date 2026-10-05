"""Run a long Earth Engine pull as level-5 groups in parallel, writing each group as it lands (resumable).

Callers pass only the tiles still missing on disk, so a stopped run restarts where it left off. Requests inside a
group are 2 x 2 tile blocks (tiles_ee._pull_tiles with floor_level = level - 1): small enough to stay fast, big
enough to keep per-request overhead low. A dropped connection fails after coast_ee.REQUEST_DEADLINE_MS and is retried.
"""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import tile_math as tm

GROUP_LEVEL = 5


def run_groups(todo: list[tm.Tile], pull: Callable[[list[tm.Tile]], int], groups: int, log: Callable[..., None],
               what: str) -> int:
    """`pull(tiles)` fetches and writes one group, returning how many tiles it wrote. Returns the total written."""
    by_group: dict[tm.Tile, list[tm.Tile]] = {}
    for t in todo:
        by_group.setdefault(tm.ancestor(t, GROUP_LEVEL), []).append(t)
    done = written = 0
    with ThreadPoolExecutor(max_workers=groups) as pool:
        futures = {pool.submit(pull, sorted(tiles)): g for g, tiles in sorted(by_group.items())}
        for i, f in enumerate(as_completed(futures), 1):
            g = futures[f]
            got = f.result()
            done += len(by_group[g])
            written += got
            log("%s group %d/%d %s: %d of %d tiles written; %d/%d overall", what, i, len(by_group), "/".join(map(str, g)),
                got, len(by_group[g]), done, len(todo))
    return written
