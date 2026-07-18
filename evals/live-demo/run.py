#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
EVAL_PATH = Path(__file__).with_name("eval.json")
CASES_PATH = Path(__file__).with_name("cases.json")
DEFAULT_OUTPUT = ROOT / "artwork" / "demo" / "pi-web-annotator-demo.mp4"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def grade(report, case, spec):
    failures = []
    outcome = report.get("outcome", {})
    runtime = report.get("runtime", {})
    video = report.get("video", {})

    checks = [
        (report.get("success") is True, "run did not report success"),
        (report.get("caseId") == case["id"], "case id does not match"),
        (report.get("privacy") == case["privacy"], "privacy label does not match"),
        (outcome.get("finalText") == case["expectedText"], "browser does not show the expected heading"),
        (outcome.get("finalText") != case["originalText"], "original heading remains"),
        (outcome.get("agentSettled") is True, "Pi did not emit agent_settled"),
        (runtime.get("temporaryWorkspace") is True, "run did not use a temporary workspace"),
        (runtime.get("ephemeralSession") is True, "run did not use an ephemeral session"),
        (runtime.get("pathSandbox") is spec["acceptance"]["requiredPathSandbox"], "path sandbox is not active"),
        (runtime.get("allowedTools") == spec["budget"]["allowedTools"], "tool allowlist changed"),
        (video.get("format") == spec["acceptance"]["videoFormat"], "video is not MP4"),
        (video.get("width") == spec["acceptance"]["videoWidth"], "video width changed"),
        (video.get("height") == spec["acceptance"]["videoHeight"], "video height changed"),
        (video.get("bytes", 0) >= case["minimumVideoBytes"], "video is too small"),
        (any(name in outcome.get("toolCalls", []) for name in case["requiredAnyTool"]), "Pi did not edit or write a file"),
    ]
    for passed, message in checks:
        if not passed:
            failures.append(message)
    return {"passed": not failures, "failures": failures}


def calibrate_grader(case, spec):
    good = {
        "success": True,
        "caseId": case["id"],
        "privacy": case["privacy"],
        "runtime": {
            "temporaryWorkspace": True,
            "ephemeralSession": True,
            "pathSandbox": True,
            "allowedTools": spec["budget"]["allowedTools"],
        },
        "outcome": {
            "finalText": case["expectedText"],
            "agentSettled": True,
            "toolCalls": [case["requiredAnyTool"][0]],
        },
        "video": {
            "format": spec["acceptance"]["videoFormat"],
            "width": spec["acceptance"]["videoWidth"],
            "height": spec["acceptance"]["videoHeight"],
            "bytes": case["minimumVideoBytes"],
        },
    }
    bad = json.loads(json.dumps(good))
    bad["outcome"]["finalText"] = case["originalText"]
    bad["outcome"]["agentSettled"] = False
    bad["outcome"]["toolCalls"] = []
    bad["video"]["bytes"] = 0

    if not grade(good, case, spec)["passed"]:
        raise RuntimeError("grader rejected the known-good fixture")
    if grade(bad, case, spec)["passed"]:
        raise RuntimeError("grader accepted the known-bad fixture")


def git_metadata():
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
        dirty = bool(
            subprocess.check_output(
                ["git", "status", "--porcelain"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
            ).strip()
        )
        return commit, dirty
    except (OSError, subprocess.CalledProcessError):
        return "unknown", True


def main():
    parser = argparse.ArgumentParser(description="Record and grade the live browser-to-Pi RPC demo")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--timeout", type=int)
    parser.add_argument("--grade-report", type=Path)
    parser.add_argument("--self-test-only", action="store_true")
    args = parser.parse_args()

    spec = load_json(EVAL_PATH)
    case = load_json(CASES_PATH)[0]
    calibrate_grader(case, spec)
    if args.self_test_only:
        print("Live demo grader calibration: PASS")
        return 0

    if args.grade_report:
        result = grade(load_json(args.grade_report), case, spec)
        print(json.dumps(result, indent=2))
        return 0 if result["passed"] else 1

    timeout = args.timeout or spec["budget"]["wallTimeSeconds"]
    output = args.output.resolve()
    commit, dirty = git_metadata()
    environment = {
        **os.environ,
        "PI_DEMO_GIT_COMMIT": commit,
        "PI_DEMO_GIT_DIRTY": "1" if dirty else "0",
    }

    with tempfile.TemporaryDirectory(prefix="pi-web-annotator-eval-") as temporary:
        report_path = Path(temporary) / "report.json"
        command = [
            "node",
            str(ROOT / "scripts" / "record-live-demo.mjs"),
            "--case",
            str(CASES_PATH),
            "--output",
            str(output),
            "--report",
            str(report_path),
        ]
        if args.provider:
            command.extend(["--provider", args.provider])
        if args.model:
            command.extend(["--model", args.model])

        print(f"Running {case['id']} with one public fixture annotation...")
        try:
            completed = subprocess.run(
                command,
                cwd=ROOT,
                env=environment,
                text=True,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            print(f"Live demo exceeded the {timeout}s budget", file=sys.stderr)
            return 1

        if completed.returncode != 0:
            if completed.stdout:
                print(completed.stdout, file=sys.stderr)
            if completed.stderr:
                print(completed.stderr, file=sys.stderr)
            return completed.returncode

        report = load_json(report_path)
        result = grade(report, case, spec)
        if not result["passed"]:
            print(json.dumps(result, indent=2), file=sys.stderr)
            return 1

        gif_output = output.with_suffix(".gif")
        try:
            subprocess.run(
                [
                    "node",
                    str(ROOT / "scripts" / "encode-demo-gif.mjs"),
                    str(output),
                    str(gif_output),
                ],
                cwd=ROOT,
                timeout=60,
                check=True,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            print(f"README GIF encoding failed: {error}", file=sys.stderr)
            return 1

        runtime = report["runtime"]
        usage = report.get("usage", {})
        print("Live demo eval: PASS")
        print(f"Model: {runtime['provider']}/{runtime['model']}")
        print(f"Tools: {', '.join(report['outcome']['toolCalls'])}")
        print(f"Cost: ${usage.get('cost', 0):.4f}")
        print(f"Video: {output} ({report['video']['bytes']} bytes)")
        print(f"README GIF: {gif_output}")
        print("Evidence: one end-to-end smoke run")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
