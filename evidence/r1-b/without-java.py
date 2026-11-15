"""Run a dev-server check with no Java in PATH and no TLC override."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

bin_dir = Path(tempfile.mkdtemp(prefix="r1b-no-java-", dir=os.environ["PYM_SCRATCH"]))
try:
    for directory in os.get_exec_path():
        folder = Path(directory)
        if not folder.is_dir():
            continue
        for entry in folder.iterdir():
            target = bin_dir / entry.name
            if entry.name != "java" and entry.is_file() and os.access(entry, os.X_OK) and not target.exists():
                target.symlink_to(entry.resolve())
    env = dict(os.environ, PATH=str(bin_dir))
    env.pop("PYM_TLC_JAR", None)
    assert shutil.which("java", path=env["PATH"]) is None
    assert not Path("dist-web").exists(), "fresh check must not have built web assets"
    print("Fresh mirror: no dist-web; java absent from PATH; PYM_TLC_JAR unset", flush=True)
    result = subprocess.run(sys.argv[1:], env=env)
    assert not Path("dist-web").exists(), "check unexpectedly built web assets"
    sys.exit(result.returncode)
finally:
    shutil.rmtree(bin_dir)
