# Zomato Autonomous Order & Phone Number Recorder

This setup connects directly to your Google Chrome browser via the Chrome DevTools Protocol (CDP). It monitors your Zomato Merchant Dashboard every 15 seconds, automatically unmasks phone numbers by triggering the Call action before rider pickup, and records every order into `zomato_customer_orders.csv` and `zomato_customer_orders.json`.

---

## Files in this Folder

1. **`launch_chrome.bat`**:
   - Launches Google Chrome with debugging enabled on port `9222`.
   - Uses a dedicated profile (`AutomationProfile`), so your personal tabs are never disturbed.
   - **You only log in to Zomato ONCE.** The login session and OTP stay saved permanently.

2. **`run_tracker.bat`**:
   - Starts `tracker.py` in the background.
   - Checks every 15 seconds for new orders in *Preparing*, *Ready*, or *Picked up*.
   - Automatically clicks the "Call" button to fetch masked phone numbers before the order leaves the kitchen.
   - Automatically dismisses popups so your staff screen stays clean.

3. **`zomato_customer_orders.csv`**:
   - The primary spreadsheet containing all recorded orders and customer details.

4. **`zomato_customer_orders.json`**:
   - Clean JSON database of all recorded orders.

---

## How to Use

### Step 1: Open Chrome via `launch_chrome.bat`
- Double-click `launch_chrome.bat`.
- Chrome will open to the Zomato Partners Orders page.
- Log in to your Zomato restaurant account (enter your mobile number & OTP once).
- Keep this tab open as usual.

### Step 2: Start the Recorder via `run_tracker.bat`
- Double-click `run_tracker.bat`.
- The black terminal window will say:
  ```text
  [+] Successfully connected to Chrome browser.
  [*] Loaded X previously recorded orders from CSV.
  ```
- Leave this window minimized in the background. It will automatically log all incoming orders into `zomato_customer_orders.csv`.
