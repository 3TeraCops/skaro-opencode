"""Give a copied real profile its own Docker namespace without touching source resources."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def isolate(target: Path):
    target = target.resolve(strict=True)
    output = Path(__file__).resolve().parents[3] / 'output'
    if not target.is_relative_to(output):
        raise ValueError('Only verification copies inside this repository output/ are accepted')
    suffix = '-copy-' + hashlib.sha256(str(target).encode()).hexdigest()[:8]
    with sqlite3.connect(target / 'skaro.db') as db:
        row = db.execute("SELECT value FROM settings WHERE key='environments'").fetchone()
        if not row:
            return
        records = json.loads(row[0])
        changed = 0
        for record in records:
            old = record['name']
            if old.endswith(suffix):
                continue
            record['name'] = old + suffix
            # The new namespace has not created data or reserved host ports yet.
            record['created'] = False
            record['ports'] = {}
            if isinstance(record.get('start'), str):
                record['start'] = record['start'].replace(old, record['name'])
            changed += 1
        db.execute("UPDATE settings SET value=? WHERE key='environments'",
                   (json.dumps(records, ensure_ascii=False),))
        print(json.dumps({'isolated_environments': changed, 'profile': str(target)}))


if __name__ == '__main__':
    isolate(Path(sys.argv[1]))
