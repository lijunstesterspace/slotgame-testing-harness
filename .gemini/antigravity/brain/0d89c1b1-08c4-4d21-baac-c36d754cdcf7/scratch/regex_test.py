import re

lines = [
    "Bonus Feature near miss	21,4683",
    "Bonus Feature trigger_Ascend	58,3",
    "Bonus Feature trigger_Harvest	71,7",
    "Bonus Feature trigger_Empower	86,7",
    "Bonus Feature trigger_Amplify	101,6",
    "Bonus Feature trigger_Prosper	117,9",
    "Bonus Feature trigger_Empower, Prosper	311,5",
    "Bonus Feature trigger_Ascend, Harvest, Amplify	371,0",
    "Bonus Feature trigger_Ascend, Harvest, Empower, Amplify	520,3",
    "Bonus Feature_Ascend, Harvest, Empower, Amplify, Prosper	581,0",
    "Bonus Feature trigger_Phoenix	583,6"
]

pattern = r'^(.+?)\s+(\d+)\s*[\s,]\s*(\d+)$'

for line in lines:
    m = re.match(pattern, line.strip())
    if m:
        name = m.group(1).strip()
        batch = m.group(2)
        index = m.group(3)
        print(f"Name: {name:55} | Batch: {batch:4} | Index: {index}")
    else:
        print(f"FAILED: {line}")
