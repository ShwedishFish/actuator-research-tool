import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
@pytest.mark.parametrize("path", sorted(FRONTEND.glob("*.js")), ids=lambda p: p.name)
def test_js_parses(path):
    subprocess.run(["node", "--check", str(path)], check=True)
