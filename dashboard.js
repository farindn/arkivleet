document.addEventListener("DOMContentLoaded", () => {
  // --- STATE MANAGEMENT ---
  const credentials = {
    sessionId: sessionStorage.getItem("sessionId"),
    userName: sessionStorage.getItem("userName"),
    database: sessionStorage.getItem("database"),
  };

  let allDevices = [];
  let dailyTripData = new Map();
  let selectedTimeZone = 'UTC'; // Default timezone
  let currentSortConfig = { column: "name", direction: "asc" };
  let currentSearchTerm = "";
  const rowsPerPage = 10;
  let timezoneSelect; // To hold the Choices.js instance

  // --- INITIALIZATION ---
  initializeDashboard();

  /**
   * 🚀 Main function to initialize the dashboard.
   */
  async function initializeDashboard() {
    if (!credentials.sessionId) {
      showToast("Session expired. Please log in again.", "error");
      setTimeout(() => (window.location.href = "index.html"), 2000);
      return;
    }

    setupNavbar();
    setupTimezoneSelector();
    
    // Fetch device list once, as it's static.
    allDevices = await fetchFromGeotab("Get", { typeName: "Device" }, credentials);
    document.getElementById("card-total").textContent = allDevices.length;
    
    setupTableControls();
    
    // Initial data load using the default timezone.
    await reloadData();
    
    document.getElementById("dashboardContent").classList.remove("hidden");
  }
  
  /**
   * 🔄 Reloads all dynamic data based on the currently selected timezone.
   */
  async function reloadData() {
    showLoader();
    try {
      // 1. Fetch daily trip data for the selected timezone.
      dailyTripData = await loadDailyTripData();
      
      // 2. Render the first page of the table with the new data.
      await renderTablePage(1);

      // 3. Asynchronously update the summary cards.
      loadFleetSummary();
    } catch (err) {
      console.error("Error reloading data:", err);
      showToast("Failed to reload data for the selected timezone.", "error");
    } finally {
      hideLoader();
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
    document.getElementById("userArea").addEventListener("click", () => {
        document.getElementById("dropdownMenu").classList.toggle("hidden");
    });
    document.getElementById("logoutBtn").addEventListener("click", () => {
      sessionStorage.clear();
      window.location.href = "index.html";
    });
  }

  /**
   * 🌍 Sets up the timezone selector dropdown.
   */
  function setupTimezoneSelector() {
    const selector = document.getElementById('timezone-selector');
    const timezones = Intl.supportedValuesOf('timeZone');
    
    timezones.forEach(tz => {
        const option = document.createElement('option');
        option.value = tz;
        option.textContent = tz.replace(/_/g, ' ');
        if (tz === selectedTimeZone) {
            option.selected = true;
        }
        selector.appendChild(option);
    });

    timezoneSelect = new Choices(selector, {
        searchEnabled: true,
        itemSelectText: 'Select',
    });

    selector.addEventListener('change', (event) => {
        selectedTimeZone = event.detail.value;
        reloadData();
    });
  }

  /**
   * 🚗 Fetches and aggregates trip data for the current day in the selected timezone.
   * @returns {Promise<Map<string, number>>} A map of device IDs to their total distance.
   */
  async function loadDailyTripData() {
    const { fromDate, toDate } = getUtcDateRangeForTimeZone(selectedTimeZone);
    
    const trips = await fetchFromGeotab("Get", {
      typeName: "Trip",
      search: { fromDate, toDate }
    }, credentials);

    const distanceByDevice = new Map();
    for (const trip of trips) {
      const deviceId = trip.device.id;
      const currentDistance = distanceByDevice.get(deviceId) || 0;
      distanceByDevice.set(deviceId, currentDistance + trip.distance);
    }
    return distanceByDevice;
  }
  
  /**
   * 📅 Calculates the start and end of today in UTC for a given timezone.
   * @param {string} timeZone The IANA timezone identifier (e.g., 'Asia/Jakarta').
   * @returns {{fromDate: string, toDate: string}}
   */
  function getUtcDateRangeForTimeZone(timeZone) {
    const { zonedTimeToUtc, startOfDay, endOfDay } = window.dateFnsTz;
    const nowInZone = zonedTimeToUtc(new Date(), timeZone);
    
    const startOfTodayInZone = startOfDay(nowInZone);
    const endOfTodayInZone = endOfDay(nowInZone);
    
    const fromDate = zonedTimeToUtc(startOfTodayInZone, timeZone).toISOString();
    const toDate = zonedTimeToUtc(endOfTodayInZone, timeZone).toISOString();
    
    return { fromDate, toDate };
  }

  /**
   * 📈 Asynchronously fetches status for the entire fleet to update summary cards.
   */
  async function loadFleetSummary() {
    try {
      const statusInfo = await fetchFromGeotab("Get", { typeName: "DeviceStatusInfo" }, credentials);
      const communicatingDevices = statusInfo.filter(s => s.isDeviceCommunicating);
      
      let lessUtilizedCount = 0;
      for (const device of communicatingDevices) {
        const distance = dailyTripData.get(device.device.id) || 0;
        if (distance < 10) {
          lessUtilizedCount++;
        }
      }

      document.getElementById("card-comm").textContent = communicatingDevices.length;
      document.getElementById("card-driving").textContent = statusInfo.filter(s => s.isDriving).length;
      document.getElementById("card-less-utilized").textContent = lessUtilizedCount;
    } catch(err) {
        console.error("Could not load fleet summary:", err);
        showToast("Could not load fleet summary cards.", "error");
    }
  }

  /**
   * 📖 Renders a specific page of the vehicle table.
   */
  async function renderTablePage(page) {
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
        search: { deviceSearch: { ids: deviceIds } }
    }, credentials);
    const statusMap = Object.fromEntries(statusList.map(s => [s.device.id, s]));

    const tableBody = document.getElementById("vehicle-table-body");
    tableBody.innerHTML = "";
    pageDevices.forEach(device => {
      const status = statusMap[device.id] || {};
      const distanceToday = dailyTripData.get(device.id) || 0;
      const row = document.createElement("tr");
      row.classList.add("fade-in");
      row.innerHTML = `
          <td>${device.name || "Unknown"}</td>
          <td><code class="code-block">${device.vehicleIdentificationNumber || "-"}</code></td>
          <td><code class="code-block">${device.serialNumber || "-"}</code></td>
          <td>${status.isDriving ? 'Yes' : 'No'}</td>
          <td>${distanceToday.toFixed(2)}</td>
      `;
      tableBody.appendChild(row);
    });
    
    updatePaginationControls(pageInfo);
  }

  /**
   * 🎛️ Sets up event listeners for search, sort, and pagination.
   */
  function setupTableControls() {
    document.getElementById("searchInput").addEventListener("input", (e) => {
        currentSearchTerm = e.target.value;
        renderTablePage(1);
    });
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
    let filtered = [...allDevices];
    if (currentSearchTerm) {
      const lowercasedTerm = currentSearchTerm.toLowerCase();
      filtered = allDevices.filter(d =>
        (d.name || "").toLowerCase().includes(lowercasedTerm) ||
        (d.vehicleIdentificationNumber || "").toLowerCase().includes(lowercasedTerm) ||
        (d.serialNumber || "").toLowerCase().includes(lowercasedTerm)
      );
    }
    filtered.sort((a, b) => {
        const valA = a[currentSortConfig.column]?.toLowerCase?.() || a[currentSortConfig.column] || "";
        const valB = b[currentSortConfig.column]?.toLowerCase?.() || b[currentSort-Config.column] || "";
        if (valA < valB) return currentSortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });
    return filtered;
  }
});
