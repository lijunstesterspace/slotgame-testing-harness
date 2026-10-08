import os
import re
import sys
import argparse

def get_clipboard_text():
    """Attempt to get text from the clipboard using tkinter."""
    try:
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        clipboard_content = root.clipboard_get()
        return clipboard_content
    except Exception:
        return None

def parse_line_batch_index(line):
    """Robustly parse batch and index values from a single line of text."""
    # Try pattern 1: "batch and index: 21,4683" or "batch and index: 21 , 4683"
    bi_match = re.search(r'batch\D+index\D*(\d+)\D+(\d+)', line, re.IGNORECASE)
    if bi_match:
        return int(bi_match.group(1)), int(bi_match.group(2))
        
    # Try pattern 2: separate labels, e.g., batch: 21, index: 4683
    batch_match = re.search(r'batch\D*(\d+)', line, re.IGNORECASE)
    index_match = re.search(r'index\D*(\d+)', line, re.IGNORECASE)
    if batch_match and index_match:
        return int(batch_match.group(1)), int(index_match.group(1))
        
    # Try pattern 3: fallback to last two numbers in the line
    digits = re.findall(r'\d+', line)
    if len(digits) >= 2:
        return int(digits[-2]), int(digits[-1])
        
    return None

def parse_input(text):
    """Parse input text containing batch and index values."""
    parsed = []
    lines = text.strip().split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Check two pairs first (e.g. 58,3  2,67933)
        two_match = re.match(r'^(\d+)\s*[\s,]\s*(\d+)\s+(\d+)\s*[\s,]\s*(\d+)$', line)
        if two_match:
            parsed.append((
                int(two_match.group(1)),
                int(two_match.group(2)),
                int(two_match.group(3)),
                int(two_match.group(4))
            ))
        else:
            res = parse_line_batch_index(line)
            if res:
                parsed.append(res)
    return parsed

def parse_multi_input(text, default_file="generated_wins.testdata"):
    """
    Parse input text containing multiple files and their batch/index pairs.
    Supports block headers and single line formats.
    Can dynamically parse single-pair (2 values) or double-pair (4 values) lines.
    
    Returns a dict mapping filename -> list of tuples.
    """
    files = {}
    current_file = None
    current_data = []
    
    lines = text.strip().split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Try Format B (One line per file):
        # 1. First try Two Pairs match: e.g. "Bonus Feature_MINI Prize\t58,3\t2,67933"
        two_pair_match = re.match(r'^(.+?)\s+(\d+)\s*[\s,]\s*(\d+)\s+(\d+)\s*[\s,]\s*(\d+)$', line)
        if two_pair_match:
            name = two_pair_match.group(1).strip()
            if any(c.isalpha() for c in name):
                base_batch = int(two_pair_match.group(2))
                base_index = int(two_pair_match.group(3))
                bonus_batch = int(two_pair_match.group(4))
                bonus_index = int(two_pair_match.group(5))
                
                # Flush block data
                if current_data:
                    active_file = current_file if current_file else default_file
                    if not active_file.endswith('.testdata'):
                        active_file += '.testdata'
                    if active_file in files:
                        files[active_file].extend(current_data)
                    else:
                        files[active_file] = current_data
                    current_data = []
                    current_file = None
                    
                if not name.endswith('.testdata'):
                    name += '.testdata'
                
                item = (base_batch, base_index, bonus_batch, bonus_index)
                if name in files:
                    files[name].append(item)
                else:
                    files[name] = [item]
                continue
                
        # 2. Try One Pair match: e.g. "Bonus Feature trigger_Ascend\t58,3"
        one_line_match = re.match(r'^(.+?)\s+(\d+)\s*[\s,]\s*(\d+)$', line)
        if one_line_match:
            name = one_line_match.group(1).strip()
            if any(c.isalpha() for c in name):
                batch = int(one_line_match.group(2))
                index = int(one_line_match.group(3))
                
                # Flush block data
                if current_data:
                    active_file = current_file if current_file else default_file
                    if not active_file.endswith('.testdata'):
                        active_file += '.testdata'
                    if active_file in files:
                        files[active_file].extend(current_data)
                    else:
                        files[active_file] = current_data
                    current_data = []
                    current_file = None
                    
                if not name.endswith('.testdata'):
                    name += '.testdata'
                    
                item = (batch, index)
                if name in files:
                    files[name].append(item)
                else:
                    files[name] = [item]
                continue
                
        # Format A: Block headers or plain data lines
        is_header = False
        new_filename = ""
        
        if line.startswith('[') and line.endswith(']'):
            new_filename = line[1:-1].strip()
            is_header = True
        elif line.startswith('#'):
            new_filename = line[1:].strip()
            is_header = True
        elif line.startswith('==') and line.endswith('=='):
            new_filename = line.replace('=', '').strip()
            is_header = True
        elif line.lower().endswith('.testdata'):
            new_filename = line.strip()
            is_header = True
            
        if is_header:
            if current_data:
                active_file = current_file if current_file else default_file
                if not active_file.endswith('.testdata'):
                    active_file += '.testdata'
                if active_file in files:
                    files[active_file].extend(current_data)
                else:
                    files[active_file] = current_data
                current_data = []
            current_file = new_filename
        else:
            # Check if this plain data line contains two pairs
            block_two_match = re.match(r'^(\d+)\s*[\s,]\s*(\d+)\s+(\d+)\s*[\s,]\s*(\d+)$', line)
            if block_two_match:
                current_data.append((
                    int(block_two_match.group(1)),
                    int(block_two_match.group(2)),
                    int(block_two_match.group(3)),
                    int(block_two_match.group(4))
                ))
            else:
                res = parse_line_batch_index(line)
                if res:
                    current_data.append(res)
                    
    # Save any remaining data
    if current_data:
        active_file = current_file if current_file else default_file
        if not active_file.endswith('.testdata'):
            active_file += '.testdata'
        if active_file in files:
            files[active_file].extend(current_data)
        else:
            files[active_file] = current_data
        
    return files

