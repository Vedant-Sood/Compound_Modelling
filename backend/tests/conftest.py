import os

# FastAPI's TestClient sends "Host: testserver"; allow it alongside the localhost defaults.
os.environ.setdefault("CHEMMODEL_ALLOWED_HOSTS", "testserver")
