import os
import re
import sys
import time
import argparse
import xml.etree.ElementTree as ET

# Ensure selenium is imported successfully, otherwise prompt installation
try:
    from selenium import webdriver
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.chrome.options import Options
except ImportError:
    print("[Info] Selenium is not installed. Installing it now...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "selenium"])
    from selenium import webdriver
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.chrome.options import Options

def parse_testdata(filepath):
    """
    Parse testdata file (supports both single and double PreGen nested formats).
    Flattens the PreGen nodes sequentially to retrieve expected (batch, index) pairs.
    """
    if not os.path.exists(filepath):
        print(f"[Error] Testdata file not found: {filepath}")
        sys.exit(1)
        
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        
        spins = []
        slot = root.find('Slot')
        if slot is not None:
            for spin_elem in slot.findall('Spin'):
                # findall('.//PreGen') extracts all PreGens inside this spin (flat sequence)
                pregens = spin_elem.findall('.//PreGen')
                for pregen in pregens:
                    batch = pregen.get('batch')
                    index = pregen.get('index')
                    if batch is not None and index is not None:
                        spins.append((int(batch), int(index)))
        return spins
    except Exception as e:
        print(f"[Error] Failed to parse XML file: {e}")
        sys.exit(1)

def trigger_spin(driver):
    """Simulate pressing the Spacebar key to trigger a spin in the game."""
    try:
        ActionChains(driver).send_keys(Keys.SPACE).perform()
        print("  [Auto-Spin] Sent Spacebar key to browser.")
    except Exception as e:
        print(f"  [Warning] Failed to send Spacebar key: {e}")

def generate_report(results, testdata_name, module_id, output_path):
    """Generate a clean, modern HTML test report with pass/fail badges and screenshots."""
    total = len(results)
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = total - passed
    overall_status = "PASS" if failed == 0 else "FAIL"
    status_color = "#10B981" if overall_status == "PASS" else "#EF4444"
    
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Verification Report - {testdata_name}</title>
    <style>
        :root {{
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --primary: #6366f1;
            --success: #10b981;
            --failure: #ef4444;
            --border: #334155;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            padding: 2rem 1rem;
            line-height: 1.5;
        }}
        .report-container {{
            max-width: 1000px;
            margin: 0 auto;
        }}
        header {{
            margin-bottom: 2rem;
            border-bottom: 1px solid var(--border);
            padding-bottom: 1.5rem;
        }}
        h1 {{ font-size: 2rem; margin-bottom: 0.5rem; }}
        .meta {{ color: var(--text-muted); font-size: 0.9rem; display: flex; gap: 1.5rem; }}
        
        /* Summary Dashboard */
        .summary-dashboard {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2.5rem;
        }}
        .card {{
            background-color: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
        }}
        .card-value {{ font-size: 2rem; font-weight: 700; margin-top: 0.5rem; }}
        .status-badge {{
            display: inline-block;
            font-weight: 800;
            padding: 0.5rem 1.5rem;
            border-radius: 20px;
            color: #fff;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-top: 0.5rem;
        }}
        
        /* Test Results Table */
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 1.5rem;
            background-color: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            overflow: hidden;
        }}
        th, td {{
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }}
        th {{ background-color: rgba(255,255,255,0.03); font-weight: 600; color: var(--text-muted); }}
        
        .badge {{
            display: inline-block;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 0.25rem 0.6rem;
            border-radius: 6px;
            text-transform: uppercase;
        }}
        .badge-pass {{ background-color: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }}
        .badge-fail {{ background-color: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }}
        
        /* Screenshot Styles */
        .screenshot-thumbnail {{
            width: 100px;
            height: 60px;
            object-fit: cover;
            border-radius: 6px;
            border: 1px solid var(--border);
            cursor: pointer;
            transition: transform 0.2s;
        }}
        .screenshot-thumbnail:hover {{
            transform: scale(1.1);
        }}
        
        /* Modal for Enlarging Images */
        .modal {{
            display: none;
            position: fixed;
            z-index: 999;
            top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.85);
            align-items: center;
            justify-content: center;
        }}
        .modal-content {{
            max-width: 90%;
            max-height: 90%;
            border-radius: 8px;
            border: 2px solid var(--border);
        }}
    </style>
