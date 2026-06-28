"""Tests for ontology_viewer.loader.load_and_validate."""

import os
import textwrap

import pytest

from ontology_viewer.loader import load_and_validate

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE_YAML = os.path.join(REPO_ROOT, "ontology.yaml")


def write(tmp_path, content):
    p = tmp_path / "onto.yaml"
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return str(p)


# ---- Happy path ---------------------------------------------------------

def test_bundled_sample_has_no_errors():
    result = load_and_validate(SAMPLE_YAML)
    assert result["errors"] == []
    assert result["data"] is not None
    assert len(result["data"]["entities"]) == 11
    assert len(result["data"]["relationships"]) == 17
    assert len(result["data"]["domains"]) == 2


def test_bundled_sample_warns_for_unassigned_entities():
    result = load_and_validate(SAMPLE_YAML)
    joined = " ".join(result["warnings"])
    # Household has no domain reference.
    assert "Household" in joined
    assert any("no domain" in w for w in result["warnings"])


MINIMAL_VALID = """\
domains:
  - name: D1
    label: One
    color: "#fff"
entities:
  - name: A
    domain: D1
    description: a
    status: canonical
  - name: B
    domain: D1
    description: b
    status: canonical
relationships:
  - name: a_to_b
    from: A
    to: B
    label: relates to
    cardinality: one-to-many
    status: canonical
"""


def test_minimal_valid(tmp_path):
    result = load_and_validate(write(tmp_path, MINIMAL_VALID))
    assert result["errors"] == []
    assert result["warnings"] == []


# ---- Error classes ------------------------------------------------------

def test_missing_file():
    result = load_and_validate("/no/such/file.yaml")
    assert result["data"] is None
    assert any("not found" in e for e in result["errors"])


def test_parse_error(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("key: [unclosed\n", encoding="utf-8")
    result = load_and_validate(str(p))
    assert any("parse error" in e.lower() for e in result["errors"])


def test_missing_top_level_keys(tmp_path):
    result = load_and_validate(write(tmp_path, "domains: []\n"))
    msgs = " ".join(result["errors"])
    assert "entities" in msgs and "relationships" in msgs


def test_duplicate_entity_name(tmp_path):
    content = MINIMAL_VALID.replace("  - name: B", "  - name: A")
    result = load_and_validate(write(tmp_path, content))
    assert any("Duplicate entity name" in e for e in result["errors"])


def test_duplicate_relationship_name(tmp_path):
    content = MINIMAL_VALID + (
        "  - name: a_to_b\n"
        "    from: A\n"
        "    to: B\n"
        "    label: again\n"
        "    cardinality: one-to-one\n"
        "    status: canonical\n"
    )
    result = load_and_validate(write(tmp_path, content))
    assert any("Duplicate relationship name" in e for e in result["errors"])


def test_dangling_endpoint(tmp_path):
    content = MINIMAL_VALID.replace("to: B", "to: Nonexistent")
    result = load_and_validate(write(tmp_path, content))
    assert any("unknown entity 'Nonexistent'" in e for e in result["errors"])


def test_missing_required_entity_field(tmp_path):
    content = MINIMAL_VALID.replace("    description: a\n", "")
    result = load_and_validate(write(tmp_path, content))
    assert any("missing required field 'description'" in e for e in result["errors"])


def test_missing_required_relationship_field(tmp_path):
    content = MINIMAL_VALID.replace("    cardinality: one-to-many\n", "")
    result = load_and_validate(write(tmp_path, content))
    assert any("missing required field 'cardinality'" in e for e in result["errors"])


def test_invalid_status(tmp_path):
    content = MINIMAL_VALID.replace("status: canonical", "status: bogus", 1)
    result = load_and_validate(write(tmp_path, content))
    assert any("invalid status" in e for e in result["errors"])


def test_invalid_cardinality(tmp_path):
    content = MINIMAL_VALID.replace("cardinality: one-to-many", "cardinality: lots")
    result = load_and_validate(write(tmp_path, content))
    assert any("invalid cardinality" in e for e in result["errors"])


# ---- Warning classes ----------------------------------------------------

def test_unknown_domain_warning(tmp_path):
    content = MINIMAL_VALID.replace("domain: D1", "domain: Ghost", 1)
    result = load_and_validate(write(tmp_path, content))
    assert any("unknown domain 'Ghost'" in w for w in result["warnings"])


def test_no_domains_section_warning(tmp_path):
    content = MINIMAL_VALID.split("entities:")[1]
    result = load_and_validate(write(tmp_path, "entities:" + content))
    assert any("No 'domains' section" in w for w in result["warnings"])


def test_status_mismatch_warning(tmp_path):
    content = MINIMAL_VALID.replace(
        "  - name: B\n    domain: D1\n    description: b\n    status: canonical",
        "  - name: B\n    domain: D1\n    description: b\n    status: proposed",
    )
    result = load_and_validate(write(tmp_path, content))
    assert any("canonical entity 'A' is related to proposed entity 'B'" in w
               for w in result["warnings"])


def test_duplicate_open_question_id(tmp_path):
    content = MINIMAL_VALID + textwrap.dedent(
        """\
        open_questions:
          - id: OQ-1
            topic: x
          - id: OQ-1
            topic: y
        """
    )
    result = load_and_validate(write(tmp_path, content))
    assert any("Duplicate open_question id" in w for w in result["warnings"])
