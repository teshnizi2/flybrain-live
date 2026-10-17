"""Export the GRN / MN9 ID sets as JSON (ids as strings: root ids exceed 2^53) for the Node tools."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))
import conditions
for ver in ("630", "783"):
    L = conditions.lists(ver)
    out = {k: ([str(x) for x in v] if isinstance(v, list) else str(v)) for k, v in L.items()}
    (ROOT / f"reference/sets_{ver}.json").write_text(json.dumps(out, indent=1))
    print(ver, {k: (len(v) if isinstance(v, list) else v) for k, v in out.items()})
