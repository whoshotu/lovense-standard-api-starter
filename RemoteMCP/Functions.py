# Functions.py
# Send basic functions to Lovense toys (vibration, movement, etc.)

import requests

def SendFunctions(domainUrl,toys, commands, time_sec):
    """
    Send function Vibrate command to Lovense toys.
    """
    url = f"{domainUrl}/command"
    data = {
        "command": "Function",
        "action": commands,
        "timeSec": time_sec,
        "toy": toys,
        "apiVer": 1
    }

    response = requests.post(url, json=data)
    if response.status_code == 200:
        result = response.json()
        print(f"✅ SendFunctions Response: {result}")
        return result
    else:
        print(f"❌ SendFunctions Failed. Status Code: {response.status_code}")
        return None
