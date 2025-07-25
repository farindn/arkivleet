document.addEventListener("DOMContentLoaded", () => {
  // --- STATE MANAGEMENT ---
  const credentials = {
    sessionId: sessionStorage.getItem("sessionId"),
    userName: sessionStorage.getItem("userName"),
    database: sessionStorage.getItem("database"),
  };

  let allDevices = [];
  let dailyTripData = new Map();
  let userTimeZoneId = "UTC"; // Default to UTC
  let currentSortConfig = { column: "name", direction: "asc" };
  let currentSearchTerm = "";
  const rowsPerPage = 10;

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
    showLoader();

    try {
      // 1. Fetch user's timezone first.
      const userResult = await fetchFromGeotab("Get", {
        typeName: "User",
        search: { name: credentials.userName },
      }, credentials);
      if (userResult[0]?.timeZoneId) {
        userTimeZoneId = userResult[0].timeZoneId;
      }
      document.getElementById("user-timezone").textContent = userTimeZoneId;

      // 2. Fetch all devices and daily trip data concurrently, using the new timezone.
      [allDevices, dailyTripData] = await Promise.all([
        fetchFromGeotab("Get", {
          typeName: "Device",
          search: { "fromDate": new Date().toISOString() }
        }, credentials),
        loadDailyTripData(userTimeZoneId),
      ]);
      document.getElementById("card-total").textContent = allDevices.length;
      
      // 3. Setup table and render the first page.
      setupTableControls();
      await renderTablePage(1);

      // 4. Asynchronously load fleet-wide summary data.
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
   * 📅 Calculates the start and end of "today" in UTC based on the user's timezone.
   * @param {string} timeZoneId The IANA timezone ID (e.g., "Asia/Jakarta").
   * @returns {{fromDate: string, toDate: string}} The UTC date strings.
   */
  function getDateRangeInUTCForToday(timeZoneId) {
    // 1. Get the current date parts in the target timezone using 'en-CA' format (YYYY-MM-DD).
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZoneId }).formatToParts(now);
    const { year, month, day } = parts.reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

    // 2. Create a string for midnight on that day and an anchor date object from it.
    const midnightString = `${year}-${month}-${day}T00:00:00`;
    const anchorDate = new Date(midnightString + "Z"); // Treat as UTC to create a solid anchor point in time.
    
    // 3. Find the hour for that anchor point in the target timezone.
    const hourInZone = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZoneId,
      hour: "numeric",
      hourCycle: "h23", // Use 24-hour format (00-23)
    }).format(anchorDate);

    // 4. The offset is the difference between UTC's midnight hour (0) and the hour in the target zone.
    const offsetInHours = 0 - parseInt(hourInZone, 10);

    // 5. Create the correct start date in UTC by applying the offset to our anchor.
    const fromDate = new Date(anchorDate);
    fromDate.setUTCHours(fromDate.getUTCHours() + offsetInHours);

    // 6. The end date is 24 hours later, minus one millisecond.
    const toDate = new Date(fromDate.getTime() + (24 * 60 * 60 * 1000 - 1));

    return { 
      fromDate: fromDate.toISOString(), 
      toDate: toDate.toISOString() 
    };
  }

  /**
   * 🚗 Fetches and aggregates trip data for the current day in the user's timezone.
   * @param {string} timeZoneId The user's timezone ID.
   * @returns {Promise<Map<string, number>>} A map of device IDs to their total distance.
   */
  async function loadDailyTripData(timeZoneId) {
    const { fromDate, toDate } = getDateRangeInUTCForToday(timeZoneId);

    const trips = await fetchFromGeotab("Get", {
      typeName: "Trip",
      search: { fromDate, toDate }
    }, credentials);

    const distanceByDevice = new Map();
    for (const trip of trips) {
      if (!trip.device) continue;
      const deviceId = trip.device.id;
      const currentDistance = distanceByDevice.get(deviceId) || 0;
      distanceByDevice.set(deviceId, currentDistance + trip.distance);
    }
    return distanceByDevice;
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
        document.getElementById("vehicle-table-body").innerHTML = `<tr><td colspan="6">No vehicles found.</td></tr>`;
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
            <td data-label="VIN"><code class="code-block">${device.vehicleIdentificationNumber || "-"}</code></td>
            <td data-label="Serial Number"><code class="code-block">${device.serialNumber || "-"}</code></td>
            <td data-label="Driving">${status.isDriving ? 'Yes' : 'No'}</td>
            <td data-label="Distance Today"><code class="code-block">${distanceToday.toFixed(2)}</code></td>
            <td data-label="Actions">
              <button class="btn-action">
                Details
                <span class="material-symbols-rounded">arrow_forward_ios</span>
              </button>
            </td>
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
   * 🎛️ Sets up event listeners for search, sort, and pagination.
   */
  function setupTableControls() {
    // Search
    document.getElementById("searchInput").addEventListener("input", (e) => {
        currentSearchTerm = e.target.value;
        renderTablePage(1);
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
        const valB = b[currentSortConfig.column]?.toLowerCase?.() || b[currentSortConfig.column] || "";
        if (valA < valB) return currentSortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });
    return filtered;
  }
});
