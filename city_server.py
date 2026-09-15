"""Local city experiment server. Each request runs a fresh whole-brain window."""
from concurrent.futures import ProcessPoolExecutor
import json
import math
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'vendor/fly-brain'))
LOCK = threading.Lock()
WORKER = ProcessPoolExecutor(max_workers=1, max_tasks_per_child=1)


def simulate(speed, turn, hazard):
    import pandas as pd
    from brian2 import Hz, ms, second, prefs, seed
    from chat_with_fly import DATA_DIR, load_atlas, build_output_neuron_index, analyze_results
    from model import default_params, run_trial
    prefs.codegen.target = 'cython'
    seed(42)
    atlas = load_atlas()
    comp = DATA_DIR / '2025_Completeness_783.csv'
    frame = pd.read_csv(comp, index_col=0)
    ids = {int(fid): i for i, fid in enumerate(frame.index)}
    exc = atlas['stimuli']['walk_forward']['neuron_ids']
    side = 'right' if turn >= 0 else 'left'
    extra = [atlas['output_neurons'][f'DNa01_{side}']['id'],
             atlas['output_neurons'][f'DNa02_{side}']['id']]
    if hazard:
        extra = atlas['stimuli']['vision_looming']['neuron_ids'][:8]
    params = dict(default_params)
    params.update(t_run=400 * ms, r_poi=(40 + 160 * speed) * Hz,
                  r_poi2=(100 if hazard else abs(turn) * 150) * Hz)
    start = time.monotonic()
    spikes = run_trial(exc=[ids[x] for x in exc], exc2=[ids[x] for x in extra],
                       slnc=[], path_comp=str(comp),
                       path_con=str(DATA_DIR / '2025_Connectivity_783.parquet'), params=params)
    analysis = analyze_results(spikes, build_output_neuron_index(atlas, frame), .4, atlas, frame)
    # Actual event times and IDs; the frontend uses a schematic, non-anatomical layout.
    selected = sorted(spikes, key=lambda i: len(spikes[i]), reverse=True)[:160]
    analysis['raster'] = [{'id': str(frame.index[i]), 'times': [round(float(t / second), 5) for t in spikes[i]]} for i in selected]
    analysis.update(duration_sec=.4, wall_time_sec=round(time.monotonic() - start, 2),
                    input={'speed': speed, 'turn': turn, 'hazard': hazard},
                    source='Brian2 whole-brain / fresh 400 ms window / seed 42')
    return analysis


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def do_POST(self):
        if self.path != '/api/brain':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > 4096:
                raise ValueError('Invalid body size')
            body = json.loads(self.rfile.read(length))
            speed, turn = float(body['speed']), float(body['turn'])
            if not (math.isfinite(speed) and 0 <= speed <= 1 and math.isfinite(turn) and -1 <= turn <= 1):
                raise ValueError('Invalid stimulus')
            if not isinstance(body.get('hazard', False), bool):
                raise ValueError('Invalid hazard')
        except (ValueError, KeyError, TypeError) as exc:
            self.reply(400, {'error': str(exc)})
            return
        if not LOCK.acquire(blocking=False):
            self.reply(429, {'error': 'Brain is busy'})
            return
        try:
            self.reply(200, WORKER.submit(simulate, speed, turn, body.get('hazard', False)).result())
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.reply(500, {'error': str(exc)})
        finally:
            LOCK.release()

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    print('City lab: http://127.0.0.1:8080', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever()
