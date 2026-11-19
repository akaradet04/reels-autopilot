"""
python -m worker tick                      one full cycle (what the scheduler runs)
python -m worker sample OUT.mp4 BG [kind]  render a sample clip offline (no database), for checking the look
"""

import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "tick"
    if cmd == "tick":
        from worker.jobs import Tick
        Tick().run()
    elif cmd == "sample":
        from worker.sample import render_sample
        out, bg = Path(sys.argv[2]), Path(sys.argv[3])
        kind = sys.argv[4] if len(sys.argv) > 4 else ("photo" if bg.suffix.lower() in (".jpg", ".jpeg", ".png") else "video")
        render_sample(out, bg, kind)
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
