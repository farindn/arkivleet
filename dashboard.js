document.addEventListener("DOMContentLoaded", () => {
  // --- STATE MANAGEMENT ---
  const credentials = {
    sessionId: sessionStorage.getItem("sessionId"),
    userName: sessionStorage.getItem("userName"),
    database: sessionStorage.getItem("database"),
  };

  let allDevices = [];
  let dailyTripData = new Map();
  let fullStatusData = [];
  let userTimeZoneId = "UTC";
  let currentSortConfig = { column: "name", direction: "asc" };
  let currentSearchTerm = "";
  let activeFilter = "all";
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
      const userResult = await fetchFromGeotab("Get", {
        typeName: "User",
        search: { name: credentials.userName },
      }, credentials);
      if (userResult[0]?.timeZoneId) {
        userTimeZoneId = userResult[0].timeZoneId;
      }
      document.getElementById("user-timezone").textContent = userTimeZoneId;

      [allDevices, dailyTripData] = await Promise.all([
        fetchAllDevices(credentials),
        loadDailyTripData(userTimeZoneId),
      ]);
      document.getElementById("card-total").textContent = allDevices.length;
      
      setupTableControls();
      await renderTablePage(1);
      
      loadFleetSummary();
      setupCardListeners();
      setupDetailsButtonListener();

    } catch (err) {
      console.error("Error initializing dashboard:", err);
      showToast("Failed to load dashboard data.", "error");
    } finally {
      hideLoader();
      document.getElementById("dashboardContent").classList.remove("hidden");
    }
  }

  /**
   * ✨ Retrieves all devices using sort/offset pagination as specified.
   */
  async function fetchAllDevices(credentials) {
    let allResults = [];
    const resultsLimit = 5000;
    let offsetName = null;
    let lastId = null;

    while (true) {
      const params = {
        typeName: "Device",
        search: {
          fromDate: new Date().toISOString()
        },
        resultsLimit: resultsLimit,
        sort: {
          sortBy: "name",
          sortDirection: "asc"
        }
      };

      if (offsetName !== null) {
        params.sort.offset = offsetName;
        params.sort.lastId = lastId;
      }

      const devices = await fetchFromGeotab("Get", params, credentials);

      if (devices && devices.length > 0) {
        allResults.push(...devices);

        if (devices.length < resultsLimit) {
          break; // Last page
        }
        
        const lastDevice = devices[devices.length - 1];
        offsetName = lastDevice.name;
        lastId = lastDevice.id;
      } else {
        break; // No more results
      }
    }
    return allResults;
  }

  /**
   * 🌐 Generic wrapper for making simple API calls.
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
    
    document.getElementById("dropdown-user-email").textContent = credentials.userName;
    document.getElementById("dropdown-user-db").textContent = credentials.database;

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
   */
  function getDateRangeInUTCForToday(timeZoneId) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZoneId }).formatToParts(now);
    const { year, month, day } = parts.reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

    const midnightString = `${year}-${month}-${day}T00:00:00`;
    const anchorDate = new Date(midnightString + "Z");
    
    const hourInZone = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZoneId,
      hour: "numeric",
      hourCycle: "h23",
    }).format(anchorDate);

    const offsetInHours = 0 - parseInt(hourInZone, 10);

    const fromDate = new Date(anchorDate);
    fromDate.setUTCHours(fromDate.getUTCHours() + offsetInHours);

    const toDate = new Date(fromDate.getTime() + (24 * 60 * 60 * 1000 - 1));

    return { 
      fromDate: fromDate.toISOString(), 
      toDate: toDate.toISOString() 
    };
  }

  /**
   * 🚗 Fetches and aggregates trip data for the current day in the user's timezone.
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
      const statusInfo = await fetchFromGeotab("Get", {
        typeName: "DeviceStatusInfo",
        search: {
          deviceSearch: {
            fromDate: new Date().toISOString(),
            excludeUntrackedAssets: true
          }
        }
      }, credentials);
      fullStatusData = statusInfo;
      
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
      
      const total = filteredDevices.length;
      const start = total > 0 ? (page - 1) * rowsPerPage + 1 : 0;
      const end = Math.min(start + rowsPerPage - 1, total);
      document.getElementById('table-info-text').textContent = `Showing ${start} - ${end} of ${total}`;
      
      const pageInfo = {
        totalItems: total,
        totalPages: Math.ceil(total / rowsPerPage),
        currentPage: page
      };
      
      const pageDevices = filteredDevices.slice(start - 1, end);
      
      if (pageDevices.length === 0 && total > 0) {
        await renderTablePage(1);
        return;
      }
      if (total === 0) {
        document.getElementById("vehicle-table-body").innerHTML = `<tr><td colspan="7">No vehicles found.</td></tr>`;
        updatePaginationControls(pageInfo);
        return;
      }

      const deviceIds = pageDevices.map(d => ({ id: d.id }));
      const statusList = await fetchFromGeotab("Get", {
          typeName: "DeviceStatusInfo",
          search: { deviceSearch: { ids: deviceIds } }
      }, credentials);
      const statusMap = Object.fromEntries(statusList.map(s => [s.device.id, s]));
      
      const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
        timeZone: userTimeZoneId,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      const tableBody = document.getElementById("vehicle-table-body");
      tableBody.innerHTML = "";
      pageDevices.forEach(device => {
        const status = statusMap[device.id] || {};
        const distanceToday = dailyTripData.get(device.id) || 0;
        const serialNumber = device.serialNumber || "-";

        const isCommunicating = status.isDeviceCommunicating;
        const updateIcon = isCommunicating ? 'wifi' : 'wifi_off';
        const updateColorClass = isCommunicating ? 'update-fresh' : 'update-stale';
        const formattedDateTime = status.dateTime ? dateTimeFormatter.format(new Date(status.dateTime)) : "N/A";
        
        const statusIconHTML = `<span class="material-symbols-rounded ${updateColorClass}">${updateIcon}</span>`;

        const actionButtonHTML = `
          <button class="btn-action" data-id="${device.id}">
            Details
            <span class="material-symbols-rounded">arrow_forward_ios</span>
          </button>
        `;

        const row = document.createElement("tr");
        row.classList.add("fade-in");
        
        row.innerHTML = `
            <td class="status-col">${statusIconHTML}</td>
            <td>
              <div class="mobile-view">
                <div class="mobile-view-info">
                  <div class="vehicle-name">${device.name || "Unknown"}</div>
                  <div class="vehicle-serial"><code class="code-block">${serialNumber}</code></div>
                  <div class="vehicle-last-update">
                    <span class="material-symbols-rounded ${updateColorClass}">${updateIcon}</span>
                    <span class="${updateColorClass}">${formattedDateTime}</span>
                  </div>
                </div>
                ${actionButtonHTML}
              </div>
              <span class="desktop-view">${device.name || "Unknown"}</span>
            </td>
            <td><code class="code-block">${device.vehicleIdentificationNumber || "-"}</code></td>
            <td><code class="code-block">${serialNumber}</code></td>
            <td>${status.isDriving ? 'Yes' : 'No'}</td>
            <td><code class="code-block">${distanceToday.toFixed(2)}</code></td>
            <td>${actionButtonHTML}</td>
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
   * 🃏 Adds click listeners to the summary cards to filter the table.
   */
  function setupCardListeners() {
    const cardFilters = {
        'card-total': 'all',
        'card-comm': 'communicating',
        'card-driving': 'driving',
        'card-less-utilized': 'lessUtilized'
    };
    document.querySelectorAll('.card').forEach(card => {
        const statElement = card.querySelector('.stat-number');
        if (statElement && cardFilters[statElement.id]) {
            card.classList.add('clickable');
            card.addEventListener('click', () => {
                activeFilter = cardFilters[statElement.id];
                document.querySelectorAll('.card.clickable').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                renderTablePage(1);
            });
        }
    });
    document.querySelector('#card-total').closest('.card').classList.add('active');
  }

  /**
   * ✨ Adds a click listener to the table body to handle all "Details" button clicks.
   */
  function setupDetailsButtonListener() {
    document.getElementById("vehicle-table-body").addEventListener('click', (event) => {
      const button = event.target.closest('.btn-action');
      if (button) {
        const deviceId = button.dataset.id;
        window.location.href = `details.html?id=${deviceId}`;
      }
    });
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
    let baseList = [...allDevices];

    // 1. Apply active card filter
    if (activeFilter !== 'all') {
      const statusMap = new Map(fullStatusData.map(s => [s.device.id, s]));
      const communicatingDeviceIds = new Set(
        fullStatusData.filter(s => s.isDeviceCommunicating).map(s => s.device.id)
      );

      if (activeFilter === 'communicating') {
        baseList = allDevices.filter(d => communicatingDeviceIds.has(d.id));
      } else if (activeFilter === 'driving') {
        baseList = allDevices.filter(d => statusMap.get(d.id)?.isDriving);
      } else if (activeFilter === 'lessUtilized') {
        baseList = allDevices.filter(d => 
          communicatingDeviceIds.has(d.id) && (dailyTripData.get(d.id) || 0) < 10
        );
      }
    }

    // 2. Apply search term filter
    let filtered = [...baseList];
    if (currentSearchTerm) {
      const lowercasedTerm = currentSearchTerm.toLowerCase();
      filtered = baseList.filter(d =>
        (d.name || "").toLowerCase().includes(lowercasedTerm) ||
        (d.vehicleIdentificationNumber || "").toLowerCase().includes(lowercasedTerm) ||
        (d.serialNumber || "").toLowerCase().includes(lowercasedTerm)
      );
    }

    // 3. Sort the results
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
