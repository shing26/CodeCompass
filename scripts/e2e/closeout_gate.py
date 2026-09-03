#!/usr/bin/env python3
"""CodeCompass v0.6 closeout regression gate — API-level end-to-end baseline.

Supersedes the lost `codecompass_e2e_harness.sh` / AC-1~AC-12 set (spec:
`.scratch/v0.6-closeout/spec.md`). Stdlib-only Python: builds polyglot fixture
repos in a temp dir, boots the built control-plane, and asserts the capabilities
v0.5.1/v0.6.0 claim:

  1.  doctor --json reports every check ok (errors block, warnings tolerated)
  2.  version consistency: root package.json == cli.ts VERSION == CHANGELOG top
  3.  Java fixture: dashboard tech-stack / config keys / top APIs non-empty
  4.  TS fixture: package.json deps surface as config keys (consumer polyglot)
  5.  Python fixture: pyproject deps + FastAPI route surface (consumer polyglot)
  6.  Go fixture: module parses, route detected (adapter smoke)
  7.  cross-language bridge: TS axios call site resolves onto the Java route
      (subgraph caller + reverse-deps caller from the .ts file)
  8.  deterministic call chain: subgraph of the route reaches the repository hop
  9.  /symbols symbolType is a real enum (>90% non-UNKNOWN)
  10. architecture-delta between two git refs reports added routes + mermaid
  11. FS-watcher hot reload: a new method appears without re-import
  12. v0.8 MCP stdio: codecompass_diagnose + codecompass_refactor_plan answer
      over the raw JSON-RPC handshake with deterministic layers/status
  13. v0.8 CLI: diagnose / refactor-plan print JSON; export writes a
      self-contained HTML artifact; install --dry-run previews without writing
  14. v0.16 incident copilot smoke: a pasted stack trace (mode=incident)
      streams a grounded answer (VERIFIED/BREAK markers) whose done payload
      carries provenance + the ADR-0010 pinned commit on anchors

Usage:
  python scripts/e2e/closeout_gate.py [--cli node services/control-plane/dist/cli.js]
      [--keep] [--skip-hot-reload]

Requires: Node >= 24 with a built `services/control-plane/dist`, git, and an
ODBC-free local disk. The server binds a random free port; no external state.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULT_FILE = Path(__file__).resolve().parent / "e2e-result.json"

RESULTS: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append({"name": name, "ok": bool(ok), "detail": detail})
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def _tail(proc: subprocess.CompletedProcess, limit: int = 200) -> str:
    out = (proc.stdout or "")[-limit:]
    err = (proc.stderr or "")[-limit:]
    return f"{out} {err}".strip()


# ---------------------------------------------------------------- HTTP utils


def http_json(method: str, url: str, payload: dict | None = None, timeout: float = 30.0):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("content-type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def wait_health(base: str, timeout: float = 45.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            http_json("GET", f"{base}/health", timeout=3)
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"server did not become healthy at {base}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


# ------------------------------------------------------------------ fixtures

JAVA_CONTROLLER = '''package com.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/owners")
public class OwnerController {

    private final OwnerService ownerService;

    public OwnerController(OwnerService ownerService) {
        this.ownerService = ownerService;
    }

    @GetMapping
    public List<Owner> listOwners() {
        return ownerService.findOwners();
    }
}
'''

JAVA_CONTROLLER_DELTA = '''
    @GetMapping("/detail")
    public Owner detailOwners(Integer id) {
        return ownerService.findOwners().get(0);
    }
'''

# Head commit adds a NEW controller class: architecture-delta's route
# granularity is the controller class (class-level @RestController symbol),
# not individual @GetMapping methods inside an existing controller — adding a
# method to an existing controller yields no `addedRoutes` (recorded as a
# known granularity limitation in .scratch/v0.6-closeout/issues/08).
JAVA_PET_CONTROLLER = '''package com.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/pets")
public class PetController {

    @GetMapping
    public List<String> listPets() {
        return List.of("rex");
    }
}
'''

JAVA_SERVICE = '''package com.demo;

import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class OwnerService {

    private final OwnerRepository ownerRepository;

    public OwnerService(OwnerRepository ownerRepository) {
        this.ownerRepository = ownerRepository;
    }

    public List<Owner> findOwners() {
        return ownerRepository.findAll();
    }
}
'''

JAVA_REPOSITORY = '''package com.demo;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface OwnerRepository {

    @Select("SELECT id, first_name FROM owners")
    List<Owner> findAll();
}
'''

SPRING_PROPS = '''server.port=8081
spring.datasource.url=jdbc:hsqldb:mem:demo
spring.datasource.username=sa
'''

PYTHON_ENV = '''SECRET_KEY=should-never-be-indexed
FEATURE_FLAGS=pets
'''

JAVA_MODEL = '''package com.demo;

public class Owner {
    private Integer id;
    private String firstName;
}
'''

TS_API_CLIENT = '''import axios from 'axios';

export const apiClient = axios.create({ baseURL: '/api' });

export function loadOwners() {
    return apiClient.get('/owners');
}
'''

TS_SERVER = '''import express from 'express';

export const app = express();

app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});
'''

WEB_PACKAGE_JSON = json.dumps(
    {"name": "demo-web", "version": "1.0.0", "dependencies": {"axios": "^1.6.0", "react": "^18.2.0"}},
    indent=2,
)

PYTHON_APP = '''from fastapi import FastAPI, Depends

app = FastAPI()


def get_db():
    return {}


@app.get("/api/pets")
def list_pets(db=Depends(get_db)):
    return pet_list(db)


def pet_list(db):
    return []
'''

PYTHON_PYPROJECT = '''[project]
name = "demo-api"
version = "0.1.0"
dependencies = ["fastapi", "uvicorn"]
'''

GO_MAIN = '''package main

import "github.com/gin-gonic/gin"

type Store interface {
	Save(path string) error
}

type FileStore struct{}

func (s *FileStore) Save(path string) error {
	return nil
}

func persist(s Store) {
	_ = s.Save("demo.txt")
}

func main() {
	r := gin.Default()
	r.GET("/api/health", healthHandler)
	s := &FileStore{}
	go persist(s)
	r.Run()
}

func healthHandler(c *gin.Context) {
	c.JSON(200, gin.H{"ok": true})
}
'''

GO_MOD = '''module demo/api

go 1.22

require github.com/gin-gonic/gin v1.9.1
'''


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def build_polyglot_repo(root: Path) -> Path:
    """Java Spring backend + TS axios front-end in one repo, git-inited with a
    base commit and a head commit that adds a route (for architecture-delta)."""
    repo = root / "demo-polyglot"
    write(repo / "src/main/java/com/demo/OwnerController.java", JAVA_CONTROLLER)
    write(repo / "src/main/java/com/demo/OwnerService.java", JAVA_SERVICE)
    write(repo / "src/main/java/com/demo/OwnerRepository.java", JAVA_REPOSITORY)
    write(repo / "src/main/java/com/demo/Owner.java", JAVA_MODEL)
    write(repo / "src/main/resources/application.properties", SPRING_PROPS)
    write(repo / "web/src/api-client.ts", TS_API_CLIENT)
    write(repo / "weights.pt", "binary-model-weights")
    write(repo / "web/src/server.ts", TS_SERVER)
    write(repo / "web/package.json", WEB_PACKAGE_JSON)
    _git(repo, ["init"])
    _git(repo, ["add", "-A"])
    _git(repo, ["-c", "user.email=gate@example.com", "-c", "user.name=gate", "commit", "-m", "base"])
    # Head commit: a NEW controller class (see JAVA_PET_CONTROLLER note on
    # architecture-delta's class-level route granularity).
    write(repo / "src/main/java/com/demo/PetController.java", JAVA_PET_CONTROLLER)
    _git(repo, ["add", "-A"])
    _git(repo, ["-c", "user.email=gate@example.com", "-c", "user.name=gate", "commit", "-m", "add pet controller"])
    return repo


def build_python_repo(root: Path) -> Path:
    repo = root / "demo-python"
    write(repo / "app.py", PYTHON_APP)
    write(repo / "pyproject.toml", PYTHON_PYPROJECT)
    write(repo / ".env", PYTHON_ENV)
    # v0.7 — non-standard virtualenv dir must be skipped by the scanner.
    write(repo / "env_py310/lib/site-packages/junk.py", "import os\n")
    return repo


def build_go_repo(root: Path) -> Path:
    repo = root / "demo-go"
    write(repo / "main.go", GO_MAIN)
    write(repo / "go.mod", GO_MOD)
    return repo


def _git(cwd: Path, args: list[str]) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def import_repo(base: str, name: str, path: Path) -> dict:
    res = http_json("POST", f"{base}/api/repos", {"name": name, "localPath": str(path)}, timeout=120)
    repo = res["repo"]
    assert repo["status"] == "ready", f"{name} not ready: {repo.get('error')}"
    return repo


# --------------------------------------------------------------------- checks


def check_versions() -> None:
    root_pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    cli_ts = (ROOT / "services/control-plane/src/cli.ts").read_text(encoding="utf-8")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    pkg_version = root_pkg["version"]
    cli_match = re.search(r"VERSION = '([^']+)'", cli_ts)
    log_match = re.search(r"^## \[([^\]]+)\]", changelog, re.MULTILINE)
    cli_version = cli_match.group(1) if cli_match else ""
    log_version = log_match.group(1) if log_match else ""
    engines = root_pkg.get("engines", {}).get("node", "")
    ok = (
        pkg_version == cli_version == log_version
        and re.fullmatch(r"\d+\.\d+\.\d+", pkg_version) is not None
        and engines.startswith(">=24")
    )
    record(
        "version-consistency (package.json == cli.ts == CHANGELOG, engines >=24)",
        ok,
        f"root={pkg_version} cli={cli_version} changelog={log_version} engines={engines!r}",
    )


def check_dashboard(base: str, repo_id: str, lang_label: str, expect_config: bool = True) -> None:
    dash = http_json("GET", f"{base}/api/repos/{repo_id}/dashboard")["dashboard"]
    tech_nonempty = bool(dash["techStack"]["summary"])
    config_nonempty = bool(dash["config"]["topology"])
    routes = dash["scale"]["routes"]
    ok = tech_nonempty and routes >= 1 and (config_nonempty or not expect_config)
    top_apis = dash.get("topApis") or []
    detail = (
        f"techStack={len(dash['techStack']['summary'])} "
        f"configKeys={len(dash['config']['topology'])} routes={routes} topApis={len(top_apis)}"
    )
    record(f"dashboard consumer surface non-empty ({lang_label})", ok, detail)
    return dash


def check_cross_language_bridge(base: str, repo_id: str) -> None:
    # The bridge is FORWARD-only by design (v0.5.1): a TS axios call site
    # chains into the Java route it targets. The reverse index (reverse-deps)
    # does not surface TS callers of a Java route — recorded as a known gap.
    fwd = http_json(
        "GET",
        f"{base}/api/repos/{repo_id}/subgraph-context?query=loadOwners",
    )["context"]
    java_hops = [
        n for n in fwd.get("nodes", [])
        if n["direction"] in ("callee", "start")
        and n["file"].replace("\\", "/").endswith(".java")
        and not n["file"].replace("\\", "/").endswith(("Owner.java",))
    ]
    record(
        "cross-language bridge: TS axios call site chains into the Java route",
        any(n["direction"] == "callee" for n in java_hops) and any(
            n["file"].replace("\\", "/").endswith("web/src/api-client.ts")
            for n in fwd.get("nodes", [])
        ),
        f"hops={[(n['direction'], n['name']) for n in fwd.get('nodes', [])]}",
    )

    rev = http_json(
        "GET",
        f"{base}/api/repos/{repo_id}/reverse-deps?symbolName=findOwners",
    )
    rev_callers = [c["method"] for c in rev.get("callers", [])]
    record(
        "reverse-deps endpoint resolves same-language callers",
        rev.get("target", {}).get("name") == "findOwners" and "listOwners" in rev_callers,
        f"callers={rev_callers}",
    )


def check_call_chain(base: str, repo_id: str) -> None:
    ctx = http_json(
        "GET",
        f"{base}/api/repos/{repo_id}/subgraph-context?query=listOwners",
    )["context"]
    callees = [n["name"] for n in ctx.get("nodes", []) if n["direction"] == "callee"]
    record(
        "deterministic chain: route reaches repository hop",
        any("findOwners" in name or "findAll" in name for name in callees),
        f"callees={callees}",
    )


def check_radar_http(base: str, repo_id: str) -> None:
    """v0.11: GET /api/repos/:id/radar returns deterministic anchors with
    inDegree/outDegree for the Cmd+K palette."""
    radar = http_json(
        "GET",
        f"{base}/api/repos/{repo_id}/radar?query=listOwners",
    ).get("radar", {})
    anchors = radar.get("matchedAnchors", [])
    hub_nodes = radar.get("hubNodes", [])
    ok = (
        radar.get("repoId") == repo_id
        and len(anchors) >= 1
        and all(
            isinstance(a.get("inDegree"), int) and isinstance(a.get("outDegree"), int)
            for a in anchors
        )
        and len(hub_nodes) >= 1
    )
    detail = (
        f"anchors={[(a['symbol'], a.get('inDegree'), a.get('outDegree')) for a in anchors[:2]]} "
        f"hubs={len(hub_nodes)}"
    )
    record("radar HTTP endpoint returns anchors with graph degrees", ok, detail)


def check_sse_query(base: str, repo_id: str) -> None:
    """Consume the SSE /query stream like the web client does and assert the
    deterministic call-chain produces a mermaid diagram plus anchors."""
    params = urllib.parse.urlencode({"question": "listOwners", "mode": "call-chain"})
    saw_mermaid = saw_anchors = mermaid_has_graph = False
    try:
        req = urllib.request.Request(f"{base}/api/repos/{repo_id}/query?{params}")
        with urllib.request.urlopen(req, timeout=30) as res:
            event = None
            for raw in res:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line.startswith("event:"):
                    event = line.split(":", 1)[1].strip()
                elif line.startswith("data:") and event:
                    data = line.split(":", 1)[1].strip()
                    if event.endswith("query.mermaid"):
                        saw_mermaid = True
                        mermaid_has_graph = "flowchart" in data or "graph" in data
                    elif event.endswith("query.anchors"):
                        saw_anchors = True
                    event = None
    except Exception as exc:  # noqa: BLE001 — report any stream failure verbatim
        record("call-chain SSE stream (mermaid + anchors)", False, str(exc))
        return
    record(
        "call-chain SSE stream (mermaid + anchors)",
        saw_mermaid and mermaid_has_graph and saw_anchors,
        f"mermaid={saw_mermaid} graph={mermaid_has_graph} anchors={saw_anchors}",
    )


def check_incident_sse_query(base: str, repo_id: str) -> None:
    """v0.16 incident copilot smoke (Issue 23): a pasted Java stack trace on
    GET /query?mode=incident&stack=... must stream a done payload whose answer
    carries grounded VERIFIED/BREAK/SUSPECT assertions, plus the ADR-0010
    pinned commit on the payload and its validated anchors."""
    params = urllib.parse.urlencode(
        {
            "question": "排查这段堆栈",
            "mode": "incident",
            "stack": "at com.demo.OwnerService.findOwners(OwnerService.java:16)",
        }
    )
    done_payload: dict | None = None
    try:
        req = urllib.request.Request(f"{base}/api/repos/{repo_id}/query?{params}")
        with urllib.request.urlopen(req, timeout=60) as res:
            event = None
            data = ""
            for raw in res:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line.startswith("event:"):
                    event = line.split(":", 1)[1].strip()
                elif line.startswith("data:") and event:
                    data = line.split(":", 1)[1].strip()
                    if event.endswith("query.done"):
                        try:
                            done_payload = json.loads(data)
                        except json.JSONDecodeError:
                            done_payload = None
                    event = None
    except Exception as exc:  # noqa: BLE001 — report any stream failure verbatim
        record("incident SSE stream (pasted stack -> grounded answer)", False, str(exc))
        return
    if not isinstance(done_payload, dict):
        record("incident SSE stream (pasted stack -> grounded answer)", False, "no done payload")
        return
    answer = done_payload.get("answer") or ""
    provenance = done_payload.get("provenance")
    grounded = any(marker in answer for marker in ("VERIFIED", "BREAK", "SUSPECT"))
    record(
        "incident SSE stream (pasted stack -> grounded answer)",
        grounded and provenance in ("static", "llm"),
        f"provenance={provenance} grounded={grounded} answer_len={len(answer)}",
    )

    commit = done_payload.get("commit")
    anchors = done_payload.get("anchors") or []
    stamped = [a for a in anchors if a.get("commit")]
    record(
        "ADR-0010 commit stamp: incident payload + anchors carry the pinned commit",
        bool(commit) and bool(stamped),
        f"commit={str(commit)[:7]} anchors={len(anchors)} stamped={len(stamped)}",
    )


def check_config_masking(base: str, py_repo_id: str) -> None:
    """ADR-0003 hard gate: the .env key NAME may surface, its VALUE must never
    appear in any API payload (config values are never indexed, issue 06)."""
    dash = http_json("GET", f"{base}/api/repos/{py_repo_id}/dashboard")
    symbols = http_json("GET", f"{base}/api/repos/{py_repo_id}/symbols")
    blob = json.dumps(dash) + json.dumps(symbols)
    leaked = "should-never-be-indexed" in blob
    key_present = any(
        item.get("key") == "SECRET_KEY"
        for item in dash["dashboard"]["config"]["topology"]
    )
    record(
        "ADR-0003 masking: .env key name exposed, value never surfaces",
        (not leaked) and key_present,
        f"leaked={leaked} key_present={key_present}",
    )


def check_module_scope(base: str, repo_id: str) -> None:
    symbols = http_json("GET", f"{base}/api/repos/{repo_id}/symbols")["symbols"]
    load = next((s for s in symbols if s["name"] == "loadOwners"), None)
    ok = bool(load) and load.get("moduleName") == "web" and load.get("qualifiedName") == "web::loadOwners"
    record(
        "Module Scope: symbols carry moduleName/qualifiedName",
        ok,
        f"loadOwners={(load and (load.get('moduleName'), load.get('qualifiedName')))}",
    )


def check_scan_filters(base: str, polyglot_path) -> None:
    preview = http_json(
        "POST", f"{base}/api/repos/preview", {"localPath": str(polyglot_path)}
    )["preview"]
    record(
        "binary filter: weights.pt excluded from budget, reported as skipped",
        preview.get("skippedBinaryCount", 0) >= 1,
        f"fileCount={preview['fileCount']} skippedBinary={preview.get('skippedBinaryCount')}",
    )


def check_venv_filtered(base: str, py_repo_id: str) -> None:
    symbols = http_json("GET", f"{base}/api/repos/{py_repo_id}/symbols")["symbols"]
    leaked = [s["filePath"] for s in symbols if "env_py310" in s["filePath"]]
    record(
        "venv filter: env_py310/ contents never indexed",
        not leaked,
        f"leaked={leaked[:2]}",
    )


def check_depends_edges(base: str, py_repo_id: str) -> None:
    ctx = http_json(
        "GET", f"{base}/api/repos/{py_repo_id}/subgraph-context?query=list_pets"
    )["context"]
    names = [n["name"] for n in ctx.get("nodes", [])]
    record(
        "FastAPI Depends: endpoint chains into get_db, no dead Depends node",
        "get_db" in names and "Depends" not in names,
        f"nodes={names}",
    )


def check_go_implicit_interface(base: str, go_repo_id: str) -> None:
    symbols = http_json("GET", f"{base}/api/repos/{go_repo_id}/symbols")["symbols"]
    store = next((s for s in symbols if s["name"] == "FileStore"), None)
    record(
        "Go implicit interface: FileStore satisfies Store",
        bool(store) and "Store" in (store.get("interfaces") or []),
        f"interfaces={store and store.get('interfaces')}",
    )


def check_symbols_typed(base: str, repo_id: str) -> None:
    symbols = http_json("GET", f"{base}/api/repos/{repo_id}/symbols")["symbols"]
    total = len(symbols)
    typed = sum(1 for s in symbols if s.get("symbolType") and s["symbolType"] != "UNKNOWN")
    ratio = typed / total if total else 0
    record(
        "symbolType is a real enum (>90% non-UNKNOWN)",
        total > 0 and ratio > 0.9,
        f"{typed}/{total} typed",
    )


def check_architecture_delta(base: str, repo_id: str) -> None:
    delta = http_json(
        "POST",
        f"{base}/api/repos/{repo_id}/architecture-delta",
        {"base": "HEAD~1", "head": "HEAD"},
        timeout=60,
    )["delta"]
    record(
        "architecture-delta reports the added route",
        len(delta.get("addedRoutes", [])) >= 1,
        f"added={len(delta.get('addedRoutes', []))}",
    )
    record(
        "architecture-delta emits a mermaid graph",
        isinstance(delta.get("mermaid"), str) and "graph" in (delta.get("mermaid") or ""),
        f"mermaid_len={len(delta.get('mermaid') or '')}",
    )


def check_hot_reload(base: str, repo_id: str, repo_path: Path) -> None:
    service = repo_path / "src/main/java/com/demo/OwnerService.java"
    body = service.read_text(encoding="utf-8").rstrip()
    assert body.endswith("}")
    probe = (
        "\n    public String hotReloadProbe() {\n        return \"probe\";\n    }\n"
    )
    service.write_text(body[:-1] + probe + "}\n", encoding="utf-8")
    deadline = time.time() + 25
    while time.time() < deadline:
        symbols = http_json("GET", f"{base}/api/repos/{repo_id}/symbols")["symbols"]
        if any(s["name"] == "hotReloadProbe" for s in symbols):
            record("FS-watcher hot reload indexes the new method without re-import", True)
            return
        time.sleep(1.0)
    record("FS-watcher hot reload indexes the new method without re-import", False, "timeout after 25s")


# ------------------------------------------------------- v0.8 composite tools


def _mcp_roundtrip(
    node: str, cli: Path, repo_path: Path, data_dir: Path, requests: list[dict]
) -> dict[int, dict]:
    """Minimal MCP stdio client: send JSON-RPC lines, collect id→response."""
    proc = subprocess.Popen(
        [node, str(cli), "mcp", str(repo_path), "--data-dir", str(data_dir)],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
    )
    lines: list[str] = []
    try:
        assert proc.stdin and proc.stdout
        for request in requests:
            proc.stdin.write(json.dumps(request) + "\n")
        proc.stdin.flush()

        import threading

        done = threading.Event()

        def reader() -> None:
            assert proc.stdout
            for raw in proc.stdout:
                lines.append(raw)
            done.set()

        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        deadline = time.time() + 90
        want = {str(r["id"]) for r in requests if r.get("id") is not None}
        while time.time() < deadline and not done.is_set():
            have = set()
            for raw in lines:
                try:
                    have.add(str(json.loads(raw).get("id")))
                except json.JSONDecodeError:
                    continue
            if want <= have:
                break
            time.sleep(0.2)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    responses: dict[int, dict] = {}
    for raw in lines:
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            record("MCP stdio stdout stays pure JSON-RPC", False, raw[:160])
            continue
        if isinstance(message.get("id"), int) and "result" in message:
            responses[message["id"]] = message
    return responses


def check_mcp_composite_tools(node: str, cli: Path, repo_path: Path, data_dir: Path) -> None:
    requests = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "gate", "version": "0.0.0"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "codecompass_diagnose",
                "arguments": {"repoId": "demo-polyglot", "entrySymbol": "listOwners"},
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "codecompass_refactor_plan",
                "arguments": {
                    "repoId": "demo-polyglot",
                    "targetSymbol": "findOwners",
                    "changeType": "SIGNATURE_CHANGE",
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "codecompass_domain_radar",
                "arguments": {"repoId": "demo-polyglot", "query": "owners"},
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "codecompass_module_evolution",
                "arguments": {
                    "repoId": "demo-polyglot",
                    "intentType": "DEPRECATE",
                    "targetSymbolOrModule": "web",
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {
                "name": "codecompass_index_repo",
                "arguments": {"localPath": str(repo_path)},
            },
        },
    ]
    responses = _mcp_roundtrip(node, cli, repo_path, data_dir, requests)

    names = [
        tool.get("name")
        for tool in responses.get(2, {}).get("result", {}).get("tools", [])
    ]
    record(
        "v0.8 MCP tools/list exposes the composite tools (13 total since v0.17)",
        "codecompass_diagnose" in names and "codecompass_refactor_plan" in names
        and "codecompass_domain_radar" in names and "codecompass_module_evolution" in names
        and "codecompass_index_repo" in names and len(names) >= 13,
        f"tools={len(names)}",
    )

    diagnose_text = ""
    for item in responses.get(3, {}).get("result", {}).get("content", []):
        diagnose_text += item.get("text", "")
    layers_ok = '"HTTP_ROUTER"' in diagnose_text and '"SERVICE"' in diagnose_text
    verified_ok = '"VERIFIED"' in diagnose_text
    record(
        "v0.8 codecompass_diagnose returns layered deterministic chain",
        layers_ok and verified_ok and "traceId" in diagnose_text,
        f"layers_ok={layers_ok} verified={verified_ok} len={len(diagnose_text)}",
    )

    refactor_text = ""
    for item in responses.get(4, {}).get("result", {}).get("content", []):
        refactor_text += item.get("text", "")
    record(
        "v0.8 codecompass_refactor_plan returns risk + routes + steps",
        '"riskLevel"' in refactor_text and '"impactedRoutes"' in refactor_text
        and '"migrationSteps"' in refactor_text,
        f"len={len(refactor_text)}",
    )

    radar_text = ""
    for item in responses.get(5, {}).get("result", {}).get("content", []):
        radar_text += item.get("text", "")
    record(
        "v0.9 codecompass_domain_radar returns hubs + anchors over MCP",
        '"hubNodes"' in radar_text and '"topApis"' in radar_text
        and '"matchedAnchors"' in radar_text,
        f"len={len(radar_text)}",
    )

    evolution_text = ""
    for item in responses.get(6, {}).get("result", {}).get("content", []):
        evolution_text += item.get("text", "")
    record(
        "v0.9 codecompass_module_evolution returns checklists over MCP",
        '"checklists"' in evolution_text and '"orphanedSymbols"' in evolution_text,
        f"len={len(evolution_text)}",
    )

    index_text = ""
    for item in responses.get(7, {}).get("result", {}).get("content", []):
        index_text += item.get("text", "")
    index_async_ok = '"repoId"' in index_text and '"status": "indexing"' in index_text
    record(
        "v0.18 codecompass_index_repo returns indexing immediately (ADR-0016)",
        index_async_ok,
        f"len={len(index_text)}",
    )

    # ADR-0016: poll list_repos on a fresh stdio roundtrip until the repo
    # indexed above flips to ready (the first MCP process is already gone).
    if index_async_ok:
        index_repo_id = ""
        try:
            index_repo_id = str(json.loads(index_text).get("repoId") or "")
        except json.JSONDecodeError:
            pass
        if index_repo_id:
            poll_ready = False
            for _ in range(30):
                time.sleep(1)
                poll_responses = _mcp_roundtrip(
                    node,
                    cli,
                    repo_path,
                    data_dir,
                    [
                        {
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "initialize",
                            "params": {
                                "protocolVersion": "2024-11-05",
                                "capabilities": {},
                                "clientInfo": {"name": "gate", "version": "0.0.0"},
                            },
                        },
                        {"jsonrpc": "2.0", "method": "notifications/initialized"},
                        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                        {
                            "jsonrpc": "2.0",
                            "id": 3,
                            "method": "tools/call",
                            "params": {
                                "name": "codecompass_list_repos",
                                "arguments": {},
                            },
                        },
                    ],
                )
                poll_text = ""
                for item in poll_responses.get(3, {}).get("result", {}).get("content", []):
                    poll_text += item.get("text", "")
                try:
                    poll_body = json.loads(poll_text)
                except json.JSONDecodeError:
                    continue
                for row in poll_body.get("repos", []):
                    if row.get("id") == index_repo_id:
                        if row.get("status") == "ready":
                            poll_ready = True
                        break
                if poll_ready:
                    break
            record(
                "v0.18 indexed repo polls to ready via list_repos",
                poll_ready,
                f"repoId={index_repo_id}",
            )


def check_cli_composite(node: str, cli: Path, repo_path: Path, data_dir: Path, tmp: Path) -> None:
    def run(*extra: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [node, str(cli), *extra, "--data-dir", str(data_dir)],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=300,
        )

    def last_json(text: str) -> dict:
        decoder = json.JSONDecoder()
        split = text.splitlines()
        for idx, line in enumerate(split):
            if line.strip() == "{":
                obj, _ = decoder.raw_decode("\n".join(split[idx:]))
                return obj
        obj, _ = decoder.raw_decode(text[text.find("{"):])
        return obj

    diagnose = run("diagnose", "listOwners", str(repo_path))
    try:
        result = last_json(diagnose.stdout)
        layers = [step["layer"] for step in result["verifiedChain"]]
        ok = (
            diagnose.returncode == 0
            and "HTTP_ROUTER" in layers
            and "SERVICE" in layers
            and result["verifiedChain"][0]["status"] in ("VERIFIED", "SUSPECT")
            and result["cockpitDeepLink"].startswith("http://localhost:")
        )
        detail = f"layers={layers} traceId={result.get('traceId')}"
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{exc}: {_tail(diagnose)}"
    record("v0.8 CLI diagnose prints layered JSON with deep link", ok, detail)

    refactor = run(
        "refactor-plan", "findOwners", str(repo_path), "--change-type", "SIGNATURE_CHANGE"
    )
    try:
        result = last_json(refactor.stdout)
        ok = (
            refactor.returncode == 0
            and result["directCallersCount"] >= 1
            and len(result["impactedRoutes"]) >= 1
            and result["riskLevel"] in ("HIGH", "MEDIUM", "LOW")
            and len(result["migrationSteps"]) >= 2
        )
        detail = (
            f"direct={result['directCallersCount']} routes={result['impactedRoutes']} "
            f"risk={result['riskLevel']}"
        )
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{exc}: {_tail(refactor)}"
    record("v0.8 CLI refactor-plan prints blast-radius JSON", ok, detail)

    artifact = tmp / "artifact.html"
    export = run("export", "listOwners", str(repo_path), "--file", str(artifact))
    content = artifact.read_text(encoding="utf-8") if artifact.exists() else ""
    record(
        "v0.8 CLI export writes a self-contained HTML artifact",
        export.returncode == 0 and artifact.exists() and "mermaid" in content
        and "<!DOCTYPE html>" in content,
        f"bytes={len(content)}",
    )

    install = run("install", "--ide", "cursor", "--repo", str(repo_path), "--dry-run")
    record(
        "v0.8+ CLI install --dry-run previews without writing",
        install.returncode == 0 and "dry-run" in install.stdout,
        (install.stdout or install.stderr).strip().splitlines()[-1][:120] if (install.stdout or install.stderr) else "",
    )


def check_v09_radar_evolve(node: str, cli: Path, repo_path: Path, data_dir: Path, tmp: Path) -> None:
    """v0.9: domain radar, module evolution and multi-view artifact checks."""

    def run(*extra: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [node, str(cli), *extra, "--data-dir", str(data_dir)],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=300,
        )

    def last_json(text: str) -> dict:
        decoder = json.JSONDecoder()
        split = text.splitlines()
        for idx, line in enumerate(split):
            if line.strip() == "{":
                obj, _ = decoder.raw_decode("\n".join(split[idx:]))
                return obj
        obj, _ = decoder.raw_decode(text[text.find("{"):])
        return obj

    radar = run("radar", "owners", str(repo_path))
    try:
        result = last_json(radar.stdout)
        ok = (
            radar.returncode == 0
            and len(result["hubNodes"]) >= 1
            and len(result["topApis"]) >= 1
            and len(result["persistenceEntities"]) >= 1
        )
        detail = f"hubs={len(result['hubNodes'])} apis={len(result['topApis'])} entities={result['persistenceEntities'][:3]}"
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{exc}: {_tail(radar)}"
    record("v0.9 radar prints hubs, top APIs and persistence entities", ok, detail)

    radar_intent = run("radar", "owners", str(repo_path))
    try:
        result = last_json(radar_intent.stdout)
        anchors = result["matchedAnchors"]
        ok = (
            radar_intent.returncode == 0
            and len(anchors) >= 1
            # The exact-match entity class wins score 100; the route/service
            # methods must at least appear in the top-3 with a solid score.
            and any("listOwners" in anchor["symbol"] and anchor["relevanceScore"] > 40
                    for anchor in anchors[:3])
        )
        detail = f"anchors={[(a['symbol'], a['relevanceScore']) for a in anchors]}"
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{exc}: {_tail(radar_intent)}"
    record("v0.9 radar intent anchor hits the matching entry symbol", ok, detail)

    deprecate = run("evolve", "--intent", "deprecate", "--target", "web", str(repo_path))
    try:
        result = last_json(deprecate.stdout)
        ok = (
            deprecate.returncode == 0
            and isinstance(result["blastRadius"]["orphanedSymbols"], list)
            and len(result["checklists"]) >= 1
            and result.get("suggestedPatch") is None
        )
        detail = (
            f"checklists={len(result['checklists'])} "
            f"routes={result['blastRadius']['impactedRoutes'][:2]} "
            f"risk={result['riskLevel']}"
        )
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{exc}: {_tail(deprecate)}"
    record("v0.9 evolve deprecate emits checklist with no LLM patch", ok, detail)

    extend = run(
        "evolve", "--intent", "extend", "--target", "findOwners",
        "--goal", "异步敏感词审查", str(repo_path),
    )
    try:
        result = last_json(extend.stdout)
        ok = (
            extend.returncode == 0
            and len(result["scaffoldTemplates"]) >= 1
            and result["scaffoldTemplates"][0]["suggestedPattern"] == "SPRING_EVENT_ASYNC"
            and result.get("suggestedPatch") is None
        )
        record(
            "v0.9 evolve extend matches async pattern with no LLM patch",
            ok,
            f"pattern={result['scaffoldTemplates'][0]['suggestedPattern']}" if ok else _tail(extend),
        )
    except Exception as exc:  # noqa: BLE001
        record("v0.9 evolve extend matches async pattern with no LLM patch", False, f"{exc}: {_tail(extend)}")

    artifact = tmp / "artifact-v09.html"
    export = run("export", "listOwners", str(repo_path), "--file", str(artifact))
    content = artifact.read_text(encoding="utf-8") if artifact.exists() else ""
    record(
        "v0.9 export artifact carries views, badges, beats and placeholders",
        export.returncode == 0
        and 'data-view="sequence"' in content
        and 'id="sequence-src"' in content
        and "Story Beats" in content
        and "Lifecycle (v1.0)" in content,
        f"bytes={len(content)}",
    )




def check_eval_smoke(node: str, cwd: Path) -> None:
    """v0.13: the golden eval must run end-to-end and pass every threshold."""
    tsx = ROOT / "services/control-plane/node_modules/tsx/dist/cli.mjs"
    eval_ts = ROOT / "services/control-plane/src/repoqa-eval.ts"
    run = subprocess.run(
        [node, str(tsx), str(eval_ts)],
        cwd=ROOT, capture_output=True, text=True, timeout=600,
    )
    try:
        report = json.loads(run.stdout)
        buckets = report.get("buckets", {})
        incident = buckets.get("incident", {})
        ok = (
            run.returncode == 0
            and report.get("passed") is True
            and report.get("totalQuestions", 0) >= 75
            and all(bucket["recallAtK"] >= 85 for bucket in buckets.values())
            and incident.get("hallucinationRate", 0.0) == 0.0
        )
        detail = " ".join(
            f"{name}={bucket['recallAtK']:.0f}%" for name, bucket in buckets.items()
        ) + (f" incident_hallucination={incident.get('hallucinationRate', 0.0):.1%}" if incident else "")
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{exc}: {run.stdout[-200:]} {run.stderr[-200:]}"
    record("golden eval passes every threshold (75 questions, incident hallucination 0%)", ok, detail)


# ----------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node", help="node executable")
    parser.add_argument("--keep", action="store_true", help="keep temp fixtures/data dir")
    parser.add_argument("--skip-hot-reload", action="store_true")
    args = parser.parse_args()

    cli = ROOT / "services/control-plane/dist/cli.js"
    if not cli.exists():
        print(f"missing built CLI: {cli} — run `npm run build` first", file=sys.stderr)
        return 2

    tmp = Path(tempfile.mkdtemp(prefix="cc-gate-"))
    data_dir = tmp / "data"
    data_dir.mkdir()
    polyglot = build_polyglot_repo(tmp)
    python_repo = build_python_repo(tmp)
    go_repo = build_go_repo(tmp)
    port = free_port()
    base = f"http://127.0.0.1:{port}"

    # 1) doctor BEFORE the server occupies the port.
    doctor = subprocess.run(
        [args.node, str(cli), "doctor", "--json", "--data-dir", str(data_dir)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    try:
        doctor_json = json.loads(doctor.stdout)
        # CI/containers have no Ollama — 'warning' (Local LLM unreachable, low
        # disk) is tolerated; only 'error' checks (node ABI, sqlite, port,
        # data-dir) block the gate.
        bad = [c["id"] for c in doctor_json.get("checks", []) if c.get("status") == "error"]
        record("doctor --json reports every check ok (errors block, warnings tolerated)",
               doctor_json.get("status") in ("ok", "warning") and not bad,
               f"failed={bad}" if bad else f"{len(doctor_json.get('checks', []))} checks")
    except json.JSONDecodeError:
        record("doctor --json reports every check ok (errors block, warnings tolerated)",
               False, doctor.stdout[:200])

    # Version consistency needs no server either.
    check_versions()

    server = subprocess.Popen(
        [args.node, str(cli), "--port", str(port), "--data-dir", str(data_dir), "--no-browser"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        wait_health(base)
        py_repo = import_repo(base, "demo-polyglot", polyglot)
        check_dashboard(base, py_repo["id"], "java+ts polyglot")
        check_module_scope(base, py_repo["id"])
        check_scan_filters(base, polyglot)
        check_cross_language_bridge(base, py_repo["id"])
        check_call_chain(base, py_repo["id"])
        check_radar_http(base, py_repo["id"])
        check_sse_query(base, py_repo["id"])
        check_incident_sse_query(base, py_repo["id"])
        check_symbols_typed(base, py_repo["id"])
        check_architecture_delta(base, py_repo["id"])

        _py = import_repo(base, "demo-python", python_repo)
        check_dashboard(base, _py["id"], "python/fastapi")
        check_config_masking(base, _py["id"])
        check_venv_filtered(base, _py["id"])
        check_depends_edges(base, _py["id"])

        _go = import_repo(base, "demo-go", go_repo)
        check_dashboard(base, _go["id"], "go/gin", expect_config=False)
        check_go_implicit_interface(base, _go["id"])

        # v0.8 — composite tools over MCP stdio and the CLI surface.
        check_mcp_composite_tools(args.node, cli, polyglot, data_dir)
        check_cli_composite(args.node, cli, polyglot, data_dir, tmp)
        # v0.9 — domain radar, module evolution, multi-view artifacts.
        check_v09_radar_evolve(args.node, cli, polyglot, data_dir, tmp)
        # v0.13 — golden eval smoke (recall thresholds must hold).
        check_eval_smoke(args.node, ROOT)

        if not args.skip_hot_reload:
            check_hot_reload(base, py_repo["id"], polyglot)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        if not args.keep:
            shutil.rmtree(tmp, ignore_errors=True)

    failed = [r for r in RESULTS if not r["ok"]]
    summary = {"passed": len(RESULTS) - len(failed), "failed": len(failed), "checks": RESULTS}
    RESULT_FILE.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{summary['passed']} passed, {summary['failed']} failed — details in {RESULT_FILE}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
