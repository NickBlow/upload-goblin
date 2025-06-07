import hmac
import hashlib
import json
import base64
from typing import Dict, Any


def generate_upload_signature(payload: Dict[str, Any], secret_key: str) -> str:
    """Generates a signed upload token"""
    payload_json = json.dumps(payload, separators=(',', ':'))
    payload_base64 = base64.urlsafe_b64encode(payload_json.encode()).decode().rstrip('=')

    signature = hmac.new(
        secret_key.encode(),
        payload_base64.encode(),
        hashlib.sha256
    ).digest()
    signature_base64 = base64.urlsafe_b64encode(signature).decode().rstrip('=')

    return f"{payload_base64}.{signature_base64}"
