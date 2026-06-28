"""FastAPI application for the Ontology Viewer.

Serves the single-page frontend and one JSON endpoint that re-reads and
validates the configured YAML file on every request. There is no caching and
no file-watching: the "Reload YAML" button in the UI simply re-fetches.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .loader import load_and_validate

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
DEFAULT_YAML_PATH = "./ontology.yaml"


def create_app(yaml_path: str = DEFAULT_YAML_PATH) -> FastAPI:
    """Build the FastAPI app configured to read *yaml_path*."""
    app = FastAPI(title="Ontology Viewer", version="0.1.0")
    app.state.yaml_path = yaml_path

    @app.get("/api/ontology")
    def get_ontology() -> JSONResponse:
        # Re-read from disk every time so the UI's Reload button is enough.
        # jsonable_encoder handles YAML-native types such as dates.
        return JSONResponse(jsonable_encoder(load_and_validate(app.state.yaml_path)))

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    # Static assets (app.js, styles.css, vendored libraries).
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

    return app
