import urllib.request
import json

data = json.dumps({"email": "admin@pharmanexus.com", "password": "admin123"}).encode('utf-8')
req = urllib.request.Request("http://localhost:8000/auth/login", data=data, headers={'Content-Type': 'application/json'})
res = urllib.request.urlopen(req)
token = json.loads(res.read())['access_token']
print("Login successful")

# Try to create a sale with a fake prescription
headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}
payload = {
    "store_id": 1,
    "prescription_number": "1", 
    "items": [{"medicine_id": 2, "batch_id": 16, "quantity": 1, "price": 85.0}]
}
data = json.dumps(payload).encode('utf-8')
req = urllib.request.Request("http://localhost:8000/billing/create", data=data, headers=headers)

try:
    res = urllib.request.urlopen(req)
    print("Sale successful:", res.read())
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.read().decode('utf-8')}")

