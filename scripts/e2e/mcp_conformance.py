#!/usr/bin/env python3
"""Generic MCP protocol conformance suite (issue 14, 评估维 E-M10).

Asserts ONLY protocol-level shape and semantics, so it can run against ANY
stdio MCP server — not just this project:

    python scripts/e2e/mcp_conformance.py --server-cmd "<shell command>"

Default command is this repo's own server. Why a separate suite instead of
generalizing closeout_gate.py: the gate asserts THIS repo's data semantics
(five buckets, graph shapes, gate history) and is a regression asset; widening
it would blunt those assertions. This suite is the portable half — it is the
"standard test suite runnable against any implementation" the scoring standard
asks for at the 3-point tier.

Zero project coupling: no tool names, counts, or payload field names of this
repo appear below. Everything is discovered from tools/list at runtime.

Exit code 0 = all assertions passed; 1 = at least one violation (printed).
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
import threading
import time

DEFAULT_SERVER_CMD = "node services/control-plane/dist/cli.js mcp ."
REQUEST_TIMEOUT = 20.0


class StdioSession:
    """One live stdio MCP server; id-matched request/response over NDJSON."""

    def __init__(self, server_cmd: str, cwd: str | None = None) -> None:
        self.proc = subprocess.Popen(
            shlex.split(server_cmd),
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
        )
        self._responses: dict[object, dict] = {}
        self._lock = threading.Lock()
        self._next_id = 1
        if self.proc.stdout:
            threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self) -> None:
        assert self.proc.stdout
        for raw in self.proc.stdout:
            raw = raw.strip()
            if not raw:
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue  # non-protocol noise must not crash the suite
            with self._lock:
                self._responses[message.get("id")] = message

    def request(self, method: str, params: dict | None = None, timeout: float = REQUEST_TIMEOUT) -> dict:
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
        payload = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            payload["params"] = params
        assert self.proc.stdin
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if request_id in self._responses:
                    return self._responses.pop(request_id)
            time.sleep(0.02)
        raise TimeoutError(f"{method} timed out after {timeout}s")

    def notify(self, method: str, params: dict | None = None) -> None:
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        assert self.proc.stdin
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def _failed(response: dict) -> bool:
    """A call counts as rejected if the protocol says so, either way."""
    if "error" in response:
        return True
    result = response.get("result")
    return isinstance(result, dict) and result.get("isError") is True


def _envelope_ok(response: dict) -> bool:
    """Every tools/call answer — success or tool error — must be a text envelope."""
    result = response.get("result")
    if not isinstance(result, dict):
        return False
    content = result.get("content")
    if not isinstance(content, list) or not content:
        return False
    first = content[0]
    return isinstance(first, dict) and first.get("type") == "text" and isinstance(first.get("text"), str)


def run_suite(server_cmd: str, cwd: str | None = None) -> list[tuple[str, bool, str]]:
    results: list[tuple[str, bool, str]] = []
    session = StdioSession(server_cmd, cwd=cwd)
    try:
        # A — initialize handshake
        init = session.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "conformance", "version": "0"},
            },
        )
        result = init.get("result") if isinstance(init.get("result"), dict) else {}
        proto = result.get("protocolVersion")
        server_info = result.get("serverInfo") if isinstance(result.get("serverInfo"), dict) else {}
        caps = result.get("capabilities") if isinstance(result.get("capabilities"), dict) else {}
        handshake_ok = (
            isinstance(proto, str)
            and bool(proto)
            and isinstance(server_info.get("name"), str)
            and bool(server_info.get("name"))
            and isinstance(caps.get("tools"), dict)
        )
        results.append(("initialize handshake (protocolVersion + serverInfo.name + capabilities.tools)",
                        handshake_ok, f"protocolVersion={proto!r} serverName={server_info.get('name')!r} tools_cap={type(caps.get('tools')).__name__}"))
        if not handshake_ok:
            return results  # nothing else is meaningful without a handshake
        session.notify("notifications/initialized")

        # B — tools/list shape
        listing = session.request("tools/list", {})
        tools = ((listing.get("result") or {}).get("tools") or []) if isinstance(listing.get("result"), dict) else []
        tools = [tool for tool in tools if isinstance(tool, dict)]
        no_arg_tools = [tool for tool in tools if not (tool.get("inputSchema") or {}).get("required")]
        names = [tool.get("name") for tool in tools]
        unique = len(set(names)) == len(names)
        shape_problems = []
        for tool in tools:
            schema = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {}
            if not isinstance(tool.get("name"), str) or not tool.get("name"):
                shape_problems.append("name")
            if not isinstance(tool.get("description"), str) or not tool.get("description", "").strip():
                shape_problems.append(f"{tool.get('name')}:description")
            if schema.get("type") != "object":
                shape_problems.append(f"{tool.get('name')}:inputSchema.type")
        results.append(("tools/list shape (unique name + non-empty description + inputSchema.type=object)",
                        bool(tools) and unique and not shape_problems,
                        f"tools={len(tools)} unique={unique} problems={shape_problems[:4]}"))

        # C — call envelope: EVERY tools/call answer (success or domain error)
        # must be a text envelope. Probe with a zero-arg tool when one exists;
        # otherwise fill required arguments from the declared schema types, so
        # the assertion stays probeable on any server (a domain error is a fine
        # outcome here — only the envelope shape is under test).
        probe_tool = no_arg_tools[0] if no_arg_tools else (tools[0] if tools else None)
        if probe_tool:
            arguments = {}
            if not no_arg_tools:
                properties = (probe_tool.get("inputSchema") or {}).get("properties") or {}
                for key in (probe_tool.get("inputSchema") or {}).get("required") or []:
                    spec = properties.get(key) if isinstance(properties.get(key), dict) else {}
                    declared = spec.get("type")
                    arguments[key] = {"string": "conformance-probe", "number": 1, "boolean": True}.get(declared, "conformance-probe")
            call = session.request("tools/call", {"name": probe_tool["name"], "arguments": arguments})
            results.append((f"tools/call envelope ({{content:[{{type:'text'}}]}})",
                            _envelope_ok(call),
                            f"tool={probe_tool['name']} envelope_ok={_envelope_ok(call)} isError={_failed(call)}"))
        else:
            results.append(("tools/call envelope ({content:[{type:'text'}]})", False,
                            "server advertises no tools to probe with"))

        # D — unknown tool name must fail loudly
        unknown = session.request("tools/call", {"name": "definitely_not_a_tool_xyz", "arguments": {}})
        results.append(("unknown tool name is rejected (not a silent success)",
                        _failed(unknown), f"rejected={_failed(unknown)}"))

        # E — a type-mismatched argument must be rejected, never coerced
        typed_tool = None
        typed_key = None
        for tool in tools:
            properties = (tool.get("inputSchema") or {}).get("properties") or {}
            for key, spec in properties.items():
                if isinstance(spec, dict) and spec.get("type") == "string":
                    typed_tool, typed_key = tool, key
                    break
            if typed_tool:
                break
        if typed_tool:
            mismatched = session.request(
                "tools/call", {"name": typed_tool["name"], "arguments": {typed_key: {"not": "a string"}}}
            )
            results.append((f"type-mismatched argument rejected ({typed_tool['name']}.{typed_key})",
                            _failed(mismatched), f"rejected={_failed(mismatched)}"))
        else:
            results.append(("type-mismatched argument rejected", False,
                            "no tool declares a string property to probe with"))

        # F — missing required arguments must be rejected
        required_tool = None
        for tool in tools:
            if (tool.get("inputSchema") or {}).get("required"):
                required_tool = tool
                break
        if required_tool:
            missing = session.request("tools/call", {"name": required_tool["name"], "arguments": {}})
            results.append((f"missing required argument rejected ({required_tool['name']})",
                            _failed(missing), f"rejected={_failed(missing)}"))
        else:
            results.append(("missing required argument rejected", False,
                            "no tool declares required arguments to probe with"))
        return results
    finally:
        session.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Generic stdio MCP conformance suite")
    parser.add_argument("--server-cmd", default=DEFAULT_SERVER_CMD,
                        help="shell command that starts the MCP server on stdio")
    parser.add_argument("--cwd", default=None, help="working directory for the server process")
    args = parser.parse_args()

    try:
        results = run_suite(args.server_cmd, cwd=args.cwd)
    except Exception as exc:  # noqa: BLE001 - a suite must report, not traceback
        print(f"[FAIL] suite could not run against {args.server_cmd!r}: {exc}")
        return 1

    failures = 0
    for name, ok, detail in results:
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"[{mark}] {name} — {detail}")
    print(f"{len(results) - failures} passed, {failures} failed — server: {args.server_cmd}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