</head>
<body>
    <div class="report-container">
        <header>
            <h1>Test Verification Report</h1>
            <div class="meta">
                <span><strong>File:</strong> {testdata_name}</span>
                <span><strong>Module ID:</strong> {module_id}</span>
                <span><strong>Date:</strong> {time.strftime('%Y-%m-%d %H:%M:%S')}</span>
            </div>
        </header>

        <div class="summary-dashboard">
            <div class="card">
                <div style="color: var(--text-muted);">Overall Status</div>
                <div class="status-badge" style="background-color: {status_color};">{overall_status}</div>
            </div>
            <div class="card">
                <div style="color: var(--text-muted);">Total Spins</div>
                <div class="card-value">{total}</div>
            </div>
            <div class="card">
                <div style="color: var(--text-muted); color: #34d399;">Passed</div>
                <div class="card-value" style="color: #34d399;">{passed}</div>
            </div>
            <div class="card">
                <div style="color: var(--text-muted); color: #f87171;">Failed</div>
                <div class="card-value" style="color: #f87171;">{failed}</div>
            </div>
        </div>

        <h2>Spin Validation Details</h2>
        <table>
            <thead>
                <tr>
                    <th>Spin #</th>
                    <th>Expected (Batch, Index)</th>
                    <th>Actual (Batch, Index)</th>
                    <th>Status</th>
                    <th>Screenshot</th>
                </tr>
            </thead>
            <tbody>
"""
    
    for r in results:
        badge_class = "badge-pass" if r["status"] == "PASS" else "badge-fail"
        img_src = f"screenshots/{r['screenshot']}"
        html_content += f"""
                <tr>
                    <td><strong>{r['spin_num']}</strong></td>
                    <td><code>{r['expected']}</code></td>
                    <td><code>{r['actual']}</code></td>
                    <td><span class="badge {badge_class}">{r['status']}</span></td>
                    <td>
                        <img src="{img_src}" class="screenshot-thumbnail" onclick="openModal(this.src)" alt="Screenshot">
                    </td>
                </tr>
"""
        
    html_content += """
            </tbody>
        </table>
    </div>

    <!-- Modal for enlarging screenshots -->
    <div id="imgModal" class="modal" onclick="this.style.display='none'">
        <img class="modal-content" id="modalImg">
    </div>

    <script>
        function openModal(src) {
            document.getElementById('modalImg').src = src;
            document.getElementById('imgModal').style.display = 'flex';
        }
    </script>
