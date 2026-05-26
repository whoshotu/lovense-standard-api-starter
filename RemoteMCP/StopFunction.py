# StopFunction.py
# Stop currently running functions on Lovense toys

import requests

def SendStopFunction(domainUrl,toys):
    """
    Immediately stop all running actions on toys.
    """
    url = f"{domainUrl}/command"
    data = {
        "command": "Function",
        "action": "Stop",
        "timeSec": 0,
        "toy": toys,
        "apiVer": 1
    }

    response = requests.post(url, json=data)
    if response.status_code == 200:
        print(f"✅ SendStopFunction Response: {response.json()}")
    else:
        print(f"❌ SendStopFunction Failed. Status Code: {response.status_code}")