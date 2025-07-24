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
  
      let drivingCount = 0;
      let idlingCount = 0;
  
      statusInfo.forEach(status => {
        const state = getVehicleState(status);
        if (state.isDriving) drivingCount++;
        if (state.isIdling) idlingCount++;
      });
  
      document.getElementById("card-comm").textContent = statusInfo.filter(s => s.isDeviceCommunicating).length;
      document.getElementById("card-driving").textContent = drivingCount;
      document.getElementById("card-idling").textContent = idlingCount; // Updated ID
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
      // ... (top part of the function remains the same) ...
      
      const tableBody = document.getElementById("vehicle-table-body");
      tableBody.innerHTML = ""; // Clear previous content
      pageDevices.forEach(device => {
        const status = statusMap[device.id] || {};
        const state = getVehicleState(status); // Use our new helper
  
        const row = document.createElement("tr");
        row.classList.add("fade-in");
        row.innerHTML = `
            <td>${device.name || "Unknown"}</td>
            <td><code class="code-block">${device.vehicleIdentificationNumber || "-"}</code></td>
            <td><code class="code-block">${device.serialNumber || "-"}</code></td>
            <td>${state.isDriving ? 'Yes' : 'No'}</td>
            <td>${state.isIdling ? 'Yes' : 'No'}</td>
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
   * Determines the ignition state with improved logic.
   * @returns {'ON' | 'OFF' | 'UNKNOWN'}
   */
  function getIgnitionState(status) {
    // Rule: If the vehicle is driving, ignition is ON.
    if (status.isDriving) {
      return 'ON';
    }
  
    // Find the ignition diagnostic from the API response.
    const ignitionDiagnostic = status.diagnostics?.find(d => d.diagnostic.id === "DiagnosticIgnitionId");
  
    // If no ignition data is available at all, default to OFF.
    if (!ignitionDiagnostic) {
      return 'OFF';
    }
  
    // Check if the reading is recent (within 5 minutes) to prevent very stale data.
    const isFresh = (new Date() - new Date(ignitionDiagnostic.dateTime)) < 5 * 60 * 1000;
  
    // Return ON if the data is 1 and the reading is fresh, otherwise OFF.
    return ignitionDiagnostic.data === 1 && isFresh ? 'ON' : 'OFF';
  }

  /**
 * Determines the driving and idling state of a vehicle based on its status.
 * @param {object} status The DeviceStatusInfo object.
 * @returns {{isDriving: boolean, isIdling: boolean}}
 */
  function getVehicleState(status) {
    // A device must be communicating to be considered driving or idling.
    if (!status.isDeviceCommunicating) {
      return { isDriving: false, isIdling: false };
    }
  
    const isDriving = status.isDriving;
    // Use our existing ignition logic to check if the ignition is on.
    const ignitionOn = getIgnitionState(status) === 'ON';
    // A vehicle is idling if its ignition is ON and it is NOT driving.
    const isIdling = ignitionOn && !isDriving;
  
    return { isDriving, isIdling };
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
