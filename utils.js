// 📦 /utils.js (New File)

/**
 * 📢 Shows a toast notification.
 * @param {string} message The message to display.
 * @param {string} [type="error"] The type of toast ("error" or "success").
 * @param {number} [duration=3000] The duration in milliseconds.
 */
const showToast = (message, type = "error", duration = 3000) => {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 400);
  }, duration);
};

/**
 * ⏳ Shows the loader overlay.
 */
const showLoader = () => {
  const loader = document.getElementById("loader-overlay");
  if (loader) loader.classList.remove("hidden");
};

/**
 * 🙈 Hides the loader overlay.
 */
const hideLoader = () => {
  const loader = document.getElementById("loader-overlay");
  if (loader) loader.classList.add("hidden");
};
