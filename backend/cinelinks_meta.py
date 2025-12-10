import sys, json, urllib.request

def fetch_meta(base_url: str):
    url = f"{base_url.rstrip('/')}/meta"
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read().decode("utf-8"))

def print_meta(tag, meta):
    print(f"\n[{tag}]")
    print(f" ready:    {meta.get('ready')}")
    print(f" actors:   {meta.get('actors')}")
    print(f" movies:   {meta.get('movies')}")
    print(f" edges:    {meta.get('edges')}")
    print(f" checksum: {meta.get('checksum')}")

def compare(a, b):
    keys = ["actors", "movies", "edges", "checksum"]
    mismatches = [k for k in keys if a.get(k) != b.get(k)]
    if not mismatches:
        print("\n✅ MATCH: datasets are identical.")
        return 0
    print("\n❌ MISMATCH in:", ", ".join(mismatches))
    return 1

if __name__ == "__main__":
    if len(sys.argv) == 2:
        m = fetch_meta(sys.argv[1]); print_meta("ENV", m); sys.exit(0 if m.get("ready") else 2)
    elif len(sys.argv) == 3:
        m1, m2 = fetch_meta(sys.argv[1]), fetch_meta(sys.argv[2])
        print_meta("ENV A", m1); print_meta("ENV B", m2); sys.exit(compare(m1, m2))
    else:
        print("Usage:")
        print("  python cinelinks_meta.py https://api.staging.example.com")
        print("  python cinelinks_meta.py https://api.staging.example.com https://api.prod.example.com")
        sys.exit(1)
