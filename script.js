document.addEventListener("DOMContentLoaded", () => {
  // 📝 Register button → Geotab registration page
  document.querySelector(".btn-secondary").addEventListener("click", () => {
    window.open("https://my.geotab.com/registration.html", "_blank");
  });

  // 🔐 Login form submission
  document.querySelector(".login-form").addEventListener("submit", function (e) {
    e.preventDefault();

    // 🧾 Get form values
    const username = document.getElementById("username").value.trim();
    const database = document.getElementById("database").value.trim();
    const password = document.getElementById("password").value;

    // ❗ Validate fields
    if (!username || !database || !password) {
      showToast("Please fill in all fields.", "error");
      return;
    }

    // 📦 Prepare API request
    const headers = new Headers({ "Content-Type": "application/json" });
    const payload = JSON.stringify({
      method: "Authenticate",
      params: { database, userName: username, password }
    });

    showLoader();

    // 🚀 Send request to Geotab API
    fetch("https://my.geotab.com/apiv1", {
      method: "POST",
      headers,
      body: payload,
      redirect: "follow"
    })
      .then((response) => {
        if (!response.ok) {
          if (response.status === 429) throw new Error("Rate limit exceeded.");
          throw new Error("Network error. Please try again.");
        }
        return response.json();
      })
      .then((result) => {
        hideLoader();

        // ✅ Success
        if (result && result.result && result.result.credentials) {
          sessionStorage.setItem("sessionId", result.result.credentials.sessionId);
          sessionStorage.setItem("userName", result.result.credentials.userName);
          sessionStorage.setItem("database", result.result.credentials.database);

          showToast("Login successful!", "success");

          setTimeout(() => {
            window.location.href = "dashboard.html";
          }, 1500);
        } else {
          showToast("Login failed. Please check your credentials.", "error");
        }
      })
      .catch((err) => {
        hideLoader();
        console.error("Login error:", err);
        showToast(err.message || "Unexpected error occurred.", "error");
      });
  });
});
