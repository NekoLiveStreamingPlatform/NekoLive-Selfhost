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

// Replace the server-rendered game <select> with the same searchable picker
// pattern used by WEBLIVE. The hidden channelGame field is the only value that
// gets submitted, and game-picker.js only fills it after the user selects an
// exact game returned by NekoLive's canonical /api/games catalogue.
(function () {
  "use strict";

  const oldSelect = document.querySelector('select[name="channelGame"]');
  if (!oldSelect) return;

  const currentGame = String(oldSelect.value || "").trim();
  const picker = document.createElement("div");
  picker.id = "nl-game-picker";
  picker.dataset.gamesApi = "/admin/games/search";

  const search = document.createElement("input");
  search.id = "game-search";
  search.type = "text";
  search.className = "nl-input";
  search.placeholder = "Type to search NekoLive games...";
  search.autocomplete = "off";
  search.value = currentGame;
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-controls", "game-select");

  const hidden = document.createElement("input");
  hidden.id = "channel-game";
  hidden.type = "hidden";
  hidden.name = "channelGame";
  hidden.value = currentGame;

  const results = document.createElement("select");
  results.id = "game-select";
  results.className = "nl-input";
  results.size = 6;
  results.style.display = "none";
  results.style.marginTop = ".5rem";
  results.setAttribute("aria-label", "Matching NekoLive games");

  const actions = document.createElement("div");
  actions.style.marginTop = ".5rem";
  actions.style.display = "flex";
  actions.style.alignItems = "center";
  actions.style.gap = ".5rem";
  actions.style.flexWrap = "wrap";

  const clear = document.createElement("button");
  clear.id = "game-clear";
  clear.type = "button";
  clear.className = "nl-btn secondary";
  clear.textContent = "Set Uncategorized";

  const status = document.createElement("p");
  status.id = "no-game-found";
  status.className = "nl-help";
  status.style.margin = "0";
  status.style.display = currentGame ? "block" : "none";
  status.textContent = currentGame ? `Selected: ${currentGame}` : "";

  actions.appendChild(clear);
  actions.appendChild(status);
  picker.appendChild(search);
  picker.appendChild(hidden);
  picker.appendChild(results);
  picker.appendChild(actions);
  oldSelect.replaceWith(picker);

  const existingHelp = picker.parentElement?.querySelector(".nl-help");
  if (existingHelp) {
    existingHelp.textContent =
      "Type a game name and select the exact result from NekoLive. Results are searched live from nekolive.co.uk/api/games. Clearing the field saves Uncategorized.";
  }

  const script = document.createElement("script");
  script.src = "/js/game-picker.js";
  script.defer = false;
  document.body.appendChild(script);
})();
