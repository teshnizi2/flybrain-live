"""Run the full test suite (node --test tests/*.test.mjs) and save the counts -> results/test_summary.json"""
import json, re, subprocess, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
t0 = time.time()
p = subprocess.run(["node", "--test", *sorted(str(x) for x in (ROOT / "tests").glob("*.test.mjs"))], capture_output=True, text=True, cwd=ROOT)
g = lambda k: int(re.search(rf"^# {k} (\d+)", p.stdout, re.M).group(1))
out = {"command": "node --test tests/*.test.mjs", "tests": g("tests"), "pass": g("pass"), "fail": g("fail"), "skipped": g("skipped"),
       "wall_seconds": round(time.time() - t0, 1), "exit_code": p.returncode,
       "files": sorted(x.name for x in (ROOT / "tests").glob("*.test.mjs"))}
(ROOT / "results/test_summary.json").write_text(json.dumps(out, indent=1))
print(json.dumps(out))
