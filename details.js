document.addEventListener("DOMContentLoaded", () => {
  // --- STATE MANAGEMENT ---
  const credentials = {
    sessionId: sessionStorage.getItem("sessionId"),
    userName: sessionStorage.getItem("userName"),
    database: sessionStorage.getItem("database"),
  };
  let userTimeZoneId = "UTC";
  let map = null; // To hold the map instance

  // --- INITIALIZATION ---
  initializeDetailsPage();

  /**
   * 🚀 Main function to initialize the details page.
   */
  async function initializeDetailsPage() {
    if (!credentials.sessionId) {
      showToast("Session expired. Please log in again.", "error");
      setTimeout(() => (window.location.href = "index.html"), 2000);
      return;
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const deviceId = urlParams.get('id');
    if (!deviceId) {
      showToast("No vehicle selected.", "error");
      setTimeout(() => (window.location.href = "dashboard.html"), 2000);
      return;
    }
    
    setupNavbar();
    showLoader();

    try {
      // 1. Fetch user's timezone first for date formatting
      const userResult = await fetchFromGeotab("Get", {
        typeName: "User",
        search: { name: credentials.userName },
      }, credentials);
      if (userResult[0]?.timeZoneId) {
        userTimeZoneId = userResult[0].timeZoneId;
      }
      document.getElementById("user-timezone").textContent = userTimeZoneId;

      // 2. Fetch all data for the selected device
      const [device, statusInfo] = await Promise.all([
        fetchFromGeotab("Get", { typeName: "Device", search: { id: deviceId } }, credentials),
        fetchFromGeotab("Get", { typeName: "DeviceStatusInfo", search: { deviceSearch: { id: deviceId } } }, credentials)
      ]);

      const deviceData = device[0];
      const statusData = statusInfo[0];

      if (!deviceData || !statusData) {
        throw new Error("Could not retrieve vehicle data.");
      }

      // 3. Fetch reverse geocoded address
      const address = await getAddress(statusData.latitude, statusData.longitude);

      // 4. Populate the page with all the data
      populateDetails(deviceData, statusData, address);

    } catch (err) {
      console.error("Error loading details page:", err);
      showToast(err.message || "Failed to load vehicle details.", "error");
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
   * 🗺️ Reverse geocodes coordinates to get a formatted address.
   */
  async function getAddress(lat, lon) {
    if (lat === 0 && lon === 0) return "No location data";
    try {
      const addresses = await fetchFromGeotab("GetAddresses", {
        coordinates: [{ x: lon, y: lat }]
      }, credentials);
      return addresses[0]?.formattedAddress || "Address not found";
    } catch (err) {
      console.error("Reverse geocoding failed:", err);
      return "Could not retrieve address";
    }
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
   * 📝 Fills the page with the fetched vehicle data.
   */
  function populateDetails(device, status, address) {
    const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
        timeZone: userTimeZoneId,
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
    
    // Title and Subtitle
    document.getElementById('vehicle-name-title').textContent = device.name || 'Vehicle Details';
    const isCommunicating = status.isDeviceCommunicating;
    const updateIcon = isCommunicating ? 'wifi' : 'wifi_off';
    const updateColorClass = isCommunicating ? 'update-fresh' : 'update-stale';
    const formattedDateTime = status.dateTime ? dateTimeFormatter.format(new Date(status.dateTime)) : 'N/A';
    const lastCommElement = document.getElementById('detail-page-last-comm');
    lastCommElement.innerHTML = `
      <span class="material-symbols-rounded ${updateColorClass}">${updateIcon}</span>
      <span>Last communicated: </span>
      <span class="${updateColorClass}">${formattedDateTime}</span>
    `;
    
    // Asset Information Card
    document.getElementById('detail-driver').textContent = status.driver?.name || 'No driver assigned';
    document.getElementById('detail-vin').textContent = device.vehicleIdentificationNumber || '-';
    document.getElementById('detail-plate').textContent = device.licensePlate || '-';
    document.getElementById('detail-serial').textContent = device.serialNumber || '-';
    document.getElementById('detail-device-tz').textContent = device.timeZoneId || '-';
    document.getElementById('detail-device-type').textContent = device.deviceType || '-';
    document.getElementById('detail-rate-plan').textContent = device.devicePlanBillingInfo?.[0]?.devicePlanName || '-';

    // Current Status Card
    const trackingColor = device.isActiveTrackingEnabled ? 'update-fresh' : 'update-stale';
    const drivingColor = status.isDriving ? 'update-fresh' : 'update-stale';
    document.getElementById('detail-active-tracking').innerHTML = `<code class="code-block ${trackingColor}">${device.isActiveTrackingEnabled ? 'Yes' : 'No'}</code>`;
    document.getElementById('detail-address').textContent = address;
    document.getElementById('detail-coords').textContent = `${status.latitude.toFixed(5)}, ${status.longitude.toFixed(5)}`;
    document.getElementById('detail-driving').innerHTML = `<code class="code-block ${drivingColor}">${status.isDriving ? 'Yes' : 'No'}</code>`;
    document.getElementById('detail-speed').textContent = `${status.speed.toFixed(0)} km/h`;

    // Initialize map
    if (status.latitude !== 0 && status.longitude !== 0) {
      initMap(status.latitude, status.longitude, device.name);
    }
  }
  
  /**
   * 🗺️ Initializes the Leaflet map.
   */
  function initMap(lat, lon, deviceName) {
    if (map) map.remove(); // Remove previous map instance if it exists
    map = L.map('map').setView([lat, lon], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    L.marker([lat, lon]).addTo(map)
        .bindPopup(deviceName)
        .openPopup();
  }
});
