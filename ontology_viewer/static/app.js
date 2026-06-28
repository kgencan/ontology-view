/* Ontology Viewer — vanilla JS frontend.
 *
 * Fetches validated ontology JSON from the backend and renders it with
 * Cytoscape.js (fcose layout). Read-only: no editing, no position persistence.
 */
(function () {
  "use strict";

  // Register the fcose layout extension (UMD globals).
  if (window.cytoscape && window.cytoscapeFcose) {
    window.cytoscape.use(window.cytoscapeFcose);
  }

  var UNASSIGNED_COLOR = "#9E9E9E";
  var STATUS_BORDER = {
    canonical: { color: "#3a3f47", style: "solid", width: 2 },
    proposed: { color: "#e08a1e", style: "dashed", width: 2 },
    deferred: { color: "#a8adb5", style: "dotted", width: 2 },
  };
  // Source/target endpoint labels by cardinality.
  var CARDINALITY_ENDPOINTS = {
    "one-to-one": { source: "1", target: "1" },
    "one-to-many": { source: "1", target: "N" },
    "many-to-one": { source: "N", target: "1" },
    "many-to-many": { source: "N", target: "N" },
  };

  // ---- Application state -------------------------------------------------
  var state = {
    data: null, // raw ontology data
    errors: [],
    warnings: [],
    domainsByName: {},
    entitiesByName: {},
    relsByName: {},
    selected: null, // { type: 'entity'|'relationship', id: name }
    activeDomain: null,
    cy: null,
  };

  var el = {}; // cached DOM references

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    el.cy = document.getElementById("cy");
    el.detail = document.getElementById("detail-content");
    el.legend = document.getElementById("legend-content");
    el.validation = document.getElementById("validation");
    el.validationBody = document.getElementById("validation-body");
    el.validationSummary = document.getElementById("validation-summary");
    el.tooltip = document.getElementById("tooltip");
    el.questionsOverlay = document.getElementById("questions-overlay");
    el.questionsContent = document.getElementById("questions-content");

    document.getElementById("btn-reload").addEventListener("click", load);
    document.getElementById("btn-relayout").addEventListener("click", runLayout);
    document
      .getElementById("btn-presentation")
      .addEventListener("click", togglePresentation);
    document
      .getElementById("btn-questions")
      .addEventListener("click", openQuestions);
    document
      .getElementById("btn-questions-close")
      .addEventListener("click", closeQuestions);
    el.questionsOverlay.addEventListener("click", function (e) {
      if (e.target === el.questionsOverlay) closeQuestions();
    });
    document
      .getElementById("validation-header")
      .addEventListener("click", function () {
        el.validation.classList.toggle("collapsed");
        document.getElementById("validation-toggle").textContent =
          el.validation.classList.contains("collapsed") ? "▸" : "▾";
      });

    // Apply presentation mode from URL on load.
    if (getParam("presentation") === "1") setPresentation(true);

    load();
  }

  // ---- Data loading ------------------------------------------------------
  function load() {
    var keepSelection = state.selected; // preserve across reload if still present
    fetch("api/ontology")
      .then(function (r) {
        return r.json();
      })
      .then(function (payload) {
        applyPayload(payload, keepSelection);
      })
      .catch(function (err) {
        state.errors = ["Could not reach the server: " + err];
        renderValidation();
      });
  }

  function applyPayload(payload, keepSelection) {
    state.data = payload.data || {};
    state.errors = payload.errors || [];
    state.warnings = payload.warnings || [];

    var domains = (state.data && state.data.domains) || [];
    var entities = (state.data && state.data.entities) || [];
    var rels = (state.data && state.data.relationships) || [];

    state.domainsByName = indexBy(domains, "name");
    state.entitiesByName = indexBy(entities, "name");
    state.relsByName = indexBy(rels, "name");

    renderValidation();
    renderLegend(domains);
    buildGraph(entities, rels);
    renderQuestions();

    // Restore selection if it still exists.
    if (keepSelection) {
      var exists =
        (keepSelection.type === "entity" &&
          state.entitiesByName[keepSelection.id]) ||
        (keepSelection.type === "relationship" &&
          state.relsByName[keepSelection.id]);
      if (exists) {
        select(keepSelection.type, keepSelection.id, false);
        return;
      }
    }
    state.selected = null;
    renderDetail();
  }

  // ---- Graph -------------------------------------------------------------
  function buildGraph(entities, rels) {
    var nodes = entities.map(function (ent) {
      var domain = state.domainsByName[ent.domain];
      var color = (domain && domain.color) || UNASSIGNED_COLOR;
      var border = STATUS_BORDER[ent.status] || STATUS_BORDER.canonical;
      return {
        data: {
          id: ent.name,
          label: ent.name,
          fill: color,
          borderColor: border.color,
          borderStyle: border.style,
          borderWidth: border.width,
          textColor: pickTextColor(color),
        },
      };
    });

    var edges = rels
      .filter(function (r) {
        return (
          r.from &&
          r.to &&
          state.entitiesByName[r.from] &&
          state.entitiesByName[r.to]
        );
      })
      .map(function (r) {
        var border = STATUS_BORDER[r.status] || STATUS_BORDER.canonical;
        var ends = CARDINALITY_ENDPOINTS[r.cardinality] || {
          source: "",
          target: "",
        };
        return {
          data: {
            id: r.name,
            source: r.from,
            target: r.to,
            label: r.label || "",
            lineStyle: border.style,
            sourceLabel: ends.source,
            targetLabel: ends.target,
          },
        };
      });

    if (state.cy) state.cy.destroy();

    state.cy = window.cytoscape({
      container: el.cy,
      elements: { nodes: nodes, edges: edges },
      wheelSensitivity: 0.2,
      style: graphStyle(),
    });

    state.cy.on("tap", "node", function (evt) {
      select("entity", evt.target.id());
    });
    state.cy.on("tap", "edge", function (evt) {
      select("relationship", evt.target.id());
    });
    state.cy.on("tap", function (evt) {
      if (evt.target === state.cy) clearSelection();
    });

    // Tooltips on node hover (description).
    state.cy.on("mouseover", "node", function (evt) {
      var ent = state.entitiesByName[evt.target.id()];
      if (ent && ent.description) showTooltip(evt, ent.description);
    });
    state.cy.on("mouseout", "node", hideTooltip);
    state.cy.on("mousemove", "node", moveTooltip);

    runLayout();
  }

  function graphStyle() {
    return [
      {
        selector: "node",
        style: {
          shape: "round-rectangle",
          "background-color": "data(fill)",
          "border-color": "data(borderColor)",
          "border-width": "data(borderWidth)",
          "border-style": "data(borderStyle)",
          label: "data(label)",
          color: "data(textColor)",
          "text-valign": "center",
          "text-halign": "center",
          "font-size": 13,
          "font-weight": 600,
          width: "label",
          height: "label",
          padding: "12px",
          "text-wrap": "wrap",
          "text-max-width": "120px",
        },
      },
      {
        selector: "edge",
        style: {
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "arrow-scale": 1.1,
          "line-color": "#9aa1ab",
          "target-arrow-color": "#9aa1ab",
          "line-style": "data(lineStyle)",
          width: 1.6,
          label: "data(label)",
          "font-size": 11,
          color: "#4b5563",
          "text-background-color": "#f5f6f8",
          "text-background-opacity": 0.9,
          "text-background-padding": "2px",
          "source-label": "data(sourceLabel)",
          "target-label": "data(targetLabel)",
          "source-text-offset": 16,
          "target-text-offset": 18,
          "source-text-margin-y": -6,
          "target-text-margin-y": -6,
          "font-weight": 700,
        },
      },
      {
        selector: ".selected",
        style: {
          "border-width": 4,
          "border-color": "#2563eb",
          "line-color": "#2563eb",
          "target-arrow-color": "#2563eb",
          "z-index": 100,
        },
      },
      { selector: ".dimmed", style: { opacity: 0.18 } },
      { selector: ".highlighted", style: { opacity: 1 } },
    ];
  }

  function runLayout() {
    if (!state.cy) return;
    var name = window.cytoscapeFcose ? "fcose" : "cose";
    state.cy
      .layout({
        name: name,
        animate: true,
        animationDuration: 500,
        nodeRepulsion: 8000,
        idealEdgeLength: 130,
        padding: 40,
        randomize: true,
      })
      .run();
  }

  // ---- Selection ---------------------------------------------------------
  function select(type, id, doCenter) {
    state.selected = { type: type, id: id };
    if (state.cy) {
      state.cy.elements().removeClass("selected");
      var node = state.cy.getElementById(id);
      if (node) {
        node.addClass("selected");
        if (doCenter !== false) state.cy.animate({ center: { eles: node } }, { duration: 250 });
      }
    }
    renderDetail();
    if (document.body.classList.contains("presentation")) showPopover(type, id);
  }

  function clearSelection() {
    state.selected = null;
    if (state.cy) state.cy.elements().removeClass("selected");
    renderDetail();
    hidePopover();
  }

  // ---- Detail panel ------------------------------------------------------
  function renderDetail() {
    if (!state.selected) {
      renderSummary();
      return;
    }
    if (state.selected.type === "entity") renderEntityDetail(state.selected.id);
    else renderRelationshipDetail(state.selected.id);
  }

  function renderSummary() {
    var d = state.data || {};
    var counts = {
      Entities: (d.entities || []).length,
      Relationships: (d.relationships || []).length,
      Domains: (d.domains || []).length,
      "Open questions": (d.open_questions || []).length,
    };
    var html = "<h2>Overview</h2><div class='summary-counts'>";
    Object.keys(counts).forEach(function (k) {
      html +=
        "<div class='count-box'><span class='n'>" +
        counts[k] +
        "</span><span class='l'>" +
        esc(k) +
        "</span></div>";
    });
    html += "</div>";
    html += row("Version", esc(d.version != null ? d.version : "—"));
    html += row("Last updated", esc(d.last_updated || "—"));
    html += row("Ratified", d.ratified ? "Yes" : "No");
    html +=
      row(
        "Validation",
        state.errors.length +
          " error(s), " +
          state.warnings.length +
          " warning(s)"
      ) ;
    html += "<p class='legend-note'>Click a node or edge for details.</p>";
    el.detail.innerHTML = html;
  }

  function renderEntityDetail(name) {
    var ent = state.entitiesByName[name];
    if (!ent) return renderSummary();
    var domain = state.domainsByName[ent.domain];
    var color = (domain && domain.color) || UNASSIGNED_COLOR;
    var domainLabel = domain
      ? esc(domain.label || domain.name)
      : ent.domain
      ? esc(ent.domain) + " (unknown)"
      : "Unassigned";

    var html = "<h2>" + esc(ent.name) + "</h2>";
    html +=
      "<span class='badge " +
      esc(ent.status) +
      "'>" +
      esc(ent.status || "?") +
      "</span>";
    html += row(
      "Domain",
      "<span class='swatch' style='background:" + color + "'></span>" + domainLabel
    );
    if (ent.owner) html += row("Owner", esc(ent.owner));
    html += row("Description", esc(ent.description || "—"));
    if (ent.aliases && ent.aliases.length)
      html += row("Aliases", esc(ent.aliases.join(", ")));
    if (ent.notes) html += row("Notes", esc(ent.notes));

    // Relationships this entity participates in.
    var rels = state.data.relationships || [];
    var asFrom = rels.filter(function (r) {
      return r.from === name;
    });
    var asTo = rels.filter(function (r) {
      return r.to === name;
    });
    if (asFrom.length || asTo.length) {
      html += "<div class='detail-row'><div class='detail-label'>Relationships</div><ul class='rel-list'>";
      asFrom.forEach(function (r) {
        html +=
          "<li>" +
          esc(r.label || r.name) +
          " → " +
          relLink(r.to) +
          " " +
          relNameLink(r.name) +
          "</li>";
      });
      asTo.forEach(function (r) {
        html +=
          "<li>" +
          relLink(r.from) +
          " " +
          esc(r.label || r.name) +
          " → this " +
          relNameLink(r.name) +
          "</li>";
      });
      html += "</ul></div>";
    }
    el.detail.innerHTML = html;
    wireDetailLinks();
  }

  function renderRelationshipDetail(name) {
    var r = state.relsByName[name];
    if (!r) return renderSummary();
    var html = "<h2>" + esc(r.name) + "</h2>";
    html +=
      "<span class='badge " +
      esc(r.status) +
      "'>" +
      esc(r.status || "?") +
      "</span>";
    html += row(
      "From → To",
      relLink(r.from) + " → " + relLink(r.to)
    );
    html += row("Label", esc(r.label || "—"));
    html += row("Cardinality", esc(r.cardinality || "—"));
    if (r.notes) html += row("Notes", esc(r.notes));
    el.detail.innerHTML = html;
    wireDetailLinks();
  }

  function relLink(entityName) {
    if (!entityName) return "—";
    return (
      "<a class='link' data-entity='" +
      esc(entityName) +
      "'>" +
      esc(entityName) +
      "</a>"
    );
  }

  function relNameLink(relName) {
    return (
      "<a class='link' data-rel='" +
      esc(relName) +
      "' title='Open relationship'>(edge)</a>"
    );
  }

  function wireDetailLinks() {
    el.detail.querySelectorAll("[data-entity]").forEach(function (a) {
      a.addEventListener("click", function () {
        select("entity", a.getAttribute("data-entity"));
      });
    });
    el.detail.querySelectorAll("[data-rel]").forEach(function (a) {
      a.addEventListener("click", function () {
        select("relationship", a.getAttribute("data-rel"));
      });
    });
  }

  // ---- Legend ------------------------------------------------------------
  function renderLegend(domains) {
    if (!domains.length) {
      el.legend.innerHTML =
        "<p class='legend-note'>No domains defined.</p>";
      return;
    }
    var html = "";
    domains.forEach(function (d) {
      html +=
        "<div class='legend-item' data-domain='" +
        esc(d.name) +
        "'>" +
        "<span class='swatch' style='background:" +
        (d.color || UNASSIGNED_COLOR) +
        "'></span>" +
        "<div><div class='l-label'>" +
        esc(d.label || d.name) +
        "</div>" +
        (d.owner ? "<div class='l-owner'>" + esc(d.owner) + "</div>" : "") +
        "</div></div>";
    });
    html +=
      "<div class='legend-item' data-domain='__unassigned'>" +
      "<span class='swatch' style='background:" +
      UNASSIGNED_COLOR +
      "'></span><div><div class='l-label'>Unassigned</div></div></div>";
    el.legend.innerHTML = html;

    el.legend.querySelectorAll(".legend-item").forEach(function (item) {
      item.addEventListener("click", function () {
        toggleDomain(item.getAttribute("data-domain"), item);
      });
    });
  }

  function toggleDomain(domainName, item) {
    if (!state.cy) return;
    var isActive = state.activeDomain === domainName;
    el.legend.querySelectorAll(".legend-item").forEach(function (i) {
      i.classList.remove("active");
    });
    state.cy.nodes().removeClass("dimmed");

    if (isActive) {
      state.activeDomain = null;
      return;
    }
    state.activeDomain = domainName;
    item.classList.add("active");
    state.cy.nodes().forEach(function (n) {
      var ent = state.entitiesByName[n.id()];
      var d = ent ? ent.domain : null;
      var matches =
        domainName === "__unassigned"
          ? !d || !state.domainsByName[d]
          : d === domainName;
      if (!matches) n.addClass("dimmed");
    });
  }

  // ---- Validation panel --------------------------------------------------
  function renderValidation() {
    var e = state.errors.length;
    var w = state.warnings.length;
    el.validationSummary.textContent =
      "Validation — " + e + " error(s), " + w + " warning(s)";

    var html = "";
    if (e) {
      html += "<div class='v-section-title'>Errors</div>";
      state.errors.forEach(function (m) {
        html += "<div class='v-error'>" + esc(m) + "</div>";
      });
    }
    if (w) {
      html += "<div class='v-section-title'>Warnings</div>";
      state.warnings.forEach(function (m) {
        html += "<div class='v-warning'>" + esc(m) + "</div>";
      });
    }
    if (!e && !w) html = "<div class='v-ok'>No issues found.</div>";
    el.validationBody.innerHTML = html;

    // Auto-expand when there are errors.
    if (e) {
      el.validation.classList.remove("collapsed");
      document.getElementById("validation-toggle").textContent = "▾";
    }
  }

  // ---- Open questions ----------------------------------------------------
  function renderQuestions() {
    var oqs = (state.data && state.data.open_questions) || [];
    if (!oqs.length) {
      el.questionsContent.innerHTML =
        "<p class='legend-note'>No open questions.</p>";
      return;
    }
    var html = "";
    oqs.forEach(function (oq) {
      html +=
        "<div class='oq'><div><span class='oq-id'>" +
        esc(oq.id || "?") +
        "</span><span class='oq-topic'>" +
        esc(oq.topic || "") +
        "</span></div>" +
        "<div class='oq-desc'>" +
        esc(oq.description || "") +
        "</div>" +
        (oq.needs_input_from
          ? "<div class='oq-needs'>Needs input from: " +
            esc(oq.needs_input_from) +
            "</div>"
          : "") +
        "</div>";
    });
    el.questionsContent.innerHTML = html;
  }

  function openQuestions() {
    el.questionsOverlay.classList.remove("hidden");
  }
  function closeQuestions() {
    el.questionsOverlay.classList.add("hidden");
  }

  // ---- Presentation mode -------------------------------------------------
  function togglePresentation() {
    setPresentation(!document.body.classList.contains("presentation"));
  }

  function setPresentation(on) {
    document.body.classList.toggle("presentation", on);
    document.getElementById("btn-presentation").classList.toggle("active", on);
    setParam("presentation", on ? "1" : null);
    if (!on) hidePopover();
    if (state.cy) setTimeout(function () { state.cy.resize(); state.cy.fit(null, 40); }, 50);
  }

  function showPopover(type, id) {
    hidePopover();
    var pop = document.createElement("div");
    pop.id = "popover";
    var title, body;
    if (type === "entity") {
      var ent = state.entitiesByName[id];
      if (!ent) return;
      title = ent.name;
      body = ent.description || "";
    } else {
      var r = state.relsByName[id];
      if (!r) return;
      title = (r.from || "?") + " " + (r.label || "") + " " + (r.to || "?");
      body = (r.cardinality || "") + (r.notes ? " — " + r.notes : "");
    }
    pop.innerHTML = "<h3>" + esc(title) + "</h3><div>" + esc(body) + "</div>";
    document.getElementById("graph-area").appendChild(pop);
    var node = state.cy && state.cy.getElementById(id);
    if (node && node.renderedPosition) {
      var p = node.renderedPosition();
      pop.style.left = Math.min(p.x + 20, el.cy.clientWidth - 300) + "px";
      pop.style.top = Math.max(p.y - 20, 10) + "px";
    } else {
      pop.style.left = "20px";
      pop.style.top = "20px";
    }
  }

  function hidePopover() {
    var p = document.getElementById("popover");
    if (p) p.remove();
  }

  // ---- Tooltip -----------------------------------------------------------
  function showTooltip(evt, text) {
    el.tooltip.textContent = text;
    el.tooltip.classList.remove("hidden");
    moveTooltip(evt);
  }
  function moveTooltip(evt) {
    var pos = evt.renderedPosition || (evt.cy && evt.cy.renderedMousePosition);
    if (!pos) return;
    el.tooltip.style.left = pos.x + 14 + "px";
    el.tooltip.style.top = pos.y + 14 + "px";
  }
  function hideTooltip() {
    el.tooltip.classList.add("hidden");
  }

  // ---- Helpers -----------------------------------------------------------
  function row(label, valueHtml) {
    return (
      "<div class='detail-row'><div class='detail-label'>" +
      esc(label) +
      "</div><div class='detail-value'>" +
      valueHtml +
      "</div></div>"
    );
  }

  function indexBy(list, key) {
    var out = {};
    (list || []).forEach(function (item) {
      if (item && item[key] != null) out[item[key]] = item;
    });
    return out;
  }

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pickTextColor(hex) {
    // Choose black/white text for contrast against the fill colour.
    var c = (hex || "").replace("#", "");
    if (c.length === 3)
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    if (c.length !== 6) return "#ffffff";
    var r = parseInt(c.slice(0, 2), 16);
    var g = parseInt(c.slice(2, 4), 16);
    var b = parseInt(c.slice(4, 6), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#1f2328" : "#ffffff";
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function setParam(name, value) {
    var url = new URL(window.location.href);
    if (value == null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState({}, "", url);
  }
})();
