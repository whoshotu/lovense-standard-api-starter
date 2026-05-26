# server.py
from mcp.server.fastmcp import FastMCP
import sys
import logging
import Functions
import os
import re
import StopFunction
logger = logging.getLogger('RemoteMCP')

# Fix UTF-8 encoding for Windows console
if sys.platform == 'win32':
    sys.stderr.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')



# Create an MCP server
mcp = FastMCP("RemoteMCP")

domainUrl = ""

# ------------------------
# Utility Functions
# ------------------------

def ConvertIpToDomain(game_mode_ip, https_port) -> tuple:
    """
    Convert a local IP address to the Lovense Remote Game Mode domain format.

    Args:
        game_mode_ip (str): Local IP address like '192.168.1.1'
        https_port (int): HTTPS port, usually 30010

    Returns:
        tuple: (Formatted domain URL, Status message)
    """
    if not game_mode_ip:
        return None, "❌ IP address cannot be empty"

    ip = game_mode_ip.strip()

    if not re.match(r"^(\d{1,3}\.){3}\d{1,3}$", ip):
        return None, "❌ Invalid IP format (e.g. 192.168.1.1)"

    for part in ip.split('.'):
        try:
            if not 0 <= int(part) <= 255:
                raise ValueError
        except ValueError:
            return None, "❌ Each IP segment must be between 0 and 255"

    domain = f"https://{ip.replace('.', '-')}.lovense.club:{https_port}"
    return domain, f"✅ Converted domain: {domain}"

# ------------------------
# MCP -> Get from command line parameters
# ------------------------
def parse_args_from_argv() -> dict:
    args = {}
    for arg in sys.argv[1:]:
        if '=' in arg:
            key, value = arg.split('=', 1)
            args[key] = value
    return args

def get_mcp_config() -> dict:

    cli_args = parse_args_from_argv()

    config = {}
    config['game_mode_ip'] = cli_args.get("GAME_MODE_IP") or os.getenv("GAME_MODE_IP")
    config['game_mode_port'] = cli_args.get("GAME_MODE_PORT") or os.getenv("GAME_MODE_PORT")

    missing_keys = [k for k in ['game_mode_ip', 'game_mode_port'] if not config.get(k)]
    if missing_keys:
        raise ValueError(f"Required MCP configuration parameters are missing: {missing_keys}")

    global domainUrl
    domain, message = ConvertIpToDomain(config['game_mode_ip'], config['game_mode_port'])
    if not domain:
        raise ValueError(message)
    domainUrl = domain
    return config





# Add an addition tool
@mcp.tool()
def SendFunctions(python_expression: str) -> dict:
    """   Send function Vibrate command to Lovense toys. """
    if not domainUrl:
        return {"success": False, "message": "Domain URL not initialized"}

    try:
        Functions.SendFunctions(domainUrl, "", "Vibrate:10", 2)
        return {"success": True, "message": f"Sent pattern: Vibrate for 2 seconds"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@mcp.tool()
async def SendStopFunction():
    """
    Stop Stopped all actions currently running.
    """
    if not domainUrl:
        return {"success": False, "message": "Domain URL not initialized"}

    try:
        StopFunction.SendStopFunction(domainUrl, "")
        return {"success": True, "message": "Stopped all toy functions"}
    except Exception as e:
        return {"success": False, "message": str(e)}



# Start the server
if __name__ == "__main__":
    get_mcp_config()
    mcp.run(transport="stdio")
