"""Generate src/api/types.ts from openapi.json.

The policy server (physicaltab) owns the contract; this turns its published
OpenAPI schema into TypeScript so the two can't drift. Deliberately Python and
not `openapi-typescript`: the schema is small and regular, and this way
regenerating needs no node toolchain.

    python3 scripts/gen-types.py            # refresh types from openapi.json
    npm run codegen                         # same thing

Refresh openapi.json itself from a running server with:
    curl -s http://<host>:9000/openapi.json > openapi.json
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "openapi.json"
OUT = ROOT / "src" / "api" / "types.ts"

PRIMITIVES = {"string": "string", "integer": "number", "number": "number",
              "boolean": "boolean", "null": "null"}


def ts_type(node: dict) -> str:
    """One JSON-Schema node -> a TypeScript type expression."""
    if "$ref" in node:
        return node["$ref"].rsplit("/", 1)[-1]
    if "anyOf" in node:
        parts = [ts_type(x) for x in node["anyOf"]]
        # collapse the `X | null` that FastAPI emits for Optional[...]
        return " | ".join(dict.fromkeys(parts))
    if "enum" in node:
        return " | ".join(json.dumps(v) for v in node["enum"])
    t = node.get("type")
    if t == "array":
        inner = ts_type(node.get("items", {}))
        return f"({inner})[]" if " " in inner else f"{inner}[]"
    if t == "object" or t is None:
        return "unknown"
    return PRIMITIVES.get(t, "unknown")


def doc(node: dict, indent: str) -> str:
    """Carry the server's field descriptions through as JSDoc."""
    text = node.get("description")
    if not text:
        return ""
    body = re.sub(r"\s+", " ", text).strip()
    if len(body) <= 76:
        return f"{indent}/** {body} */\n"
    words, lines, cur = body.split(" "), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > 76:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    lines.append(cur)
    inner = "\n".join(f"{indent} * {ln}" for ln in lines)
    return f"{indent}/**\n{inner}\n{indent} */\n"


def emit(name: str, schema: dict) -> str:
    if "enum" in schema:
        vals = " | ".join(json.dumps(v) for v in schema["enum"])
        return f"{doc(schema, '')}export type {name} = {vals};\n"

    required = set(schema.get("required", []))
    lines = [f"{doc(schema, '')}export interface {name} {{"]
    for field, node in schema.get("properties", {}).items():
        lines.append(doc(node, "  ").rstrip("\n") or None)
        opt = "" if field in required else "?"
        lines.append(f"  {field}{opt}: {ts_type(node)};")
    return "\n".join(x for x in lines if x is not None) + "\n}\n"


def main() -> None:
    spec = json.loads(SPEC.read_text())
    schemas = spec.get("components", {}).get("schemas", {})
    skip = {"HTTPValidationError", "ValidationError"}

    out = [
        "// GENERATED - do not edit by hand.",
        "// Source: openapi.json (published by the physicaltab policy server).",
        "// Regenerate: npm run codegen",
        "",
    ]
    for name in sorted(schemas):
        if name in skip:
            continue
        out.append(emit(name, schemas[name]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out))
    kept = [n for n in sorted(schemas) if n not in skip]
    print(f"wrote {OUT.relative_to(ROOT)} ({len(kept)} types: {', '.join(kept)})")


if __name__ == "__main__":
    main()
