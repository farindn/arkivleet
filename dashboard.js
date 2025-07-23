// 🧠 /dashboard.js (Complete Rewrite)

document.addEventListener("DOMContentLoaded", () => {
  // --- STATE MANAGEMENT ---
  const credentials = {
    sessionId: sessionStorage.getItem("sessionId"),
    userName: sessionStorage.getItem("userName"),
    database: sessionStorage.getItem("database"),
  };

  let allDevices = []; // Full list of devices, fetched once.
  let currentSortConfig = { column: "name", direction: "asc" };
  let currentSearchTerm = "";
  const rowsPerPage = 10;

  // --- INITIALIZATION ---
  initializeDashboard();

  /**
   * 🚀 Main function to initialize the dashboard.
   * It validates the session, fetches initial data, and sets up event listeners.
   */
  async function initializeDashboard() {
    // 🔐 Validate session
    if (!credentials.sessionId) {
      showToast("Session expired. Please log in again.", "error");
      setTimeout(() => (window.location.href = "index.html"), 2000);
      return;
    }

    // 🧑‍💻 Populate user info and set up navbar logout
    setupNavbar();
    showLoader();

    try {
      // 1. Fetch all devices first for a complete list.
      allDevices = await fetchFromGeotab("Get", { typeName: "Device" }, credentials);
      document.getElementById("card-total").textContent = allDevices.length;
      
      // 2. Setup table controls (search, sort, pagination) and render the first page.
      setupTableControls();
      await renderTablePage(1);

      // 3. Asynchronously load fleet-wide summary data for the cards.
      loadFleetSummary();

    } catch (err) {
      console.error("Error initializing dashboard:", err);
      showToast("Failed to load dashboard data.", "error");
    } finally {
      hideLoader();
      document.getElementById("dashboardContent").classList.remove("hidden");
    }
  }

  /**
   * 🌐 Generic wrapper for making API calls to MyGeotab.
   */
  async function fetchFromGeotab(method, params, credentials) {
    const response = await fetch("https://my.geotab.com/apiv1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params: { ...params, credentials } }),
    });
    if (!response.ok) throw new Error(`API call failed: ${response.statusText}`);
    const json = await response.json();
    if (json.error) throw new Error(json.error.message || "Unknown API error");
    return json.result || [];
  }

  /**
   * 🧑‍💻 Sets up the user navbar, dropdown, and logout button.
   */
  function setupNavbar() {
    document.getElementById("user-email").textContent = credentials.userName;
    document.getElementById("user-db").textContent = credentials.database;
    const userArea = document.getElementById("userArea");
    const dropdown = document.getElementById("dropdownMenu");
    userArea.addEventListener("click", () => dropdown.classList.toggle("hidden"));
    document.getElementById("logoutBtn").addEventListener("click", () => {
      sessionStorage.clear();
      window.location.href = "index.html";
    });
  }
  
  /**
   * 📈 Asynchronously fetches status for the entire fleet to update summary cards.
   * This runs in the background and does not block the UI.
   */
  async function loadFleetSummary() {
    try {
      const statusInfo = await fetchFromGeotab("Get", {
          typeName: "DeviceStatusInfo",
          search: { diagnostics: [{ id: "DiagnosticIgnitionId" }] }
      }, credentials);

      const fleetSummary = {
          communicating: statusInfo.filter(s => s.isDeviceCommunicating).length,
          driving: statusInfo.filter(s => s.isDriving).length,
          ignitionOn: statusInfo.filter(s => getIgnitionState(s) === 'ON').length,
      };

      document.getElementById("card-comm").textContent = fleetSummary.communicating;
      document.getElementById("card-driving").textContent = fleetSummary.driving;
      document.getElementById("card-ignition").textContent = fleetSummary.ignitionOn;
    } catch(err) {
        console.error("Could not load fleet summary:", err);
        showToast("Could not load fleet summary cards.", "error");
    }
  }


  /**
   * 📖 Renders a specific page of the vehicle table.
   * @param {number} page The page number to render.
   */
  async function renderTablePage(page) {
    showLoader();
    try {
      const filteredDevices = getFilteredAndSortedDevices();
      const pageInfo = {
        totalItems: filteredDevices.length,
        totalPages: Math.ceil(filteredDevices.length / rowsPerPage),
        currentPage: page
      };
      
      const start = (page - 1) * rowsPerPage;
      const end = start + rowsPerPage;
      const pageDevices = filteredDevices.slice(start, end);
      
      if (pageDevices.length === 0) {
        document.getElementById("vehicle-table-body").innerHTML = `<tr><td colspan="5">No vehicles found.</td></tr>`;
        updatePaginationControls(pageInfo);
        return;
      }

      const deviceIds = pageDevices.map(d => ({ id: d.id }));
      const statusList = await fetchFromGeotab("Get", {
          typeName: "DeviceStatusInfo",
          search: { deviceSearch: { ids: deviceIds }, diagnostics: [{id: "DiagnosticIgnitionId"}] }
      }, credentials);
      const statusMap = Object.fromEntries(statusList.map(s => [s.device.id, s]));

      const tableBody = document.getElementById("vehicle-table-body");
      tableBody.innerHTML = ""; // Clear previous content
      pageDevices.forEach(device => {
        const status = statusMap[device.id] || {};
        const ignitionState = getIgnitionState(status);

        const row = document.createElement("tr");
        row.classList.add("fade-in");
        row.innerHTML = `
            <td>${device.name || "Unknown"}</td>
            <td><code class="code-block">${device.vehicleIdentificationNumber || "-"}</code></td>
            <td><code class="code-block">${device.serialNumber || "-"}</code></td>
            <td>${getIgnitionStateDisplay(ignitionState)}</td>
            <td>${status.isDriving ? "Yes" : "No"}</td>
        `;
        tableBody.appendChild(row);
      });
      
      updatePaginationControls(pageInfo);
    } catch (err) {
      console.error(`Error rendering page ${page}:`, err);
      showToast("Could not load vehicle data for this page.", "error");
    } finally {
      hideLoader();
    }
  }

  /**
   * 🔥 Determines the ignition state with improved logic.
   * @returns {'ON' | 'OFF' | 'UNKNOWN'}
   */
  function getIgnitionState(status) {
    if (!status.isDeviceCommunicating) return 'UNKNOWN';
    const ignitionDiagnostic = status.diagnostics?.find(d => d.diagnostic.id === "DiagnosticIgnitionId");
    if (!ignitionDiagnostic) return 'UNKNOWN';
    const isFresh = (new Date() - new Date(ignitionDiagnostic.dateTime)) < 5 * 60 * 1000; // 5 minute freshness window
    return ignitionDiagnostic.data === 1 && isFresh ? 'ON' : 'OFF';
  }

  /**
   * ✨ Creates a display element for the ignition state.
   */
  function getIgnitionStateDisplay(state) {
      const colorMap = { ON: 'green', OFF: 'red', UNKNOWN: 'grey' };
      const iconMap = { ON: 'power', OFF: 'power_off', UNKNOWN: 'question_mark'};
      return `<span class="material-symbols-rounded" style="color:${colorMap[state]}; vertical-align: middle;">${iconMap[state]}</span> ${state}`;
  }

  /**
   * 🎛️ Sets up event listeners for search, sort, and pagination.
   */
  function setupTableControls() {
    // Search
    document.getElementById("searchInput").addEventListener("input", (e) => {
        currentSearchTerm = e.target.value;
        renderTablePage(1); // Go back to page 1 on new search
    });
    // Sorting
    document.querySelectorAll("th.sortable").forEach(header => {
      header.addEventListener("click", () => {
        const column = header.dataset.column;
        if (currentSortConfig.column === column) {
          currentSortConfig.direction = currentSortConfig.direction === "asc" ? "desc" : "asc";
        } else {
          currentSortConfig.column = column;
          currentSortConfig.direction = "asc";
        }
        document.querySelectorAll("th.sortable .sort-icon").forEach(icon => icon.textContent = "");
        header.querySelector(".sort-icon").textContent = currentSortConfig.direction === "asc" ? "▲" : "▼";
        renderTablePage(1);
      });
    });
    // Set initial sort icon
    document.querySelector(`th[data-column='name'] .sort-icon`).textContent = '▲';
  }
  
  /**
   * ⏪⏩ Updates the state and event listeners for pagination buttons.
   */
  function updatePaginationControls({ currentPage, totalPages }) {
    const prevBtn = document.getElementById("prevPage");
    const nextBtn = document.getElementById("nextPage");
    
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;

    // Clone and replace to remove old event listeners
    const newPrevBtn = prevBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
    const newNextBtn = nextBtn.cloneNode(true);
    nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
    
    if (currentPage > 1) {
        newPrevBtn.addEventListener("click", () => renderTablePage(currentPage - 1));
    }
    if (currentPage < totalPages) {
        newNextBtn.addEventListener("click", () => renderTablePage(currentPage + 1));
    }
  }

  /**
   * 📦 Returns a filtered and sorted list of devices based on current state.
   */
  function getFilteredAndSortedDevices() {
    // Filter
    let filtered = [...allDevices];
    if (currentSearchTerm) {
      const lowercasedTerm = currentSearchTerm.toLowerCase();
      filtered = allDevices.filter(d =>
        (d.name || "").toLowerCase().includes(lowercasedTerm) ||
        (d.vehicleIdentificationNumber || "").toLowerCase().includes(lowercasedTerm) ||
        (d.serialNumber || "").toLowerCase().includes(lowercasedTerm)
      );
    }
    // Sort
    filtered.sort((a, b) => {
        const valA = a[currentSortConfig.column]?.toLowerCase?.() || a[currentSortConfig.column] || "";
        const valB = b[currentSortConfig.column]?.toLowerCase?.() || b[currentSortConfig.column] || "";
        if (valA < valB) return currentSortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });
    return filtered;
  }
});
