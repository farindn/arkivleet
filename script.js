// Define global variables for session handling and pagination
let currentPage = 1;
const rowsPerPage = 10;
let vehiclesData = []; // To store fetched vehicle data

// Wait for the DOM to be fully loaded before attaching event listeners
document.addEventListener("DOMContentLoaded", function () {
  const loginBtn = document.getElementById("loginBtn");

  if (loginBtn) {
    loginBtn.addEventListener("click", handleLogin);
  }

  if (window.location.pathname.endsWith("home.html")) {
    const sessionId = localStorage.getItem("sessionId");
    const database = localStorage.getItem("database");
    const username = localStorage.getItem("username");

    // Fetch total, online, and offline vehicles if credentials are available
    if (sessionId && database && username) {
      fetchTotalVehicles(sessionId, database, username);
      fetchOnlineVehicles(sessionId, database, username);
      fetchOfflineVehicles(sessionId, database, username);
      fetchVehicleList(sessionId, database, username);
    } else {
      console.error("Missing credentials. Please log in again.");
    }
  }
});

// Handle user login
function handleLogin() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const database = document.getElementById("database").value;

  // Check if any of the fields are empty
  if (!username || !password || !database) {
    showNotification("All fields are required.", "blue");
    return; // Stop the function execution if fields are empty
  }

  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    method: "Authenticate",
    params: {
      database: database,
      userName: username,
      password: password,
    },
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };

  fetch("https://my.geotab.com/apiv1", requestOptions)
    .then((response) => response.json())
    .then((result) => handleLoginResponse(result, username, database))
    .catch((error) => {
      console.error(error);
      showNotification("Failed. Please try again.", "red");
    });
}

// Handle the response from the login API
function handleLoginResponse(result, username, database) {
  const sessionId = result?.["result"]?.["credentials"]?.["sessionId"];
  if (sessionId) {
    // Store sessionId, database, and username in localStorage
    localStorage.setItem("sessionId", sessionId);
    localStorage.setItem("database", database);
    localStorage.setItem("username", username);

    showNotification("Success. Session ID: " + sessionId, "green");
    // Redirect to homepage after a delay to show the notification
    setTimeout(() => {
      window.location.href = "home.html"; // Redirect to home page
    }, 2000); // 2 seconds delay
  } else {
    showNotification("Failed. Please check your credentials.", "red");
  }
}

// Show notification messages
function showNotification(message, type) {
  const notification = document.getElementById("notification");
  const notificationText = document.getElementById("notificationText");

  notificationText.textContent = message;
  notification.className = "notification " + type; // Apply the green or red class
  notification.style.display = "block";

  document.getElementById("closeBtn").onclick = function () {
    notification.style.display = "none";
  };
}

// Fetch total vehicles on home page load
function fetchTotalVehicles(sessionId, database, username) {
  fetchVehicleCount(
    sessionId,
    database,
    username,
    "GetCountOf",
    {
      typeName: "Device",
      search: {
        excludeUntrackedAssets: true,
        fromDate: new Date().toISOString(),
      },
    },
    "totalVehicles"
  );
}

// Fetch online vehicles on home page load
function fetchOnlineVehicles(sessionId, database, username) {
  fetchVehicleCount(
    sessionId,
    database,
    username,
    "GetCountOf",
    {
      typeName: "Device",
      search: {
        excludeUntrackedAssets: true,
        fromDate: new Date().toISOString(),
        isCommunicating: true, // Fetch online vehicles
      },
    },
    "onlineVehicles"
  );
}

// Fetch offline vehicles on home page load
function fetchOfflineVehicles(sessionId, database, username) {
  fetchVehicleCount(
    sessionId,
    database,
    username,
    "GetCountOf",
    {
      typeName: "Device",
      search: {
        excludeUntrackedAssets: true,
        fromDate: new Date().toISOString(),
        isCommunicating: false, // Fetch offline vehicles
      },
    },
    "offlineVehicles"
  );
}

