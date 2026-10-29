import csv
import json
import os
import re
import sys
import time
from datetime import datetime
from playwright.sync_api import sync_playwright

CSV_PATH = os.path.join(os.path.dirname(__file__), "zomato_customer_orders.csv")
JSON_PATH = os.path.join(os.path.dirname(__file__), "zomato_customer_orders.json")
CDP_URL = "http://localhost:9222"
CHECK_INTERVAL_SECONDS = 15

CSV_HEADERS = [
    "Order ID",
    "Customer Name",
    "Phone Number",
    "Customer Visits",
    "Location",
    "Placed Time",
    "Items",
    "Total Bill",
    "Payment",
    "Status",
    "Delivery Partner",
    "Recorded At"
]

def load_recorded_orders():
    """Load existing order IDs and phone numbers to prevent duplicates."""
    recorded = {}
    if os.path.exists(CSV_PATH):
        try:
            with open(CSV_PATH, mode="r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    oid = row.get("Order ID", "").strip()
                    phone = row.get("Phone Number", "").strip()
                    if oid:
                        recorded[oid] = phone
        except Exception as e:
            print(f"[!] Warning reading CSV: {e}", flush=True)
    return recorded

def append_to_csv(order_data):
    """Append a newly captured order to the CSV file."""
    file_exists = os.path.exists(CSV_PATH)
    with open(CSV_PATH, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS, quoting=csv.QUOTE_ALL)
        if not file_exists:
            writer.writeheader()
        writer.writerow(order_data)

def save_or_update_csv(order_data):
    """Save a new order or update existing order row in the CSV file without duplicating entries."""
    if not os.path.exists(CSV_PATH):
        append_to_csv(order_data)
        return

    rows = []
    updated = False
    try:
        with open(CSV_PATH, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if str(row.get("Order ID", "")).strip() == str(order_data.get("Order ID", "")).strip():
                    rows.append(order_data)
                    updated = True
                else:
                    rows.append(row)
    except Exception:
        pass

    if not updated:
        rows.append(order_data)

    with open(CSV_PATH, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)

def sync_to_json(order_data):
    """Sync orders to JSON format for easy programmatic access."""
    orders = []
    if os.path.exists(JSON_PATH):
        try:
            with open(JSON_PATH, "r", encoding="utf-8") as f:
                orders = json.load(f)
        except Exception:
            orders = []

    existing_idx = next((i for i, o in enumerate(orders) if str(o.get("order_id")) == str(order_data["Order ID"])), None)
    
    bill_str = str(order_data.get("Total Bill", ""))
    bill_digits = re.findall(r"[\d.]+", bill_str)
    try:
        price_num = float(bill_digits[0]) if bill_digits else 0.0
    except Exception:
        price_num = 0.0

    entry = {
        "order_id": order_data["Order ID"],
        "customer_name": order_data["Customer Name"],
        "customer_phone": order_data["Phone Number"],
        "order_count": order_data["Customer Visits"],
        "location": order_data["Location"],
        "placed_time": order_data["Placed Time"],
        "items_summary": order_data["Items"],
        "total_bill": order_data["Total Bill"],
        "price_num": price_num,
        "payment_status": order_data["Payment"],
        "order_status": order_data["Status"],
        "delivery_partner": order_data["Delivery Partner"],
        "recorded_at": order_data["Recorded At"]
    }

    if existing_idx is not None:
        orders[existing_idx] = entry
    else:
        orders.append(entry)

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(orders, f, indent=2, ensure_ascii=False)

def find_zomato_page(context):
    """Find the active Zomato Partner tab."""
    for page in context.pages:
        if "zomato.com" in page.url and ("orders" in page.url or "onlineordering" in page.url):
            return page
    return None

def extract_phone_with_click(card, page):
    """
    Checks for visible phone number.
    If hidden, clicks the 'Call' button / phone icon to reveal it.
    """
    try:
        # 1. Check if phone number is already visible (+91...)
        card_text = card.inner_text()
        phone_match = re.search(r"(\+91\d{8,12})", card_text)
        if phone_match:
            return phone_match.group(1)

        # 2. Click Call element
        call_btn = card.locator("xpath=.//div[contains(., 'Call') and .//img[@alt='call']] | .//img[@alt='call']/ancestor::div[1] | .//div[text()='Call'] | .//span[text()='Call']").first
        if call_btn.count() > 0 and call_btn.is_visible():
            call_btn.click(timeout=1500)
            page.wait_for_timeout(600)

            # Re-read card text for newly revealed number
            card_text_after = card.inner_text()
            phone_match = re.search(r"(\+91\d{8,12})", card_text_after)
            if phone_match:
                page.keyboard.press("Escape")
                return phone_match.group(1)

            # Check if a popup modal opened with number
            modal = page.locator("div[role='dialog'], [class*='modal'], [class*='popup']").first
            if modal.count() > 0 and modal.is_visible():
                modal_phone = re.search(r"(\+91\d{8,12})", modal.inner_text())
                page.keyboard.press("Escape")
                if modal_phone:
                    return modal_phone.group(1)

            page.keyboard.press("Escape")

    except Exception:
        pass
    
    return "Missed (auto-masked after pickup)"

def parse_card(card, page, default_status="Ready"):
    """Extract all order details from a single Zomato order card."""
    text = card.inner_text()
    
    # 1. Order ID
    id_match = re.search(r"(?:ID:\s*|#\s*)(\d{3,6})", text)
    if not id_match:
        id_match = re.search(r"\b(\d{4})\b", text)
    if not id_match:
        return None
    order_id = id_match.group(1)

    # 2. Customer Name (prioritize dedicated name element)
    customer_name = ""
    try:
        name_elem = card.locator("div[cursor='pointer'][color='#256FEF'], .css-1g27dnw, span.fptpIP").first
        if name_elem.count() > 0:
            candidate = name_elem.inner_text().strip()
            if candidate and candidate not in ["ORDER", "KOT", "ZOMATO"]:
                customer_name = candidate
    except Exception:
        pass

    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not customer_name:
        for line in lines:
            if line.endswith(">") or "order" in line.lower():
                candidate = line.replace(">", "").strip()
                if candidate and not any(kw in candidate.lower() for kw in ["placed", "id", "order", "bill", "total"]):
                    customer_name = candidate
                    break

    if not customer_name:
        customer_name = "Customer"

    # 3. Customer Visits
    visit_match = re.search(r"(\d+(?:st|nd|rd|th)\s+order|Customer\s+Order)", text, re.IGNORECASE)
    customer_visits = visit_match.group(1) if visit_match else "Customer Order"

    # 4. Phone Number
    phone_number = extract_phone_with_click(card, page)

    # 5. Location & Distance
    location = "Ramanagara"
    for line in lines:
        if "away)" in line or "kms" in line or "km" in line:
            location = line
            break

    # 6. Placed Time
    placed_time = datetime.now().strftime("%I:%M %p")
    placed_match = re.search(r"Placed:\s*([^\n]+)", text)
    if placed_match:
        placed_time = placed_match.group(1).strip()

    # 7. Items
    items_list = []
    instruction = ""
    for line in lines:
        if re.search(r"^\d+\s*x\s*", line):
            items_list.append(line)
        if any(w in line.lower() for w in ["extra", "spicy", "masala", "instruction"]):
            if not line.startswith("Placed") and "bill" not in line.lower():
                instruction = f" ({line})"

    items_str = ", ".join(items_list) + instruction if items_list else "—"

    # 8. Total Bill
    bill_match = re.search(r"₹\s*([\d,]+(?:\.\d{2})?)", text)
    total_bill = f"₹{bill_match.group(1)}" if bill_match else "—"

    # 9. Payment Status
    payment = "PAID" if "PAID" in text.upper() else "COD"

    # 10. Order Status
    status = default_status
    if "PICKED UP" in text.upper():
        status = "Picked up"
    elif "READY" in text.upper():
        status = "Ready"
    elif "PREPARING" in text.upper():
        status = "Preparing"

    # 11. Delivery Partner
    rider_info = "Assigning rider"
    rider_match = re.search(r"([A-Za-z\s]+)\s+is on the way", text)
    otp_match = re.search(r"OTP:\s*(\d{4})", text)
    
    if rider_match:
        rider_name = rider_match.group(1).strip()
        otp = f" (OTP: {otp_match.group(1)})" if otp_match else ""
        rider_info = f"{rider_name}{otp}"
    elif "3 riders nearby" in text or "assigning one soon" in text:
        rider_info = "3 riders nearby, assigning one soon"
    elif "picked up" in text.lower():
        rider_info = "Rider picked up"

    return {
        "Order ID": order_id,
        "Customer Name": customer_name,
        "Phone Number": phone_number,
        "Customer Visits": customer_visits,
        "Location": location,
        "Placed Time": placed_time,
        "Items": items_str,
        "Total Bill": total_bill,
        "Payment": payment,
        "Status": status,
        "Delivery Partner": rider_info,
        "Recorded At": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def scan_current_view(page, recorded_orders):
    """Find all order cards using exact ID elements and record new orders."""
    id_elements = page.locator("text=/ID:\\s*\\d{3,6}/").all()
    new_count = 0

    for id_elem in id_elements:
        try:
            # Locate parent card
            card = id_elem.locator("xpath=ancestor::div[contains(., 'Total Bill')][1]")
            if card.count() == 0:
                card = id_elem.locator("xpath=ancestor::div[contains(., 'ZOMATO')][1]")
            
            if not card.is_visible():
                continue

            data = parse_card(card, page)
            if not data or not data.get("Order ID"):
                continue

            oid = data["Order ID"]
            existing_phone = recorded_orders.get(oid)

            is_new = oid not in recorded_orders
            phone_now_found = existing_phone in [None, "", "Missed (auto-masked after pickup)"] and data["Phone Number"].startswith("+91")

            if is_new or phone_now_found:
                save_or_update_csv(data)
                sync_to_json(data)
                recorded_orders[oid] = data["Phone Number"]
                new_count += 1
                print(f"[+] [{datetime.now().strftime('%H:%M:%S')}] RECORDED Order #{oid} | {data['Customer Name']} | Phone: {data['Phone Number']} | {data['Total Bill']}", flush=True)

        except Exception as e:
            continue

    return new_count

def main():
    print("=" * 65, flush=True)
    print(" ZOMATO RESTAURANT ORDER AUTONOMOUS RECORDER", flush=True)
    print(f" Connecting to Chrome via CDP ({CDP_URL})...", flush=True)
    print("=" * 65, flush=True)

    recorded_orders = load_recorded_orders()
    print(f"[*] Loaded {len(recorded_orders)} previously recorded orders from CSV.", flush=True)

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            print("\n[X] Could not connect to Google Chrome!", flush=True)
            print("    Please launch Chrome with the provided shortcut or run:", flush=True)
            print('    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\\Google\\Chrome\\AutomationProfile"', flush=True)
            print(f"    Error details: {e}\n", flush=True)
            sys.exit(1)

        context = browser.contexts[0]
        print("[+] Successfully connected to Chrome browser.", flush=True)

        while True:
            try:
                page = find_zomato_page(context)
                if not page:
                    print(f"[-] Waiting for Zomato Orders tab to be opened in Chrome... (retrying in {CHECK_INTERVAL_SECONDS}s)", flush=True)
                    time.sleep(CHECK_INTERVAL_SECONDS)
                    continue

                total_new = 0

                # Check if other tabs have orders (e.g., Ready(1), Picked up(1))
                tabs = ["Ready", "Picked up"]
                for tab_name in tabs:
                    try:
                        tab_elem = page.locator(f"div[cursor='pointer']:has-text('{tab_name}')").first
                        if tab_elem.count() > 0:
                            t_text = tab_elem.inner_text().strip()
                            count_match = re.search(r"\((\d+)\)", t_text)
                            if count_match and int(count_match.group(1)) > 0:
                                tab_elem.click(timeout=1000)
                                page.wait_for_timeout(500)
                                total_new += scan_current_view(page, recorded_orders)
                    except Exception:
                        pass

                # Scan current view / Preparing
                try:
                    prep_tab = page.locator("div[cursor='pointer']:has-text('Preparing')").first
                    if prep_tab.count() > 0:
                        prep_tab.click(timeout=1000)
                        page.wait_for_timeout(400)
                except Exception:
                    pass

                total_new += scan_current_view(page, recorded_orders)

                if total_new == 0:
                    print(f"[*] [{datetime.now().strftime('%H:%M:%S')}] Monitoring Zomato orders... (0 unrecorded orders)", flush=True)

            except Exception as loop_err:
                print(f"\n[!] Loop error: {loop_err}", flush=True)

            time.sleep(CHECK_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
