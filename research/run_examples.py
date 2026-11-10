#!/usr/bin/env python3
"""Run the shared checkout experiment and record actual checker outcomes."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ("double-charge", "buggyStep", "noDoubleCharge", "NoDoubleCharge", True),
    ("stock-leak", "idempotentStep", "terminalReleasesStock", "TerminalReleasesStock", True),
    ("missing-refund", "idempotentStep", "cancelledRefunded", "CancelledRefunded", True),
    ("fixed", "fixedStep", "safety", "Safety", False),
]


def execute(command, timeout=45):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                            timeout=timeout, check=False)
    return result.returncode, result.stdout + result.stderr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quint", default=shutil.which("quint"))
    parser.add_argument("--tlc-jar", type=Path)
    args = parser.parse_args()
    if not args.quint:
        parser.error("Install Quint or supply --quint /path/to/quint")

    results_dir = ROOT / "research" / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    version_code, quint_version = execute([args.quint, "--version"])
    if version_code:
        raise SystemExit(quint_version)
    summary = {"retrieved": datetime.now(timezone.utc).isoformat(),
               "quint_version": quint_version.strip(), "results": []}
    if args.tlc_jar:
        args.tlc_jar = args.tlc_jar.resolve()
        summary["tlc_jar_sha256"] = hashlib.sha256(args.tlc_jar.read_bytes()).hexdigest()

    code, output = execute([args.quint, "typecheck", "examples/checkout.qnt"])
    (results_dir / "quint-typecheck.txt").write_text(output or "Typecheck succeeded.\n")
    if code:
        raise SystemExit(output)

    for slug, step, invariant, tla_invariant, should_fail in CASES:
        command = [args.quint, "run", "examples/checkout.qnt", "--backend=typescript",
                   f"--step={step}", f"--invariant={invariant}",
                   "--max-samples=1000", "--max-steps=6", "--seed=42", "--verbosity=3"]
        code, output = execute(command)
        expected = ((code == 1 and "Invariant violated" in output) if should_fail
                    else (code == 0 and "No violation found" in output))
        log = results_dir / f"quint-{slug}.txt"
        log.write_text(f"Command: {shlex.join(command)}\nExit code: {code}\n\n{output}")
        result = {"tool": "quint-typescript-simulator", "case": slug,
                  "invariant": invariant, "exit_code": code, "expected_violation": should_fail,
                  "matched_expectation": expected, "log": log.name,
                  "max_samples": 1000, "max_steps": 6, "seed": "42"}
        summary["results"].append(result)
        print(json.dumps(result))

        if args.tlc_jar:
            with tempfile.TemporaryDirectory(prefix="checkout-tlc-") as metadata:
                command = ["java", "-Xmx512m", "-XX:ActiveProcessorCount=1", "-cp",
                           str(args.tlc_jar), "tlc2.TLC", "-workers", "1",
                           "-metadir", metadata, "-config", f"examples/{slug}.cfg",
                           "examples/Checkout.tla"]
                code, output = execute(command)
            expected = ((code == 12 and f"Invariant {tla_invariant} is violated" in output)
                        if should_fail else
                        (code == 0 and "Model checking completed. No error has been found." in output))
            log = results_dir / f"tlc-{slug}.txt"
            log.write_text(f"Command: {shlex.join(command)}\nExit code: {code}\n\n{output}")
            state_counts = re.search(r"(\d+) states generated, (\d+) distinct states found", output)
            result = {"tool": "tlc-exhaustive", "case": slug,
                      "invariant": tla_invariant, "exit_code": code,
                      "expected_violation": should_fail, "matched_expectation": expected,
                      "log": log.name}
            if state_counts:
                result.update(states_generated=int(state_counts[1]), distinct_states=int(state_counts[2]))
            summary["results"].append(result)
            print(json.dumps(result))

    (results_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    if not all(result["matched_expectation"] for result in summary["results"]):
        raise SystemExit("A checker result differed from the expected outcome; inspect the logs.")


if __name__ == "__main__":
    main()
