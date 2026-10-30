# Fetch one Overture Maps type for a bounding box into a GeoJSON file (no account, public S3 bucket).
# usage: python3 fetch.py <theme> <type> <out.json> <W,S,E,N> [column=v1|v2]
# Only the Parquet row groups whose bbox statistics touch the box are read, so a town costs a few MB.
# Behind an HTTPS proxy (as in Claude's cloud sessions) set HTTPS_PROXY and, if it re-signs TLS, MAP_TILES_CA.
import sys, os, json, time
from concurrent.futures import ThreadPoolExecutor
import pyarrow as pa, pyarrow.fs as fs, pyarrow.parquet as pq, pyarrow.compute as pc
import shapely.wkb, shapely.geometry as sg

RELEASE = os.environ.get('OVERTURE_RELEASE', '2026-09-23.0')
theme, typ, out = sys.argv[1:4]
W, S, E, N = [float(x) for x in sys.argv[4].split(',')]
flt = None
if len(sys.argv) > 5:
    col, vals = sys.argv[5].split('=')
    flt = (col, vals.split('|'))

opts = {'anonymous': True, 'region': 'us-west-2'}
if os.environ.get('HTTPS_PROXY'): opts['proxy_options'] = os.environ['HTTPS_PROXY']
if os.environ.get('MAP_TILES_CA'): opts['tls_ca_file_path'] = os.environ['MAP_TILES_CA']
s3 = fs.S3FileSystem(**opts)
base = f'overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}/'

def retry(fn, *a, tries=15):
    # The bucket sometimes answers NO_SUCH_BUCKET / RESOURCE_NOT_FOUND under load: back off and try again.
    for k in range(tries):
        try: return fn(*a)
        except OSError as e:
            print('retry', k, str(e)[:80], flush=True); time.sleep(2 + k * 2)
    raise RuntimeError(f'gave up: {a}')

files = retry(lambda: [i.path for i in s3.get_file_info(fs.FileSelector(base)) if i.path.endswith('.parquet')])

def stat(rg, name):
    for j in range(rg.num_columns):
        c = rg.column(j)
        if c.path_in_schema == name and c.statistics is not None and c.statistics.has_min_max:
            return c.statistics.min, c.statistics.max

def scan(path):
    f = pq.ParquetFile(s3.open_input_file(path)); hits = []
    for i in range(f.metadata.num_row_groups):
        rg = f.metadata.row_group(i)
        a = [stat(rg, x) for x in ('bbox.xmin', 'bbox.xmax', 'bbox.ymin', 'bbox.ymax')]
        if not all(a): continue
        if a[0][0] > E or a[1][1] < W or a[2][0] > N or a[3][1] < S: continue
        hits.append(i)
    feats = []
    if hits:
        t = f.read_row_groups(hits); bb = t.column('bbox').combine_chunks()
        inside = pc.and_(pc.and_(pc.less_equal(bb.field('xmin'), E), pc.greater_equal(bb.field('xmax'), W)),
                         pc.and_(pc.less_equal(bb.field('ymin'), N), pc.greater_equal(bb.field('ymax'), S)))
        t = t.filter(inside)
        if flt: t = t.filter(pc.is_in(t.column(flt[0]), value_set=pa.array(flt[1])))
        cols = [c for c in t.column_names if c not in ('geometry', 'bbox', 'sources')]
        for r, g in zip(t.select(cols).to_pylist(), t.column('geometry').to_pylist()):
            feats.append({'type': 'Feature', 'geometry': sg.mapping(shapely.wkb.loads(g)), 'properties': r})
    return path, len(hits), feats

allf = []
with ThreadPoolExecutor(int(os.environ.get('FETCH_THREADS', '4'))) as ex:
    for p, n, fe in ex.map(lambda p: retry(scan, p), files):
        if fe: print(p.split('/')[-1][:12], n, len(fe), flush=True)
        allf += fe
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
json.dump({'type': 'FeatureCollection', 'features': allf}, open(out, 'w'), default=str, ensure_ascii=False)
print(typ, 'total', len(allf))
