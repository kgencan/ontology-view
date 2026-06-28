"""Load and validate the ontology YAML.

The loader is the single source of truth for structural validation. It never
raises to the caller: a missing file, a parse failure, or any structural
problem is reported as a structured message. The FastAPI layer and the tests
both rely on this contract.

``load_and_validate(path)`` returns::

    {
        "path": "<resolved path as string>",
        "data": {...} | None,   # parsed YAML, or None if it could not be read
        "errors": [str, ...],   # block rendering
        "warnings": [str, ...], # render anyway, surface in UI
    }
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import yaml

VALID_STATUSES = {"canonical", "proposed", "deferred"}
VALID_CARDINALITIES = {
    "one-to-one",
    "one-to-many",
    "many-to-one",
    "many-to-many",
}

# Statuses considered "not fully canonical" for the status-mismatch warning.
NON_CANONICAL_STATUSES = {"proposed", "deferred"}


def load_and_validate(path: str) -> Dict[str, Any]:
    """Read the ontology YAML at *path* and validate it.

    Always returns a result dict; never raises for expected failure modes
    (missing file, parse error, structural problems).
    """
    result: Dict[str, Any] = {
        "path": os.path.abspath(path),
        "data": None,
        "errors": [],
        "warnings": [],
    }
    errors: List[str] = result["errors"]
    warnings: List[str] = result["warnings"]

    # --- Read file -------------------------------------------------------
    if not os.path.isfile(path):
        errors.append(
            f"Ontology file not found at: {result['path']}. "
            "Set --yaml or the ONTOLOGY_YAML_PATH environment variable to a "
            "valid file."
        )
        return result

    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except yaml.YAMLError as exc:
        errors.append(f"YAML parse error: {exc}")
        return result
    except OSError as exc:
        errors.append(f"Could not read ontology file: {exc}")
        return result

    if data is None:
        errors.append("Ontology file is empty.")
        return result
    if not isinstance(data, dict):
        errors.append("Ontology file must be a YAML mapping at the top level.")
        return result

    result["data"] = data

    # --- Top-level required keys ----------------------------------------
    entities = data.get("entities")
    relationships = data.get("relationships")

    if entities is None:
        errors.append("Missing required top-level key: 'entities'.")
    elif not isinstance(entities, list):
        errors.append("Top-level 'entities' must be a list.")
        entities = None

    if relationships is None:
        errors.append("Missing required top-level key: 'relationships'.")
    elif not isinstance(relationships, list):
        errors.append("Top-level 'relationships' must be a list.")
        relationships = None

    domains = data.get("domains")
    if domains is None:
        warnings.append("No 'domains' section found; entities will be unassigned.")
        domains = []
    elif not isinstance(domains, list):
        warnings.append("'domains' is not a list; treating as empty.")
        domains = []

    domain_names = {
        d.get("name")
        for d in domains
        if isinstance(d, dict) and d.get("name") is not None
    }

    # --- Entities --------------------------------------------------------
    entity_names: set = set()
    entity_status: Dict[str, Optional[str]] = {}
    if isinstance(entities, list):
        for idx, ent in enumerate(entities):
            label = _item_label(ent, "entity", idx, "name")
            if not isinstance(ent, dict):
                errors.append(f"{label}: each entity must be a mapping.")
                continue

            name = ent.get("name")
            # Required fields.
            for field in ("name", "description", "status"):
                if not ent.get(field):
                    errors.append(f"{label}: missing required field '{field}'.")

            status = ent.get("status")
            if status is not None and status not in VALID_STATUSES:
                errors.append(
                    f"{label}: invalid status '{status}' "
                    f"(must be one of {sorted(VALID_STATUSES)})."
                )

            if name:
                if name in entity_names:
                    errors.append(f"Duplicate entity name: '{name}'.")
                entity_names.add(name)
                entity_status[name] = status

                # Domain warnings.
                domain_ref = ent.get("domain")
                if domain_ref is None:
                    warnings.append(f"Entity '{name}' has no domain reference.")
                elif domain_ref not in domain_names:
                    warnings.append(
                        f"Entity '{name}' references unknown domain "
                        f"'{domain_ref}'."
                    )

    # --- Relationships ---------------------------------------------------
    rel_names: set = set()
    if isinstance(relationships, list):
        for idx, rel in enumerate(relationships):
            label = _item_label(rel, "relationship", idx, "name")
            if not isinstance(rel, dict):
                errors.append(f"{label}: each relationship must be a mapping.")
                continue

            for field in ("name", "from", "to", "label", "cardinality", "status"):
                if not rel.get(field):
                    errors.append(f"{label}: missing required field '{field}'.")

            name = rel.get("name")
            if name:
                if name in rel_names:
                    errors.append(f"Duplicate relationship name: '{name}'.")
                rel_names.add(name)

            status = rel.get("status")
            if status is not None and status not in VALID_STATUSES:
                errors.append(
                    f"{label}: invalid status '{status}' "
                    f"(must be one of {sorted(VALID_STATUSES)})."
                )

            cardinality = rel.get("cardinality")
            if cardinality is not None and cardinality not in VALID_CARDINALITIES:
                errors.append(
                    f"{label}: invalid cardinality '{cardinality}' "
                    f"(must be one of {sorted(VALID_CARDINALITIES)})."
                )

            # Endpoint reference checks + status-mismatch warning.
            src = rel.get("from")
            dst = rel.get("to")
            if src and src not in entity_names:
                errors.append(
                    f"{label}: 'from' references unknown entity '{src}'."
                )
            if dst and dst not in entity_names:
                errors.append(f"{label}: 'to' references unknown entity '{dst}'.")

            # Warn when a canonical entity is related to a proposed/deferred one.
            if src in entity_status and dst in entity_status:
                src_status = entity_status.get(src)
                dst_status = entity_status.get(dst)
                rel_label = name or label
                if (
                    src_status == "canonical"
                    and dst_status in NON_CANONICAL_STATUSES
                ):
                    warnings.append(
                        f"Relationship '{rel_label}': canonical entity '{src}' "
                        f"is related to {dst_status} entity '{dst}'."
                    )
                elif (
                    dst_status == "canonical"
                    and src_status in NON_CANONICAL_STATUSES
                ):
                    warnings.append(
                        f"Relationship '{rel_label}': canonical entity '{dst}' "
                        f"is related to {src_status} entity '{src}'."
                    )

    # --- Open questions --------------------------------------------------
    open_questions = data.get("open_questions") or []
    if isinstance(open_questions, list):
        seen_ids: set = set()
        for oq in open_questions:
            if not isinstance(oq, dict):
                continue
            oq_id = oq.get("id")
            if oq_id is None:
                continue
            if oq_id in seen_ids:
                warnings.append(f"Duplicate open_question id: '{oq_id}'.")
            seen_ids.add(oq_id)

    return result


def _item_label(item: Any, kind: str, idx: int, name_key: str) -> str:
    """Human-readable label for an item that may be missing its name."""
    if isinstance(item, dict) and item.get(name_key):
        return f"{kind} '{item[name_key]}'"
    return f"{kind} at index {idx}"
