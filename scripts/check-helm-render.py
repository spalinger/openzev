"""Check public routing and security-setting passthrough in the rendered chart."""
import subprocess
from pathlib import Path

import yaml

CHART = Path(__file__).resolve().parents[1] / "charts" / "openzev"
RELEASE = "security-check-openzev"


def render(*options):
    manifest = subprocess.check_output(
        ["helm", "template", "security-check", str(CHART), *options], text=True,
    )
    return [doc for doc in yaml.safe_load_all(manifest) if doc]


def check_public_routes(documents):
    ingress, = [doc for doc in documents if doc["kind"] == "Ingress"]
    paths = [path for rule in ingress["spec"]["rules"] for path in rule["http"]["paths"]]
    assert {(path["path"], path["pathType"], path["backend"]["service"]["name"]) for path in paths} == {
        ("/", "Prefix", f"{RELEASE}-frontend"),
        ("/api", "Prefix", f"{RELEASE}-backend"),
    }, "Public /admin routes must use the frontend; only /api belongs to the backend."
    service, = [doc for doc in documents if doc["kind"] == "Service" and doc["metadata"]["name"] == f"{RELEASE}-backend"]
    assert service["spec"]["type"] == "ClusterIP", "The backend service must stay private by default."


def main():
    check_public_routes(render())
    settings = {"OAUTH_ALLOW_PRIVATE_HOSTS": "True", "DJANGO_ADMIN_ENABLED": "True"}
    options = [arg for key, value in settings.items() for arg in ("--set-string", f"backend.extraEnv.{key}={value}")]
    documents = render(*options)
    check_public_routes(documents)
    deployment, = [doc for doc in documents if doc["kind"] == "Deployment" and doc["metadata"]["name"] == f"{RELEASE}-backend"]
    backend, = [container for container in deployment["spec"]["template"]["spec"]["containers"] if container["name"] == "backend"]
    environment = {entry["name"]: entry.get("value") for entry in backend["env"]}
    assert all(environment.get(key) == value for key, value in settings.items()), "Security settings must render as strings."
    print("Helm public routing and security environment checks passed.")


if __name__ == "__main__":
    main()