// Generic function to fetch vehicle counts
function fetchVehicleCount(
  sessionId,
  database,
  username,
  method,
  params,
  elementId
) {
  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    method: method,
    params: {
      ...params,
      credentials: {
        database: database,
        sessionId: sessionId,
        userName: username,
      },
    },
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };

  fetch("https://my.geotab.com/apiv1", requestOptions)
    .then((response) => response.json())
    .then((result) => {
      const count = result?.["result"];
      if (count) {
        document.getElementById(elementId).textContent = count; // Update the widget
      } else {
        console.error(`Failed to fetch ${elementId}.`);
      }
    })
    .catch((error) => console.error(error));
}

// Function to fetch and display vehicle list
function fetchVehicleList(sessionId, database, username) {
  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    method: "Get",
    params: {
      typeName: "Device",
      search: {
        excludeUntrackedAssets: true,
        fromDate: new Date().toISOString(),
        isCommunicating: true,
      },
      credentials: {
        database: database,
        sessionId: sessionId,
        userName: username,
      },
    },
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };

  fetch("https://my.geotab.com/apiv1", requestOptions)
    .then((response) => response.json())
    .then((result) => {
      vehiclesData = result?.["result"] || []; // Store all vehicles data
      if (vehiclesData.length > 0) {
        displayPage(currentPage); // Display the first page
        updatePaginationControls(); // Update pagination buttons
      } else {
        console.error("No vehicles found.");
      }
    })
    .catch((error) => console.error("Error fetching vehicles: ", error));
}

// Display a specific page of vehicle data
function displayPage(page) {
  const tableBody = document.querySelector("table tbody");
  tableBody.innerHTML = ""; // Clear the table

  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, vehiclesData.length);

  for (let i = startIndex; i < endIndex; i++) {
    const vehicle = vehiclesData[i];
    const row = document.createElement("tr");

    const vehicleName = vehicle?.name || "Unknown";
    const serialNumber = vehicle?.serialNumber || "N/A";
    const deviceId = vehicle?.id || "N/A";

    row.innerHTML = `
            <td>${vehicleName}</td>
            <td>${serialNumber}</td>
            <td>${deviceId}</td>
            <td><button class="action-btn" onclick="viewDetails('${deviceId}')">View</button></td>
        `;

    tableBody.appendChild(row);
  }
}

// Update pagination controls (next/previous buttons)
function updatePaginationControls() {
  const pagination = document.querySelector(".pagination-controls");
  pagination.innerHTML = ""; // Clear existing controls

  const totalPages = Math.ceil(vehiclesData.length / rowsPerPage);

  // Previous button
  const prevButton = document.createElement("button");
  prevButton.innerText = "Previous";
  prevButton.disabled = currentPage === 1;
  prevButton.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      displayPage(currentPage);
      updatePaginationControls();
    }
  });
  pagination.appendChild(prevButton);

  // Next button
  const nextButton = document.createElement("button");
  nextButton.innerText = "Next";
  nextButton.disabled = currentPage === totalPages;
  nextButton.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      displayPage(currentPage);
      updatePaginationControls();
    }
  });
  pagination.appendChild(nextButton);
}

// Fetch device status information based on deviceId
async function viewDetails(deviceId) {
  const sessionId = localStorage.getItem("sessionId");
  const database = localStorage.getItem("database");
  const username = localStorage.getItem("username");

  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    method: "Get",
    params: {
      typeName: "DeviceStatusInfo",
      search: {
        deviceSearch: {
          id: deviceId,
        },
      },
      credentials: {
        database: database,
        sessionId: sessionId,
        userName: username,
      },
    },
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };

  fetch("https://my.geotab.com/apiv1", requestOptions)
    .then((response) => response.json())
    .then((result) => {
      const statusInfo = result?.["result"];
      if (statusInfo) {
        // Populate the modal with data
        document.getElementById("statusInfoContent").textContent =
          JSON.stringify(statusInfo, null, 2);
        // Show the modal
        document.getElementById("statusModal").style.display = "block";
      } else {
        alert("Device status information not found.");
      }
    })
    .catch((error) => console.error("Failed to fetch device status:", error));
}

// Function to close the modal
function closeModal() {
  document.getElementById("statusModal").style.display = "none";
}