def generate_testdata(data, module_id, stage, comment, output_path):
    """Generate the formatted .testdata XML file."""
    lines = []
    lines.append("<Test>")
    lines.append(f'<Key moduleID="{module_id}" loginName="" />')
    
    first = True
    for item in data:
        if len(item) == 4:
            # Nested Bonus Template (Format B)
            base_batch, base_index, bonus_batch, bonus_index = item
            if first:
                lines.append(f'<Slot><Spin stage="BaseGame">')
                first = False
            else:
                lines.append(f'<Spin stage="BaseGame">')
            lines.append(f'<PreGen batch="{base_batch}" index="{base_index}"></PreGen>')
            lines.append(f'<Feature stage="Bonus">')
            lines.append(f'<PreGen batch="{bonus_batch}" index="{bonus_index}"></PreGen>')
            lines.append(f'</Feature>')
            lines.append('</Spin>')
        else:
            # Single Spin Template (Format A)
            batch, index = item
            if first:
                lines.append(f'<Slot><Spin stage="{stage}" comment="{comment}">')
                first = False
            else:
                lines.append(f'<Spin stage="{stage}" comment="{comment}">')
            lines.append(f'<PreGen batch="{batch}" index="{index}" />')
            lines.append('</Spin>')
            
    lines.append('</Slot>')
    lines.append('</Test>')
    
    # Ensure a trailing newline
    content = '\n'.join(lines) + '\n'
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  [Success] Saved to: {os.path.basename(output_path)}")

def safe_input(prompt, default_val):
    """Safely get input, returning default if EOFError occurs."""
    try:
        val = input(prompt).strip()
        return val if val else default_val
    except EOFError:
        return default_val

def main():
    parser = argparse.ArgumentParser(description="Slot Machine .testdata Batch/Single Generator")
    parser.add_argument("-m", "--module", default="10539", help="moduleID (default: 10539)")
    parser.add_argument("-s", "--stage", default="BaseGame", help="stage (default: BaseGame)")
    parser.add_argument("-c", "--comment", default="TestMode", help="comment (default: TestMode)")
    parser.add_argument("-o", "--output", default="generated_wins.testdata", help="Output filename (default: generated_wins.testdata)")
    parser.add_argument("-f", "--file", help="Path to file containing batch data (optional)")
    
    args_passed = len(sys.argv) > 1
    is_piped = not sys.stdin.isatty()
    
    if args_passed or is_piped:
        # Command line / Piped mode
        args = parser.parse_args()
        
        data_text = ""
        if args.file:
            if os.path.exists(args.file):
                with open(args.file, 'r', encoding='utf-8') as f:
                    data_text = f.read()
            else:
                print(f"[Error] File not found: {args.file}")
                sys.exit(1)
        else:
            data_text = sys.stdin.read()
            
        files_data = parse_multi_input(data_text, default_file=args.output)
        if not files_data:
            print("[Error] No valid data or filenames found.")
            sys.exit(1)
            
        print(f"Generating {len(files_data)} file(s)...")
        for filename, data in files_data.items():
            generate_testdata(data, args.module, args.stage, args.comment, filename)
            
    else:
        # Fully Interactive Mode
        print("=" * 60)
        print(" Slot machine .testdata batch file generator ")
        print("=" * 60)
        print("Format A (single group - block format):")
        print("  # filename1")
        print("  21,4683")
        print("Format B (two groups - single-line nested format):")
        print("  filename1\\t58,3\\t2,67933")
        print("  filename2\\t58,3\\t4,145")
        print("=" * 60)
        
        clip_text = get_clipboard_text()
        files_data = {}
        
        if clip_text:
            files_data = parse_multi_input(clip_text)
            if files_data:
                print(f"Detected batch data for {len(files_data)} file(s) in the clipboard:")
                for fname, data in files_data.items():
                    print(f"  - {fname} ({len(data)} spins)")
                
                use_clip = safe_input("\nUse the data from the clipboard directly? (Y/n): ", "y").lower()
                if use_clip not in ('n', 'no'):
                    pass
                else:
                    files_data = {}

        if not files_data:
            print("\nPlease paste your data:")
            print("When done, press Ctrl+Z then Enter on Windows (Ctrl+D on Linux/Mac) to finish input:")
            print("-" * 40)
            try:
                stdin_text = sys.stdin.read()
                files_data = parse_multi_input(stdin_text)
            except KeyboardInterrupt:
                print("\nCancelled.")
                return
                
        if not files_data:
            print("\n[Error] No valid data detected, exiting.")
            return

        # Get global base configuration
        module_id = safe_input(f"\nEnter global moduleID [default: 10539]: ", "10539")
        stage = safe_input(f"Enter global stage [default: BaseGame]: ", "BaseGame")
        comment = safe_input(f"Enter global comment [default: TestMode]: ", "TestMode")
        
        # If there is only one file and it matches the default name, let the user customize the filename
        default_key = "generated_wins.testdata"
        if len(files_data) == 1 and default_key in files_data:
            filename = safe_input(f"Enter output filename [default: {default_key}]: ", default_key)
            if not filename.endswith('.testdata'):
                filename += '.testdata'
            files_data = {filename: files_data[default_key]}
            
        print(f"\nGenerating {len(files_data)} file(s)...")
        for filename, data in files_data.items():
            generate_testdata(data, module_id, stage, comment, filename)
            
        print("\n[Done] All files generated successfully!")

if __name__ == '__main__':
    main()
