# Ontology Viewer

A local, **read-only** web app that renders the SIRIUS ontology YAML as an
interactive graph diagram. Entities are nodes, relationships are labelled
directed edges, and entities are colour-coded by domain. The app never writes
to the YAML — editing happens in the YAML file directly (VS Code or any
editor), and you refresh the view on demand.

## Prerequisites

- Python 3.9 or newer.

## Install

```bash
pip install -e .
```

This installs FastAPI, uvicorn, and PyYAML, plus the `ontology-viewer` command.
The Cytoscape.js graph library is vendored under
`ontology_viewer/static/vendor/`, so the app works fully offline.

## Run

```bash
# Uses the bundled sample ./ontology.yaml by default:
python -m ontology_viewer

# Or point at your own file / port:
python -m ontology_viewer --yaml path/to/ontology.yaml --port 8765

# Installed console script works too:
ontology-viewer --yaml path/to/ontology.yaml
```

Then open **http://localhost:8765**.

### Configuration

| Setting | CLI flag | Environment variable | Default          |
| ------- | -------- | -------------------- | ---------------- |
| YAML    | `--yaml` | `ONTOLOGY_YAML_PATH` | `./ontology.yaml`|
| Port    | `--port` | `ONTOLOGY_PORT`      | `8765`           |

CLI flags take precedence over environment variables.

## Using the app

- **Click** a node or edge to see its full details in the left panel; related
  entities/edges in the detail panel are clickable to navigate.
- **Domain legend** (right): click a domain to highlight its entities and dim
  the rest; click again to clear.
- **Reload YAML**: re-reads the file from disk and re-renders. Your current
  selection is preserved if it still exists. There is no file-watching — reload
  is always manual.
- **Re-run layout**: recomputes the force-directed layout. You can drag nodes
  during a session, but positions are not saved.
- **Open questions**: opens the list of unresolved modelling decisions.
- **Presentation mode**: collapses the side panel and maximises the diagram for
  screen-sharing. The state is stored in the URL (`?presentation=1`), so you can
  open a link directly in presentation mode.

### Node and edge styling

- **Fill colour** = the entity's domain colour (grey if unassigned).
- **Border** = status: solid dark grey (`canonical`), dashed orange
  (`proposed`), dotted light grey (`deferred`).
- **Edge line** = status (solid / dashed / dotted), with the relationship label
  on the edge and cardinality shown as `1` / `N` near each endpoint.

## Validation

On every load the backend validates the YAML and surfaces issues in a
collapsible panel (bottom-left of the graph). **Errors** (e.g. duplicate names,
edges referencing unknown entities, invalid status/cardinality, missing
required fields) are shown prominently; **warnings** (e.g. unknown/missing
domain references, canonical-to-proposed links, duplicate open-question ids)
are shown but do not block rendering. A malformed or missing file shows a clear
error instead of crashing.

## YAML schema

The canonical schema is documented in the header comment of the ontology YAML
file itself (see `ontology.yaml`). In summary: top-level `domains`, `entities`,
`relationships`, and `open_questions`, plus `version` / `last_updated` /
`ratified` metadata.

## Tests

```bash
pip install -e ".[test]"
pytest
```

The test suite covers the loader's validation rules (every error and warning
class) against the bundled sample and crafted fixtures.

## Project layout

```
ontology-view/
├── pyproject.toml
├── README.md
├── ontology.yaml              # bundled sample ontology
├── ontology_viewer/
│   ├── __main__.py            # CLI entry point
│   ├── app.py                 # FastAPI app + /api/ontology
│   ├── loader.py              # YAML load + validation
│   └── static/                # index.html, app.js, styles.css, vendor/
└── tests/
    └── test_loader.py
```
