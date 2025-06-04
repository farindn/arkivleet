document.addEventListener("DOMContentLoaded", async () => {
  // 📢 Toast utility
  const showToast = (message, type = "error", duration = 3000) => {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    toast.classList.remove("hidden");

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 400);
    }, duration);
  };

  // ⏳ Loader utilities
  const showLoader = () => document.getElementById("loader-overlay").classList.remove("hidden");
  const hideLoader = () => document.getElementById("loader-overlay").classList.add("hidden");

  // 🔐 Session validation
  const sessionId = sessionStorage.getItem("sessionId");
  const userName = sessionStorage.getItem("userName");
  const database = sessionStorage.getItem("database");

  if (!sessionId || !userName || !database) {
    showToast("Session expired. Please log in again.", "error");
    setTimeout(() => window.location.replace("index.html"), 2000);
    return;
  }

  // 👤 Populate user info
  document.getElementById("user-email").textContent = userName;
  document.getElementById("user-db").textContent = database;
  document.getElementById("dashboardContent").classList.remove("hidden");

  // 🔽 Dropdown toggle
  const userArea = document.getElementById("userArea");
  const dropdown = document.getElementById("dropdownMenu");
  userArea.addEventListener("click", () => dropdown.classList.toggle("hidden"));
  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.clear();
    window.location.href = "index.html";
  });

  // 🚀 Fetch & render data
  showLoader();
  try {
    const fullDeviceData = await getMergedDeviceData(sessionId, database, userName);
    updateSummaryCards(fullDeviceData);
    setupTable(fullDeviceData);
  } catch (err) {
    console.error("Error loading dashboard:", err);
    showToast("Failed to load dashboard. Please try again.", "error");
  } finally {
    hideLoader();
  }
});

// 🌐 Geotab API POST wrapper
async function fetchFromGeotab(method, params, credentials) {
  const raw = JSON.stringify({
    method,
    params: { ...params, credentials }
  });

  const response = await fetch("https://my.geotab.com/apiv1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw
  });

  const json = await response.json();
  return json.result || [];
}

// 🔄 Merge Devices + DeviceStatusInfo
async function getMergedDeviceData(sessionId, database, userName) {
  const credentials = { sessionId, database, userName };

  const devices = await fetchFromGeotab("Get", { typeName: "Device" }, credentials);
  const statusList = await fetchFromGeotab("Get", {
    typeName: "DeviceStatusInfo",
    search: { diagnostics: [{ id: "DiagnosticIgnitionId" }] }
  }, credentials);

  const deviceMap = Object.fromEntries(devices.map(dev => [dev.id, dev]));

  return statusList.map(status => {
    const device = deviceMap[status.device.id] || {};
    const ignitionStatus = status.statusData?.[0];

    const isIgnitionOn = (() => {
      if (!ignitionStatus || ignitionStatus.data !== 1) return false;
      const now = new Date();
      const readingTime = new Date(ignitionStatus.dateTime);
      return (now - readingTime) <= 2 * 60 * 1000;
    })();

    return {
      name: device.name || "Unknown",
      vin: device.vehicleIdentificationNumber || "-",
      serial: device.serialNumber || "-",
      timeZone: device.timeZoneId || "-",
      ratePlan: device.devicePlanBillingInfo?.[0]?.devicePlanName || "-",
      id: device.id,
      isDeviceCommunicating: status.isDeviceCommunicating,
      isDriving: status.isDriving,
      ignitionOn: isIgnitionOn
    };
  });
}

// 📊 Update summary cards
function updateSummaryCards(data) {
  document.getElementById("card-total").textContent = data.length;
  document.getElementById("card-comm").textContent = data.filter(d => d.isDeviceCommunicating).length;
  document.getElementById("card-driving").textContent = data.filter(d => d.isDriving).length;
  document.getElementById("card-ignition").textContent = data.filter(d => d.ignitionOn).length;
}

// 📋 Table rendering with pagination, search, sorting
function setupTable(data) {
  const tableBody = document.getElementById("vehicle-table-body");
  const searchInput = document.getElementById("searchInput");
  const prevPageBtn = document.getElementById("prevPage");
  const nextPageBtn = document.getElementById("nextPage");
  const headers = document.querySelectorAll("th.sortable");

  let currentPage = 1;
  const rowsPerPage = 10;
  let filteredData = [...data];
  let sortConfig = { column: null, direction: "asc" };

  function renderTable(page = 1) {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageData = filteredData.slice(start, end);

    tableBody.innerHTML = "";
    pageData.forEach(vehicle => {
      const row = document.createElement("tr");
      row.classList.add("fade-in");
      row.innerHTML = `
        <td>${vehicle.name}</td>
        <td><code class="code-block">${vehicle.vin}</code></td>
        <td><code class="code-block">${vehicle.serial}</code></td>
        <td>${vehicle.timeZone}</td>
        <td>${vehicle.ratePlan}</td>
      `;
      tableBody.appendChild(row);
    });

    prevPageBtn.disabled = page === 1;
    nextPageBtn.disabled = end >= filteredData.length;
  }

  function filterData(keyword) {
    const lower = keyword.toLowerCase();
    filteredData = data.filter(d =>
      d.name.toLowerCase().includes(lower) ||
      d.vin.toLowerCase().includes(lower) ||
      d.serial.toLowerCase().includes(lower) ||
      d.timeZone.toLowerCase().includes(lower) ||
      d.ratePlan.toLowerCase().includes(lower)
    );
    sortData();
    currentPage = 1;
    renderTable();
  }

  function sortData() {
    if (!sortConfig.column) return;
    filteredData.sort((a, b) => {
      const valA = a[sortConfig.column]?.toLowerCase?.() || a[sortConfig.column];
      const valB = b[sortConfig.column]?.toLowerCase?.() || b[sortConfig.column];
      if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
      if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }

  headers.forEach(header => {
    header.addEventListener("click", () => {
      const col = header.dataset.column;
      if (sortConfig.column === col) {
        sortConfig.direction = sortConfig.direction === "asc" ? "desc" : "asc";
      } else {
        sortConfig.column = col;
        sortConfig.direction = "asc";
      }

      headers.forEach(h => h.querySelector(".sort-icon").textContent = "");
      header.querySelector(".sort-icon").textContent = sortConfig.direction === "asc" ? "▲" : "▼";

      sortData();
      renderTable(1);
    });
  });

  searchInput.addEventListener("input", (e) => filterData(e.target.value));
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable(currentPage);
    }
  });

  nextPageBtn.addEventListener("click", () => {
    if ((currentPage * rowsPerPage) < filteredData.length) {
      currentPage++;
      renderTable(currentPage);
    }
  });

  renderTable();
}
