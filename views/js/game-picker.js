(function () {
  "use strict";

  const picker = document.getElementById("nl-game-picker");
  if (!picker) return;

  const form = picker.closest("form");
  const searchInput = document.getElementById("game-search");
  const valueInput = document.getElementById("channel-game");
  const results = document.getElementById("game-select");
  const status = document.getElementById("no-game-found");
  const clearButton = document.getElementById("game-clear");
  const apiUrl = String(picker.dataset.gamesApi || "").trim();

  if (!form || !searchInput || !valueInput || !results || !status || !apiUrl) return;

  let debounceTimer = null;
  let activeController = null;
  let requestSerial = 0;
  let selectedName = String(valueInput.value || "").trim();

  function hideResults() {
    results.style.display = "none";
  }

  function showStatus(message, isError) {
    status.textContent = message;
    status.style.display = message ? "block" : "none";
    status.style.color = isError ? "#fca5a5" : "";
  }

  function normalizeGames(payload, query) {
    const source = Array.isArray(payload?.games)
      ? payload.games
      : Array.isArray(payload)
        ? payload
        : [];
    const term = String(query || "").trim().toLowerCase();

    return source
      .filter((game) => game && String(game.name || "").trim())
      .map((game) => ({
        id: game.id,
        name: String(game.name).trim(),
        image: String(game.image || ""),
        url: String(game.url || "")
      }))
      .filter((game) => !term || game.name.toLowerCase().includes(term))
      .sort((a, b) => {
        if (term) {
          const aStarts = a.name.toLowerCase().startsWith(term) ? 1 : 0;
          const bStarts = b.name.toLowerCase().startsWith(term) ? 1 : 0;
          if (aStarts !== bStarts) return bStarts - aStarts;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 40);
  }

  function chooseGame(name) {
    selectedName = String(name || "").trim();
    searchInput.value = selectedName;
    valueInput.value = selectedName;
    hideResults();
    showStatus(selectedName ? `Selected: ${selectedName}` : "Uncategorized", false);
  }

  function renderGames(games) {
    results.replaceChildren();

    if (!games.length) {
      hideResults();
      showStatus("No game found. Try another search.", false);
      return;
    }

    games.forEach((game) => {
      const option = document.createElement("option");
      option.value = game.name;
      option.textContent = game.name;
      if (game.image) option.dataset.image = game.image;
      results.appendChild(option);
    });

    results.size = Math.min(8, Math.max(3, games.length));
    results.style.display = "block";
    showStatus(`${games.length} matching game${games.length === 1 ? "" : "s"}. Select one below.`, false);
  }

  async function fetchGames(query) {
    if (activeController) activeController.abort();
    activeController = new AbortController();
    const currentRequest = ++requestSerial;
    const trimmed = String(query || "").trim();

    showStatus("Searching NekoLive games…", false);

    try {
      const separator = apiUrl.includes("?") ? "&" : "?";
      const response = await fetch(
        `${apiUrl}${separator}search=${encodeURIComponent(trimmed)}`,
        {
          headers: { Accept: "application/json" },
          signal: activeController.signal,
          cache: "no-store"
        }
      );
      if (!response.ok) throw new Error(`NekoLive games API returned ${response.status}`);

      const payload = await response.json();
      if (currentRequest !== requestSerial) return;
      renderGames(normalizeGames(payload, trimmed));
    } catch (error) {
      if (error.name === "AbortError") return;
      hideResults();
      showStatus("Could not load NekoLive games right now. Try again in a moment.", true);
      console.warn("NekoLive game search failed:", error);
    }
  }

  function scheduleSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fetchGames(searchInput.value).catch(() => {});
    }, 180);
  }

  searchInput.addEventListener("input", () => {
    const typed = searchInput.value.trim();
    if (typed !== selectedName) valueInput.value = "";
    if (!typed) {
      selectedName = "";
      valueInput.value = "";
    }
    scheduleSearch();
  });

  searchInput.addEventListener("focus", () => {
    fetchGames(searchInput.value).catch(() => {});
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && results.style.display !== "none" && results.options.length) {
      event.preventDefault();
      results.focus();
      results.selectedIndex = Math.max(0, results.selectedIndex);
    }
    if (event.key === "Escape") hideResults();
  });

  results.addEventListener("change", () => {
    if (results.value) chooseGame(results.value);
  });

  results.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && results.value) {
      event.preventDefault();
      chooseGame(results.value);
      searchInput.focus();
    }
    if (event.key === "Escape") {
      hideResults();
      searchInput.focus();
    }
  });

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      chooseGame("");
      searchInput.value = "";
      searchInput.focus();
    });
  }

  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) hideResults();
  });

  form.addEventListener("submit", (event) => {
    const typed = searchInput.value.trim();
    const selected = valueInput.value.trim();

    if (!typed) {
      valueInput.value = "";
      return;
    }

    if (!selected || typed !== selected) {
      event.preventDefault();
      showStatus("Select the game from the NekoLive search results before saving.", true);
      searchInput.focus();
      fetchGames(typed).catch(() => {});
    }
  });

  if (selectedName) {
    showStatus(`Selected: ${selectedName}`, false);
  }
})();