</body>
</html>
"""
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print(f"\n[Success] Test report successfully written to: {os.path.abspath(output_path)}")

def main():
    parser = argparse.ArgumentParser(description="Slot Machine .testdata Automated Verifier")
    parser.add_argument("-f", "--file", required=True, help="Path to the .testdata file to verify")
    parser.add_argument("-u", "--url", required=True, help="Game URL to open in Chrome")
    parser.add_argument("-o", "--output", default="report.html", help="Path to save the HTML test report")
    parser.add_argument("--auto-spin", action="store_true", help="Enable automatic spacebar key presses to spin")
    parser.add_argument("--spin-delay", type=float, default=5.0, help="Delay in seconds between automatic spins (default: 5.0s)")
    
    args = parser.parse_args()
    
    # 1. Parse expected data
    expected_spins = parse_testdata(args.file)
    total_spins = len(expected_spins)
    print(f"[Info] Parsed testdata file. Loaded {total_spins} expected spins.")
    
    # Create screenshots directory
    screenshots_dir = "screenshots"
    if not os.path.exists(screenshots_dir):
        os.makedirs(screenshots_dir)
        print(f"[Info] Created screenshots directory: {os.path.abspath(screenshots_dir)}")
        
    # 2. Start Selenium Chrome driver with console logs enabled
    print("[Info] Starting Google Chrome...")
    options = Options()
    # Enable capturing browser console logs
    options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
    
    driver = webdriver.Chrome(options=options)
    driver.maximize_window()
    
    try:
        print(f"[Info] Navigating to game: {args.url}")
        driver.get(args.url)
        
        print("\n" + "="*70)
        print(" BROWSER AUTOMATION IS RUNNING ")
        print("="*70)
        print("1. If login is required, please perform it now.")
        print("2. Navigate/load the game so it is ready for the spins.")
        print("3. When the game is fully loaded and ready:")
        print("   - Press ENTER in this console to start tracking!")
        print("="*70)
        input("Press Enter to start verification...")
        
        # Clear initial log entries generated during page load
        driver.get_log('browser')
        
        results = []
        spin_index = 0
        
        if args.auto_spin:
            print("\n[Auto-Spin] Auto spin is enabled. Launching first spin in 2 seconds...")
            time.sleep(2.0)
            trigger_spin(driver)
            
        print("\n[Info] Listening to console logs... Spin the game to begin verification.")
        
        last_spin_time = time.time()
        
        while spin_index < total_spins:
            # Poll console logs
            log_entries = driver.get_log('browser')
            for entry in log_entries:
                message = entry.get('message', '')
                # Search for log matching "batch: X, index: Y"
                match = re.search(r'batch:\s*(\d+),\s*index:\s*(\d+)', message)
                if match:
                    actual_batch = int(match.group(1))
                    actual_index = int(match.group(2))
                    
                    expected_batch, expected_index = expected_spins[spin_index]
                    
                    # Capture screenshot immediately
                    screenshot_filename = f"spin_{spin_index + 1}_actual_{actual_batch}_{actual_index}.png"
                    screenshot_path = os.path.join(screenshots_dir, screenshot_filename)
                    driver.save_screenshot(screenshot_path)
                    
                    # Verify batch and index
                    passed = (actual_batch == expected_batch and actual_index == expected_index)
                    status = "PASS" if passed else "FAIL"
                    
                    print(f" -> Spin {spin_index + 1}/{total_spins}: "
                          f"Expected ({expected_batch}, {expected_index}), "
                          f"Actual ({actual_batch}, {actual_index}) -> "
                          f"{status}")
                          
                    results.append({
                        "spin_num": spin_index + 1,
                        "expected": f"({expected_batch}, {expected_index})",
                        "actual": f"({actual_batch}, {actual_index})",
                        "status": status,
                        "screenshot": screenshot_filename
                    })
                    
                    spin_index += 1
                    last_spin_time = time.time()
                    
                    if spin_index >= total_spins:
                        break
                        
                    # If auto-spin is enabled, queue the next spin
                    if args.auto_spin:
                        print(f"[Auto-Spin] Waiting {args.spin_delay}s for animation to complete...")
                        time.sleep(args.spin_delay)
                        trigger_spin(driver)
            
            # Prevent high CPU utilization in loop
            time.sleep(0.2)
            
        print("\n[Info] Verification completed. Closing browser...")
        driver.quit()
        
        # 3. Generate HTML report
        testdata_name = os.path.basename(args.file)
        # Try to find module ID in the XML
        tree = ET.parse(args.file)
        root = tree.getroot()
        key_elem = root.find('Key')
        module_id = key_elem.get('moduleID') if key_elem is not None else "Unknown"
        
        generate_report(results, testdata_name, module_id, args.output)
        
    except KeyboardInterrupt:
        print("\n[Info] Run cancelled by user. Closing browser...")
        driver.quit()
    except Exception as e:
        print(f"\n[Error] An unexpected error occurred: {e}")
        try:
            driver.quit()
        except:
            pass

if __name__ == '__main__':
    main()
