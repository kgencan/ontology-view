"""Command-line entry point.

Usage::

    python -m ontology_viewer --yaml path/to/ontology.yaml --port 8765

Configuration precedence: CLI argument > environment variable > default.
"""

from __future__ import annotations

import argparse
import os

import uvicorn

from .app import DEFAULT_YAML_PATH, create_app

DEFAULT_PORT = 8765


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ontology_viewer",
        description="Local read-only viewer for the ontology YAML.",
    )
    parser.add_argument(
        "--yaml",
        default=os.environ.get("ONTOLOGY_YAML_PATH", DEFAULT_YAML_PATH),
        help="Path to the ontology YAML file "
        "(env: ONTOLOGY_YAML_PATH, default: %(default)s).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("ONTOLOGY_PORT", DEFAULT_PORT)),
        help="Port to serve on (env: ONTOLOGY_PORT, default: %(default)s).",
    )
    return parser.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    app = create_app(yaml_path=args.yaml)
    print(f"Ontology Viewer serving {os.path.abspath(args.yaml)}")
    print(f"Open http://localhost:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
