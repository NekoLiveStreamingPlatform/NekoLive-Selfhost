(function () {
  "use strict";

  const list = document.getElementById("ms-list");
  const errorEl = document.getElementById("ms-error");
  const addForm = document.getElementById("ms-add-form");
  if (!list || !addForm) return; // dashboard sections rendered independently; guard just in case

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }
  function clearError() {
    errorEl.style.display = "none";
  }

  function renderTargets(targets) {
    list.innerHTML = "";
    if (!targets.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5" style="color: var(--muted);">No destinations yet.</td>';
      list.appendChild(row);
      return;
    }
    targets.forEach((target) => {
      const row = document.createElement("tr");

      const labelCell = document.createElement("td");
      labelCell.textContent = target.label;

      const protocolCell = document.createElement("td");
      protocolCell.textContent = target.protocol.toUpperCase();

      const statusCell = document.createElement("td");
      statusCell.textContent = target.enabled ? (target.active ? "Live" : "On (waiting for stream)") : "Off";

      const toggleCell = document.createElement("td");
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "nl-btn " + (target.enabled ? "danger" : "secondary");
      toggleBtn.textContent = target.enabled ? "Turn off" : "Turn on";
      toggleBtn.addEventListener("click", () => toggleTarget(target.id, !target.enabled));
      toggleCell.appendChild(toggleBtn);

      const deleteCell = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "nl-btn secondary";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteTarget(target.id));
      deleteCell.appendChild(deleteBtn);

      row.appendChild(labelCell);
      row.appendChild(protocolCell);
      row.appendChild(statusCell);
      row.appendChild(toggleCell);
      row.appendChild(deleteCell);
      list.appendChild(row);
    });
  }

  async function loadTargets() {
    try {
      const res = await fetch("/api/multistream");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load destinations.");
      renderTargets(data.targets);
    } catch (err) {
      showError(err.message);
    }
  }

  // Toggling takes effect immediately server-side (routes/api/multistream.js
  // starts/stops the actual OME push right away if already live) — reload
  // the list right after so the UI reflects the real state, not just the
  // optimistic click.
  async function toggleTarget(id, enabled) {
    clearError();
    try {
      const res = await fetch(`/api/multistream/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to toggle destination.");
      loadTargets();
    } catch (err) {
      showError(err.message);
    }
  }

  async function deleteTarget(id) {
    clearError();
    try {
      const res = await fetch(`/api/multistream/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to delete destination.");
      loadTargets();
    } catch (err) {
      showError(err.message);
    }
  }

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const label = document.getElementById("ms-label").value.trim();
    const protocol = document.getElementById("ms-protocol").value;
    const url = document.getElementById("ms-url").value.trim();
    const streamKey = document.getElementById("ms-key").value.trim();
    if (!label || !url) return;

    try {
      const res = await fetch("/api/multistream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, protocol, url, streamKey })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to add destination.");
      addForm.reset();
      loadTargets();
    } catch (err) {
      showError(err.message);
    }
  });

  loadTargets();
})();
